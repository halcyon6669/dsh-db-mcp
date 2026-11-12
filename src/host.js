/**
 * dsh-db-mcp — Host implementation (loaded by ../index.js, re-importable).
 *
 * Owns the data-source registry and the JSON API behind the management panel:
 *   GET  /health              runtime facts for the diagnostics card
 *   GET  /datasources         registry, credentials projected away
 *   GET  /dbeaver/scan        connections already configured in DBeaver
 *   POST /datasources/save    create or update a source
 *   POST /datasources/delete  remove a source and its stored secret
 *   POST /datasources/test    real login probe (SQLite via node:sqlite, the rest via the Python drivers)
 *   POST /dbeaver/import      copy DBeaver connections into the registry
 *
 * Storage lives under <DSH_HOME>/db-mcp:
 *   datasources.json  registry without credentials (atomic write, mode 0600)
 *   secrets.json      per-source passwords, mode 0600, never returned to the page
 *
 * The Python MCP server and the MCP row wiring arrive in P3.
 */
import { execFile } from 'node:child_process'
import { createDecipheriv } from 'node:crypto'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect as netConnect } from 'node:net'

// Cache-busting: index.js appends ?v=<generation> to this module's URL, and the
// nested imports must carry the same marker or Node would serve the previous
// copy after a reload.
const GENERATION = new URL(import.meta.url).searchParams.get('v') || '0'
const { createBridge } = await import(new URL(`./tools.js?v=${GENERATION}`, import.meta.url).href)

const API_PREFIX = '/plugins/db-mcp/api'
const PLUGIN_NAME = 'dsh-db-mcp'
const PLUGIN_VERSION = '0.9.6'
const SCHEMA_VERSION = 1
const REGISTRY_FILE = 'datasources.json'
const SECRETS_FILE = 'secrets.json'
const SETTINGS_FILE = 'settings.json'
// Per-conversation data-source allowlists. Missing file or an empty id list
// means "no limit": every source stays reachable.
const SCOPES_FILE = 'sessions.json'
const AUDIT_FILE = 'logs/audit.jsonl'
const AUDIT_LIMIT_BYTES = 512 * 1024
const PYTHON_CACHE_MS = 30_000
const MAX_BODY_BYTES = 1024 * 1024
const MAX_SOURCES = 32
// Entry name other MCP clients see in their own configuration.
const CLIENT_ENTRY = 'dsh-db-mcp'
const HTTP_PORT_DEFAULT = 8765
const HTTP_PORT_MIN = 1024
const HTTP_PORT_MAX = 65535

const KINDS = ['sqlite', 'postgres', 'gauss', 'mysql', 'oracle']
const DEFAULT_PORTS = { postgres: 5432, gauss: 5432, mysql: 3306, oracle: 1521 }
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/** DBeaver's own secure-storage key (DefaultSecureStorage.java). */
const DBEAVER_KEY = Buffer.from('babb4a9f774ab853c96c2d653dfe544a', 'hex')
const DBEAVER_IV = Buffer.alloc(16, 0)

/* ------------------------------------------------------------ small utils */

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function trimmed(value) {
  return text(value).trim()
}

function cleanRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function isoNow() {
  return new Date().toISOString()
}

async function readJson(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { missing: true, value: null, error: null }
    return { missing: false, value: null, error: String((error && error.message) || error) }
  }
  try {
    return { missing: false, value: JSON.parse(raw), error: null }
  } catch (error) {
    return { missing: false, value: null, error: `invalid JSON in ${file}: ${(error && error.message) || error}` }
  }
}

async function writeJsonAtomic(file, value, mode) {
  await mkdir(join(file, '..'), { recursive: true })
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: mode || 0o600 })
  await rename(temp, file)
  if (mode) {
    try {
      await chmod(file, mode)
    } catch {
      /* best effort where POSIX modes are unavailable */
    }
  }
}

/* --------------------------------------------------------------- schemas */

/**
 * Endpoints in the order they are tried. openGauss clusters are usually handed
 * over as `host1:1,host2:2,host3:3`, so a single `host` string and a declared
 * `hosts` array both have to survive.
 */
function hostsOf(config) {
  const cfg = cleanRecord(config)
  const entries = []
  if (Array.isArray(cfg.hosts)) {
    for (const item of cfg.hosts) {
      if (item && typeof item === 'object' && item.host) {
        entries.push({ host: String(item.host), port: Number(item.port) || null })
      } else if (typeof item === 'string' && item.trim()) {
        entries.push({ host: item.trim(), port: null })
      }
    }
  }
  if (entries.length) return entries
  return String(cfg.host || '')
    .split(',')
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const match = /^(.*):(\d+)$/.exec(piece)
      return match ? { host: match[1], port: Number(match[2]) } : { host: piece, port: null }
    })
}

function endpointLabel(config) {
  const hosts = hostsOf(config)
  if (!hosts.length) return ''
  const port = cleanRecord(config).port
  const first = hosts[0].host
  const head = hosts.length > 1 ? `${first} +${hosts.length - 1}` : first
  const effectivePort = hosts[0].port || port
  return effectivePort ? `${head}:${effectivePort}` : head
}

function describeTarget(kind, config) {
  const cfg = cleanRecord(config)
  if (kind === 'sqlite') return trimmed(cfg.file)
  const database = trimmed(cfg.database) || trimmed(cfg.serviceName) || trimmed(cfg.sid)
  const endpoint = endpointLabel(cfg)
  if (endpoint && database) return `${endpoint}/${database}`
  return endpoint || database
}

/**
 * What makes two entries "the same connection": the engine, the endpoint, the
 * database (or file) and the account. Names do not count, so a DBeaver entry
 * that was already imported under another name is still a duplicate.
 */
function sourceIdentity(kind, config, user) {
  const cfg = cleanRecord(config)
  if (kind === 'sqlite') {
    const file = trimmed(cfg.file)
    return `sqlite|${process.platform === 'win32' ? file.toLowerCase() : file}`
  }
  const host = hostsOf(cfg)
    .map((entry) => entry.host)
    .join(',')
    .toLowerCase()
  const port = String(cfg.port || DEFAULT_PORTS[kind] || '').trim()
  const database = (trimmed(cfg.database) || trimmed(cfg.serviceName) || trimmed(cfg.sid)).toLowerCase()
  const account = (user === undefined ? trimmed(cfg.user) : trimmed(user)).toLowerCase()
  return `${kind || ''}|${host}|${port}|${database}|${account}`
}

/** Connection settings minus anything credential-shaped. */
function configToPublic(kind, config) {  const cfg = cleanRecord(config)
  if (kind === 'sqlite') return { file: trimmed(cfg.file), busyTimeoutMs: cfg.busyTimeoutMs ?? null }
  const hosts = hostsOf(cfg).map((entry) => ({ host: entry.host, port: entry.port || null }))
  return {
    host: trimmed(cfg.host),
    port: cfg.port ?? null,
    hosts: hosts.length > 1 ? hosts : [],
    database: trimmed(cfg.database),
    serviceName: trimmed(cfg.serviceName),
    sid: trimmed(cfg.sid),
    user: trimmed(cfg.user),
    schema: trimmed(cfg.schema),
    sslMode: trimmed(cfg.sslMode),
    charset: trimmed(cfg.charset),
  }
}

function publicProfile(profile, secrets) {
  if (!profile || typeof profile !== 'object') return null
  const config = cleanRecord(profile.config)
  const secret = secrets && profile.id ? secrets[profile.id] : null
  return {
    id: profile.id,
    name: profile.name,
    kind: profile.kind,
    readOnly: profile.readOnly !== false,
    isDefault: profile.isDefault === true,
    tags: Array.isArray(profile.tags) ? profile.tags.filter((tag) => typeof tag === 'string') : [],
    group: typeof profile.group === 'string' ? profile.group : '',
    config: configToPublic(profile.kind, config),
    target: describeTarget(profile.kind, config),
    hasSecret: Boolean(secret && trimmed(secret.password)),
    lastProbe: profile.lastProbe ?? null,
    createdAt: profile.createdAt ?? null,
    updatedAt: profile.updatedAt ?? null,
  }
}

/** Validate raw user input, returning { profile, password, error }. */
function groupName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 48) : ''
}

function normalizeInput(input, existing) {
  const raw = cleanRecord(input)
  const kind = trimmed(raw.kind) || (existing && existing.kind) || ''
  if (!KINDS.includes(kind)) return { error: `unsupported kind: ${kind || '(empty)'}` }

  const id = trimmed(raw.id) || (existing && existing.id) || ''
  if (!ID_PATTERN.test(id)) {
    return { error: 'id must be 1-32 chars of a-z, 0-9 or "-", starting with a letter or digit' }
  }
  if (existing && trimmed(raw.id) && trimmed(raw.id) !== existing.id) {
    return { error: 'id cannot be changed after creation' }
  }

  const name = trimmed(raw.name) || (existing && existing.name) || id
  if (name.length > 64) return { error: 'name must be at most 64 characters' }

  const incoming = cleanRecord(raw.config)
  const config = { ...(Object.keys(incoming).length > 0 ? incoming : cleanRecord(existing && existing.config)) }

  if (kind === 'sqlite') {
    const file = trimmed(config.file)
    if (!file) return { error: 'sqlite requires config.file' }
    config.file = file
    delete config.host
    delete config.port
    delete config.user
  } else {
    const entries = hostsOf(config)
    if (!entries.length) return { error: `${kind} requires config.host` }
    const port = Number(config.port) || DEFAULT_PORTS[kind]
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'config.port must be 1-65535' }
    config.port = port
    config.host = entries.map((entry) => entry.host).join(',')
    if (entries.length > 1) {
      config.hosts = entries.map((entry) => ({ host: entry.host, port: entry.port || port }))
    } else {
      delete config.hosts
    }
    config.user = trimmed(config.user)
    config.database = trimmed(config.database)
    config.serviceName = trimmed(config.serviceName)
    config.sid = trimmed(config.sid)
    if (kind === 'oracle' && !config.serviceName && !config.sid) {
      return { error: 'oracle requires config.serviceName or config.sid' }
    }
    if (kind !== 'oracle' && !config.database) return { error: `${kind} requires config.database` }
    delete config.file
  }

  const readOnly = raw.readOnly === undefined || raw.readOnly === null
    ? (existing ? existing.readOnly !== false : true)
    : raw.readOnly === true
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((tag) => trimmed(tag)).filter(Boolean).slice(0, 8)
    : existing && Array.isArray(existing.tags) ? existing.tags : []
  const group = raw.group === undefined || raw.group === null
    ? (existing && typeof existing.group === 'string' ? existing.group : '')
    : trimmed(raw.group)
  if (group.length > 48) return { error: 'group must be at most 48 characters' }

  const profile = {
    id,
    name,
    kind,
    config,
    readOnly,
    isDefault: raw.isDefault === true || (existing ? existing.isDefault === true : false),
    tags,
    group,
    createdAt: (existing && existing.createdAt) || isoNow(),
    updatedAt: isoNow(),
    lastProbe: existing ? existing.lastProbe ?? null : null,
  }

  const password = raw.password === undefined || raw.password === null ? undefined : String(raw.password)
  return { profile, password }
}

/* ----------------------------------------------------------------- probes */

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = netConnect({ host, port })
    let settled = false
    const finish = (ok, message) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ok, message, latencyMs: Date.now() - started })
    }
    socket.setTimeout(Math.max(500, timeoutMs))
    socket.once('connect', () => finish(true, `TCP ${host}:${port} reachable`))
    socket.once('timeout', () => finish(false, `TCP timeout after ${timeoutMs}ms`))
    socket.once('error', (error) => finish(false, `${(error && error.code) || 'connect failed'}: ${(error && error.message) || error}`))
  })
}

async function sqliteProbe(file, timeoutMs) {
  const started = Date.now()
  try {
    await stat(file)
  } catch {
    return { ok: false, message: `file not found: ${file}`, latencyMs: Date.now() - started, detail: null }
  }
  let sqlite
  try {
    sqlite = await import('node:sqlite')
  } catch (error) {
    return {
      ok: false,
      message: `this Host has no node:sqlite (${(error && error.message) || error}); the Python probe covers it from P3`,
      latencyMs: Date.now() - started,
      detail: null,
    }
  }
  let db
  try {
    db = new sqlite.DatabaseSync(file, { readOnly: true, timeout: Math.max(1000, timeoutMs) })
    const tables = db.prepare("select name from sqlite_master where type = 'table' order by name limit 50").all()
    const probe = db.prepare('select 1 as ok').get()
    return {
      ok: Boolean(probe && probe.ok === 1),
      message: `SQLite opened read-only, ${tables.length} table(s)`,
      latencyMs: Date.now() - started,
      detail: { kind: 'sqlite', engine: 'node:sqlite', tables: tables.map((row) => row.name) },
    }
  } catch (error) {
    return { ok: false, message: String((error && error.message) || error), latencyMs: Date.now() - started, detail: null }
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        /* ignore */
      }
    }
  }
}

async function testProfile(profile, secret, options) {
  const timeoutMs = (options && options.probeTimeoutMs) || 10_000
  const config = cleanRecord(profile && profile.config)
  if (!profile || !KINDS.includes(profile.kind)) {
    return { ok: false, message: 'unknown datasource kind', detail: null, latencyMs: 0 }
  }
  if (profile.kind === 'sqlite') {
    const result = await sqliteProbe(trimmed(config.file), timeoutMs)
    return { ...result, target: describeTarget(profile.kind, config), hasPassword: false }
  }

  const password = secret && trimmed(secret.password) ? trimmed(secret.password) : undefined
  const target = describeTarget(profile.kind, config)
  const remote = options && options.remote
  if (typeof remote === 'function') {
    // A real login through the Python driver: this is what the panel's Test
    // button shows for PostgreSQL, MySQL and Oracle.
    const attempt = await remote(profile, password).catch(() => null)
    if (attempt && typeof attempt.ok === 'boolean') {
      const error = attempt.error || null
      const message =
        attempt.message ||
        (error && (error.hint ? `${error.message} — ${error.hint}` : error.message)) ||
        (attempt.ok ? 'connected' : 'connection failed')
      return {
        ok: attempt.ok === true,
        message,
        latencyMs: Number(attempt.latencyMs) || 0,
        target,
        hasPassword: Boolean(password),
        detail: attempt.detail || { kind: profile.kind, stage: 'login' },
      }
    }
  }

  const host = trimmed(config.host)
  const port = Number(config.port) || DEFAULT_PORTS[profile.kind]
  const reach = await tcpProbe(host, port, timeoutMs)
  const note = reach.ok
    ? `${profile.kind} port reachable, but the authenticated login did not run (the Python MCP server is not up)`
    : reach.message
  return {
    ok: reach.ok,
    message: note,
    latencyMs: reach.latencyMs,
    target,
    hasPassword: Boolean(password),
    detail: { kind: profile.kind, stage: 'tcp', host, port, user: trimmed(config.user) || null },
  }
}

/* ----------------------------------------------------------------- python */

function run(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
        error: error ? String(error.message || error) : null,
      })
    })
  })
}

async function probeOne(command, timeout) {
  const result = await run(command, ['--version'], timeout)
  const banner = result.stdout || result.stderr
  const match = /Python\s+(\d+\.\d+\.\d+)/i.exec(banner)
  if (result.ok && match) return { ok: true, command, version: match[1], detail: banner.split('\n')[0] }
  return { ok: false, command, version: null, detail: (result.error || banner || 'no Python banner').slice(0, 200) }
}

async function detectPython(config, cache) {
  if (cache.value && Date.now() - cache.at < PYTHON_CACHE_MS) return cache.value
  const timeout = (config && config.probeTimeoutMs) || 8000
  const candidates = []
  if (config && config.pythonPath) candidates.push(config.pythonPath)
  candidates.push('python', 'python3')
  const attempts = []
  let found = null
  for (const command of candidates) {
    const attempt = await probeOne(command, timeout)
    attempts.push(attempt)
    if (attempt.ok) {
      found = attempt
      break
    }
  }
  const value = found
    ? { ok: true, command: found.command, version: found.version, attempts }
    : { ok: false, command: null, version: null, attempts }
  cache.value = value
  cache.at = Date.now()
  return value
}

/* ---------------------------------------------------------------- DBeaver */

function dbeaverRoots() {
  const roots = []
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'DBeaverData'))
  roots.push(join(homedir(), 'AppData', 'Roaming', 'DBeaverData'))
  roots.push(join(homedir(), '.local', 'share', 'DBeaverData'))
  roots.push(join(homedir(), 'Library', 'DBeaverData'))
  return [...new Set(roots)]
}

async function listDir(dir) {
  try {
    const { readdir } = await import('node:fs/promises')
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Decrypt DBeaver's credentials-config.json (AES-128-CBC, zero IV, 16-byte prefix). */
function decryptDBeaverCredentials(buffer) {
  try {
    const decipher = createDecipheriv('aes-128-cbc', DBEAVER_KEY, DBEAVER_IV)
    const plain = Buffer.concat([decipher.update(buffer), decipher.final()])
    for (const candidate of [plain.subarray(16), plain]) {
      const body = candidate.toString('utf8').replace(/\u0000+$/g, '').trim()
      if (!body.startsWith('{')) continue
      try {
        const parsed = JSON.parse(body)
        if (parsed && typeof parsed === 'object') return parsed
      } catch {
        /* try the next shape */
      }
    }
    return null
  } catch {
    return null
  }
}

function pickCredential(entry) {
  const queue = [entry]
  const seen = new Set()
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    const password = node.password ?? node['#password']
    if (typeof password === 'string') {
      return { password, user: typeof node.user === 'string' ? node.user : null }
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value)
    }
  }
  return null
}

function mapDBeaverProvider(provider, driver) {
  const p = `${provider || ''} ${driver || ''}`.toLowerCase()
  if (p.includes('sqlite')) return 'sqlite'
  if (p.includes('opengauss') || p.includes('gaussdb') || p.includes('gauss')) return 'gauss'
  if (p.includes('postgres')) return 'postgres'
  if (p.includes('mysql') || p.includes('mariadb')) return 'mysql'
  if (p.includes('oracle')) return 'oracle'
  return null
}

/**
 * Oracle DBeaver entries come in three shapes: a thin URL, a plain TNS name, and
 * a `DESCRIPTION_LIST` descriptor (often pasted across several lines) used by
 * RAC/load-balanced services. The descriptor is read with a small scan instead
 * of one rigid expression so the multi-line form parses too.
 */
function parseOracleUrl(url) {
  const text = String(url || '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (/\((DESCRIPTION|ADDRESS|CONNECT_DATA)/i.test(text)) {
    const host = /\(HOST\s*=\s*([^)\s]+)\)/i.exec(text)
    const port = /\(PORT\s*=\s*(\d+)\)/i.exec(text)
    const service = /\(SERVICE_NAME\s*=\s*([^)\s]+)\)/i.exec(text)
    const sid = /\(SID\s*=\s*([^)\s]+)\)/i.exec(text)
    if (!host) return null
    return {
      host: host[1],
      port: port ? Number(port[1]) : 1521,
      serviceName: service ? service[1] : '',
      sid: sid ? sid[1] : '',
    }
  }
  // `@host:port/service` names a service; `@host:port:SID` names a SID.
  const match = /jdbc:oracle:thin:@(?:\/\/)?([^:/]+)(?::(\d+))?([:/])([^?]+)/i.exec(text)
  if (!match) return null
  const bySid = match[3] === ':'
  const target = match[4]
  return {
    host: match[1],
    port: match[2] ? Number(match[2]) : 1521,
    serviceName: bySid ? '' : target,
    sid: bySid ? target : '',
  }
}

/**
 * DBeaver stores a connection either field-by-field (host/port/database) or, for
 * the URL configuration type, only as a JDBC URL — the MySQL connection created
 * through the driver dialog has just `host`, `port` and the URL, with the
 * database and the user only inside the URL. Parse it so both shapes import.
 *
 * openGauss URLs list every cluster node (`h1:1,h2:2,h3:3`) and hang options off
 * a query string, so the authority is split on commas and the options are parsed.
 */
function parseJdbcUrl(url) {
  const text = trimmed(url)
  if (!text) return null
  const body = text.replace(/^jdbc:/i, '')
  const schemeMatch = /^([a-z0-9+]+):\/\//i.exec(body)
  if (!schemeMatch) return null
  const scheme = schemeMatch[1].toLowerCase()
  let rest = body.slice(schemeMatch[0].length)

  let user = ''
  let password = ''
  const at = rest.lastIndexOf('@')
  if (at >= 0) {
    const credentials = rest.slice(0, at)
    rest = rest.slice(at + 1)
    const colon = credentials.indexOf(':')
    user = decodeURIComponent(colon >= 0 ? credentials.slice(0, colon) : credentials)
    password = colon >= 0 ? decodeURIComponent(credentials.slice(colon + 1)) : ''
  }

  let query = ''
  const mark = rest.indexOf('?')
  if (mark >= 0) {
    query = rest.slice(mark + 1)
    rest = rest.slice(0, mark)
  }

  const slash = rest.indexOf('/')
  const authority = slash >= 0 ? rest.slice(0, slash) : rest
  const path = slash >= 0 ? rest.slice(slash + 1) : ''

  const hosts = authority
    .split(',')
    .map((piece) => /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(piece.trim()))
    .filter(Boolean)
    .map((match) => ({
      host: match[1].replace(/^\[|\]$/g, ''),
      port: match[2] ? Number(match[2]) : null,
    }))
  if (!hosts.length) return null

  const params = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const equals = pair.indexOf('=')
    const key = decodeURIComponent(equals >= 0 ? pair.slice(0, equals) : pair)
    const value = equals >= 0 ? decodeURIComponent(pair.slice(equals + 1)) : ''
    if (key) params[key] = value
  }

  return {
    scheme,
    user,
    password,
    host: hosts[0].host,
    port: hosts[0].port,
    hosts,
    database: decodeURIComponent(path.split(';')[0] || ''),
    params,
  }
}

function mapDBeaverConnection(connection) {
  const cfg = cleanRecord(connection && connection.configuration)
  const fromUrl = parseJdbcUrl(cfg.url)
  // DBeaver labels an openGauss/GaussDB connection `generic` when it was added
  // through a JDBC URL and driver jar, so the URL scheme is the last clue.
  const kind =
    mapDBeaverProvider(connection && connection.provider, connection && connection.driver) ||
    mapDBeaverProvider('', fromUrl && fromUrl.scheme) ||
    null
  if (!kind) return { ok: false, reason: `unsupported provider: ${(connection && connection.provider) || 'unknown'}` }
  // With configurationType=URL the URL is what DBeaver actually connects with,
  // so its values win over the (possibly stale) form fields.
  const preferUrl = /^url$/i.test(trimmed(cfg.configurationType))
  const pick = (fromUrlValue, fieldValue, fallback = '') => {
    const url = fromUrlValue === undefined || fromUrlValue === null ? '' : fromUrlValue
    const field = typeof fieldValue === 'string' ? fieldValue.trim() : fieldValue
    return (preferUrl ? url || field : field || url) ?? fallback
  }

  if (kind === 'sqlite') {
    const file = trimmed(cfg.database) || trimmed(cfg.url).replace(/^jdbc:sqlite:/i, '')
    if (!file) return { ok: false, reason: 'no database file in the DBeaver entry' }
    return { ok: true, kind, config: { file }, user: '' }
  }

  if (kind === 'oracle') {
    const thin = parseOracleUrl(cfg.url)
    const host = pick(thin && thin.host, trimmed(cfg.host))
    const port = Number(pick(thin && thin.port, Number(cfg.port)) || 0) || 1521
    const serviceName = trimmed(cfg.serviceName) || (thin && thin.serviceName) || ''
    const sid = trimmed(cfg.sid) || (thin && thin.sid) || ''
    if (!host || (!serviceName && !sid)) {
      return {
        ok: false,
        reason: `incomplete Oracle host/service in the DBeaver entry (host=${host || '?'}, service=${
          serviceName || sid || '?'
        }, url=${trimmed(cfg.url) || '-'})`,
      }
    }
    return {
      ok: true,
      kind,
      config: { host, port, serviceName, sid, user: trimmed(cfg.user), schema: trimmed(cfg.schema) },
      user: trimmed(cfg.user),
    }
  }

  // A cluster URL carries every node; keep them so the driver can fail over
  // instead of silently connecting to the first host only.
  const hosts = (fromUrl && Array.isArray(fromUrl.hosts) ? fromUrl.hosts : []).filter((entry) => entry && entry.host)
  const host = pick(
    hosts.length > 1 ? hosts.map((entry) => entry.host).join(',') : fromUrl && fromUrl.host,
    trimmed(cfg.host),
  )
  const database = pick(fromUrl && fromUrl.database, trimmed(cfg.database))
  const user = pick(fromUrl && fromUrl.user, trimmed(cfg.user))
  const port = Number(pick(fromUrl && fromUrl.port, Number(cfg.port)) || 0) || DEFAULT_PORTS[kind]
  if (!host || !database) {
    const seen = [
      `host=${host || '?'}`,
      `database=${database || '?'}`,
      `url=${trimmed(cfg.url) || '-'}`,
    ].join(', ')
    return { ok: false, reason: `incomplete host/database in the DBeaver entry (${seen})` }
  }
  const config = {
    host,
    port,
    database,
    user,
    schema: trimmed(cfg.schema),
    sslMode: trimmed(cfg.sslMode),
  }
  if (hosts.length > 1) {
    config.hosts = hosts.map((entry) => ({ host: entry.host, port: entry.port || port }))
  }
  return { ok: true, kind, config, user }
}

async function scanDBeaver(options = {}) {
  // The scanning endpoint must never hand a password to the page, but the
  // import path needs it to seed secrets.json, so it is opt-in here.
  const withSecrets = options.withSecrets === true
  const existing = Array.isArray(options.existing) ? options.existing : []
  // Anything already configured — or already seen earlier in this scan — is a duplicate.
  const taken = new Map()
  for (const profile of existing) {
    taken.set(sourceIdentity(profile.kind, profile.config, profile.config && profile.config.user), {
      id: profile.id,
      name: profile.name || profile.id,
    })
  }
  const roots = dbeaverRoots()
  const files = []
  for (const root of roots) {
    const entries = await listDir(root)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!/^workspace\d*$/i.test(entry.name) && entry.name !== 'General') continue
      const base = entry.name === 'General' ? root : join(root, entry.name)
      for (const candidate of [
        join(base, 'General', '.dbeaver', 'data-sources.json'),
        join(base, '.dbeaver', 'data-sources.json'),
      ]) {
        try {
          await stat(candidate)
          if (!files.includes(candidate)) files.push(candidate)
        } catch {
          /* not here */
        }
      }
    }
  }

  const sources = []
  const problems = []
  for (const file of files) {
    const read = await readJson(file)
    if (read.error || !read.value) {
      problems.push({ file, error: read.error || 'unreadable' })
      continue
    }
    const credentialsFile = join(file, '..', 'credentials-config.json')
    let credentials = null
    try {
      credentials = decryptDBeaverCredentials(await readFile(credentialsFile))
    } catch {
      credentials = null
    }
    const connections = cleanRecord(read.value.connections)
    const items = []
    for (const [id, connection] of Object.entries(connections)) {
      const mapped = mapDBeaverConnection(connection)
      if (!mapped.ok) {
        items.push({
          id,
          name: (connection && connection.name) || id,
          provider: (connection && connection.provider) || null,
          importable: false,
          reason: mapped.reason,
        })
        continue
      }
      const credential = credentials ? pickCredential(credentials[id]) : null
      const config = { ...mapped.config }
      const credentialUser = (credential && credential.user) || ''
      if (!config.user && credentialUser) config.user = credentialUser
      const identity = sourceIdentity(mapped.kind, config, config.user)
      const duplicate = taken.get(identity) || null
      const displayName = (connection && connection.name) || id
      if (!duplicate) taken.set(identity, { id, name: displayName })
      items.push({
        id,
        name: displayName,
        provider: (connection && connection.provider) || null,
        driver: (connection && connection.driver) || null,
        kind: mapped.kind,
        config,
        user: config.user || '',
        target: describeTarget(mapped.kind, config),
        hasPassword: Boolean(credential && credential.password),
        importable: true,
        alreadyImported: Boolean(duplicate),
        ...(duplicate ? { duplicateId: duplicate.id, duplicateName: duplicate.name } : {}),
        ...(withSecrets && credential && credential.password ? { password: credential.password } : {}),
      })
    }
    sources.push({ file, credentialsFile, credentialsFound: Boolean(credentials), connections: items })
  }

  return { roots, sources, problems }
}

/* -------------------------------------------------------------- transport */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Same-origin guard for writes: a browser POST from our own page carries our Host. */
function sameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(new Error(`invalid JSON body: ${(error && error.message) || error}`))
      }
    })
    request.on('error', reject)
  })
}

/* ------------------------------------------------------------------- host */

export function createHost(options = {}) {
  const config = cleanRecord(options.config)
  const dir = options.dir || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'db-mcp')
  const startedAt = Date.now()
  const pythonCache = { at: 0, value: null }
  const registryFile = join(dir, REGISTRY_FILE)
  const secretsFile = join(dir, SECRETS_FILE)

  const bridge = createBridge({
    ctx: options.ctx,
    config,
    packageDir: options.packageDir || fileURLToPath(new URL('..', import.meta.url)),
    runtimeDir: dir,
    settings: () => readSettings(),
    scope: () => readScopes(),
    setScope: (sessionId, ids) => setSessionScope(sessionId, ids),
    audit: (entry) => appendAudit(entry),
    log: (message) => {
      if (config.debug) console.log(`[db-mcp] ${message}`)
    },
  })

  async function ensureMcp() {
    try {
      return await bridge.ensure()
    } catch (error) {
      return { ...bridge.status(), phase: 'failed', error: String((error && error.message) || error) }
    }
  }

  async function readRegistry() {
    const read = await readJson(registryFile)
    if (read.missing) return { datasources: [], groups: [], error: null, missing: true }
    if (read.error) return { datasources: [], groups: [], error: read.error, missing: false }
    const list = read.value && Array.isArray(read.value.datasources) ? read.value.datasources : []
    const declared = read.value && Array.isArray(read.value.groups) ? read.value.groups : []
    const names = [
      ...declared.map((name) => groupName(name)),
      ...list.map((item) => groupName(item && item.group)),
    ].filter(Boolean)
    return {
      datasources: list.filter((item) => item && typeof item === 'object'),
      groups: [...new Set(names)],
      error: null,
      missing: false,
    }
  }

  /**
   * Groups are user-created; a group that still holds sources survives even when
   * the caller does not pass the list again, so every existing write keeps them.
   */
  async function writeRegistry(datasources, groups) {
    let kept = groups
    if (!Array.isArray(kept)) {
      const read = await readJson(registryFile)
      kept = read.value && Array.isArray(read.value.groups) ? read.value.groups : []
    }
    const names = [
      ...kept.map((name) => groupName(name)),
      ...datasources.map((item) => groupName(item && item.group)),
    ].filter(Boolean)
    await writeJsonAtomic(
      registryFile,
      {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: isoNow(),
        groups: [...new Set(names)],
        datasources,
      },
      0o600,
    )
  }

  async function readSecrets() {
    const read = await readJson(secretsFile)
    const secrets = read.value && cleanRecord(read.value.secrets) ? read.value.secrets : {}
    return { secrets, error: read.error || null }
  }

  async function writeSecrets(secrets) {
    await writeJsonAtomic(secretsFile, { schemaVersion: SCHEMA_VERSION, secrets }, 0o600)
  }

  const settingsFile = join(dir, SETTINGS_FILE)
  const auditFile = join(dir, AUDIT_FILE)

  /** Row limits the agent falls back to when it does not name one. */
  const ROW_LIMIT_DEFAULTS = { sampleRows: 20, maxRows: 200 }
  const ROW_LIMIT_CAPS = { sampleRows: 200, maxRows: 2000 }

  function rowLimits(value) {
    const source = cleanRecord(value)
    const limits = {}
    for (const key of Object.keys(ROW_LIMIT_DEFAULTS)) {
      const raw = Number(source[key])
      limits[key] =
        Number.isInteger(raw) && raw >= 1 && raw <= ROW_LIMIT_CAPS[key] ? raw : ROW_LIMIT_DEFAULTS[key]
    }
    return limits
  }

  async function readSettings() {
    const read = await readJson(settingsFile)
    const value = cleanRecord(read.value)
    const port = Number(value.httpPort)
    return {
      file: settingsFile,
      error: read.error || null,
      // Writes stay off until somebody deliberately turns them on for a source.
      allowWrite: value.allowWrite === true,
      auditLog: value.auditLog !== false,
      // The HTTP endpoint is on by default: it is what outside MCP clients talk to.
      httpEnabled: value.httpEnabled !== false,
      disabledTools: Array.isArray(value.disabledTools)
        ? value.disabledTools
            .filter((name) => typeof name === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(name.trim()))
            .map((name) => name.trim())
            .slice(0, 32)
        : [],
      limits: rowLimits(value.limits),
      httpPort:
        Number.isInteger(port) && port >= HTTP_PORT_MIN && port <= HTTP_PORT_MAX ? port : HTTP_PORT_DEFAULT,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    }
  }

  async function writeSettings(patch) {
    const current = await readSettings()
    const port = Number(patch.httpPort === undefined ? current.httpPort : patch.httpPort)
    if (!Number.isInteger(port) || port < HTTP_PORT_MIN || port > HTTP_PORT_MAX) {
      return null
    }
    const next = {
      allowWrite: patch.allowWrite === undefined ? current.allowWrite : patch.allowWrite === true,
      auditLog: patch.auditLog === undefined ? current.auditLog : patch.auditLog === true,
      httpEnabled: patch.httpEnabled === undefined ? current.httpEnabled : patch.httpEnabled === true,
      disabledTools:
        patch.disabledTools === undefined
          ? current.disabledTools
          : (Array.isArray(patch.disabledTools) ? patch.disabledTools : [])
              .filter((name) => typeof name === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(name.trim()))
              .map((name) => name.trim())
              .slice(0, 32),
      limits: rowLimits(patch.limits === undefined ? current.limits : patch.limits),
      httpPort: port,
      updatedAt: isoNow(),
    }
    await writeJsonAtomic(settingsFile, next, 0o600)
    return { ...next, file: settingsFile, error: null }
  }

  const scopesFile = join(dir, SCOPES_FILE)

  async function readScopes() {
    const read = await readJson(scopesFile)
    const raw = read.value && cleanRecord(read.value.sessions) ? read.value.sessions : {}
    const sessions = {}
    for (const [session, entry] of Object.entries(raw)) {
      if (!session || !entry || typeof entry !== 'object') continue
      const ids = Array.isArray(entry.ids)
        ? entry.ids
            .filter((id) => typeof id === 'string' && id.trim())
            .map((id) => id.trim())
            .slice(0, MAX_SOURCES)
        : []
      sessions[session] = { ids, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null }
    }
    return { file: scopesFile, error: read.error || null, sessions }
  }

  async function writeScopes(sessions) {
    await writeJsonAtomic(scopesFile, { schemaVersion: SCHEMA_VERSION, sessions }, 0o600)
  }

  async function setSessionScope(sessionId, ids) {
    const session = String(sessionId || '').trim()
    if (!session) return { error: 'a conversation id is required' }
    const registry = await readRegistry()
    if (registry.error) return { error: registry.error }
    const known = new Set((registry.datasources || []).map((item) => item.id))
    const wanted = []
    for (const id of Array.isArray(ids) ? ids : []) {
      const clean = String(id || '').trim()
      if (!clean) continue
      if (!known.has(clean)) return { error: `unknown datasource: ${clean}` }
      if (!wanted.includes(clean)) wanted.push(clean)
    }
    const current = await readScopes()
    const sessions = { ...current.sessions }
    if (wanted.length === 0) delete sessions[session]
    else sessions[session] = { ids: wanted, updatedAt: isoNow() }
    await writeScopes(sessions)
    return { ids: wanted, sessions }
  }

  async function appendAudit(entry) {
    const settings = await readSettings()
    if (!settings.auditLog) return
    try {
      await mkdir(join(dir, 'logs'), { recursive: true })
      await writeFile(auditFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'a' })
      const info = await stat(auditFile).catch(() => null)
      if (info && info.size > AUDIT_LIMIT_BYTES) {
        await rename(auditFile, join(dir, 'logs', 'audit.1.jsonl')).catch(() => {})
      }
    } catch {
      // Auditing must never break a tool call.
    }
  }

  async function readAudit(limit = 20) {
    let raw
    try {
      raw = await readFile(auditFile, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return { entries: [], error: null }
      return { entries: [], error: String((error && error.message) || error) }
    }
    const entries = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line))
      } catch {
        // skip a torn line
      }
    }
    return { entries: entries.slice(-Math.max(1, Math.min(200, limit))).reverse(), error: null }
  }

  /** Where the editors and CLI agents keep their own MCP configuration. */
  function clientTargets() {
    const appData = process.env.APPDATA || ''
    const home = homedir()
    const list = []
    if (appData) {
      list.push({ id: 'vscode', label: 'Visual Studio Code', shape: 'vscode', file: join(appData, 'Code', 'User', 'mcp.json') })
      list.push({
        id: 'vscode-insiders',
        label: 'VS Code Insiders',
        shape: 'vscode',
        file: join(appData, 'Code - Insiders', 'User', 'mcp.json'),
      })
    }
    list.push({ id: 'cursor', label: 'Cursor', shape: 'mcpServers', file: join(home, '.cursor', 'mcp.json') })
    list.push({ id: 'claude-code', label: 'Claude Code', shape: 'mcpServers', file: join(home, '.claude.json') })
    if (appData) {
      list.push({
        id: 'claude-desktop',
        label: 'Claude Desktop',
        shape: 'mcpServers',
        file: join(appData, 'Claude', 'claude_desktop_config.json'),
      })
    }
    list.push({ id: 'codex', label: 'Codex CLI', shape: 'toml', file: join(home, '.codex', 'config.toml') })
    return list
  }

  async function readLoose(file) {
    try {
      return JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return null
    }
  }

  function httpUrlOf(settings) {
    const live = bridge.httpStatus()
    return live.url || `http://127.0.0.1:${settings.httpPort}/mcp`
  }

  /** Claude Desktop and Codex are happiest with a plain stdio entry. */
  async function stdioEntry() {
    const live = bridge.httpStatus()
    const venvPython = join(dir, '.venv', 'Scripts', 'python.exe')
    const venvPosix = join(dir, '.venv', 'bin', 'python')
    const interpreter =
      live.python ||
      (existsSync(venvPython) ? venvPython : existsSync(venvPosix) ? venvPosix : (await detectPython(config, pythonCache)))
    const entry = join(options.packageDir || fileURLToPath(new URL('..', import.meta.url)), 'server', 'main.py')
    return {
      command: interpreter || 'python',
      args: [entry],
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', DB_MCP_RUNTIME: dir },
    }
  }

  /** Drop one `[mcp_servers.<id>]` table (and its sub-tables) from a TOML file. */
  function dropTomlTable(text, name) {
    const lines = String(text || '').split('\n')
    const kept = []
    let skipping = false
    for (const line of lines) {
      const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
      if (header) skipping = header[1].trim() === name || header[1].trim().startsWith(`${name}.`)
      if (!skipping) kept.push(line)
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  }

  /**
   * Tell the panel whether each client is present and already pointed here.
   * Clients that cannot take an HTTP URL are reported with their stdio command,
   * so the same card can explain both cases.
   */
  async function inspectClients() {
    const settings = await readSettings()
    const url = httpUrlOf(settings)
    const clients = []
    for (const target of clientTargets()) {
      const exists = existsSync(target.file)
      let configured = false
      let current = null
      if (target.shape === 'toml') {
        const text = exists ? await readFile(target.file, 'utf8').catch(() => '') : ''
        configured = text.includes(`[mcp_servers.${CLIENT_ENTRY}]`) || text.includes(`[mcp_servers.${CLIENT_ENTRY}.`)
        const found = /\[mcp_servers\.dsh-db-mcp\][\s\S]*?url\s*=\s*"([^"]+)"/.exec(text)
        current = found ? found[1] : null
      } else {
        const parsed = exists ? await readLoose(target.file) : null
        const section = target.shape === 'vscode' ? parsed && parsed.servers : parsed && parsed.mcpServers
        const entry = section && section[CLIENT_ENTRY]
        configured = Boolean(entry)
        current = (entry && (entry.url || entry.serverUrl)) || null
      }
      clients.push({ id: target.id, label: target.label, file: target.file, shape: target.shape, exists, configured, current })
    }
    return { ok: true, url, settings, clients }
  }

  /**
   * Write one client's config entry. JSON clients get the HTTP endpoint; Claude
   * Desktop and Codex get a stdio entry so no port has to stay open for them.
   */
  async function configureClient(payload) {
    const id = trimmed(payload.client)
    const target = clientTargets().find((item) => item.id === id)
    if (!target) return { status: 404, body: { ok: false, error: `unknown client: ${id || '(empty)'}` } }
    const settings = await readSettings()
    const live = bridge.httpStatus()
    const url = httpUrlOf(settings)

    if (target.shape === 'toml') {
      const stdio = await stdioEntry()
      const block = [
        `[mcp_servers.${CLIENT_ENTRY}]`,
        `command = ${JSON.stringify(stdio.command)}`,
        `args = [${stdio.args.map((item) => JSON.stringify(item)).join(', ')}]`,
        '',
        `[mcp_servers.${CLIENT_ENTRY}.env]`,
        ...Object.entries(stdio.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
      ].join('\n')
      const existing = existsSync(target.file) ? await readFile(target.file, 'utf8').catch(() => '') : ''
      const cleaned = dropTomlTable(existing, `mcp_servers.${CLIENT_ENTRY}`)
      const next = `${cleaned ? `${cleaned}\n\n` : ''}${block}\n`
      await mkdir(dirname(target.file), { recursive: true }).catch(() => {})
      await writeFile(target.file, next, 'utf8')
      return {
        status: 200,
        body: { ok: true, client: target.id, label: target.label, file: target.file, transport: 'stdio', command: stdio.command },
      }
    }

    if (target.id === 'claude-desktop') {
      const stdio = await stdioEntry()
      const parsed = (await readLoose(target.file)) || {}
      const section = parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {}
      section[CLIENT_ENTRY] = { command: stdio.command, args: stdio.args, env: stdio.env }
      parsed.mcpServers = section
      await mkdir(dirname(target.file), { recursive: true }).catch(() => {})
      await writeFile(target.file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      return {
        status: 200,
        body: { ok: true, client: target.id, label: target.label, file: target.file, transport: 'stdio', command: stdio.command },
      }
    }

    if (!live.running) {
      return {
        status: 409,
        body: { ok: false, error: 'the HTTP endpoint is not running', hint: 'start it from the connection card, then configure the client again' },
      }
    }
    const parsed = (await readLoose(target.file)) || {}
    const sectionName = target.shape === 'vscode' ? 'servers' : 'mcpServers'
    const section = parsed[sectionName] && typeof parsed[sectionName] === 'object' ? parsed[sectionName] : {}
    section[CLIENT_ENTRY] = { type: 'http', url }
    parsed[sectionName] = section
    await mkdir(dirname(target.file), { recursive: true }).catch(() => {})
    await writeFile(target.file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    return {
      status: 200,
      body: { ok: true, client: target.id, label: target.label, file: target.file, transport: 'http', url, entry: section[CLIENT_ENTRY] },
    }
  }

  async function pythonEnv() {
    const python = await detectPython(config, pythonCache)
    const venvDir = join(dir, '.venv')
    const venvPython = join(venvDir, 'Scripts', 'python.exe')
    const venvPosix = join(venvDir, 'bin', 'python')
    const interpreter = existsSync(venvPython) ? venvPython : existsSync(venvPosix) ? venvPosix : null
    const requirements = join(options.packageDir || fileURLToPath(new URL('..', import.meta.url)), 'server', 'requirements.txt')
    let packages = null
    if (interpreter) {
      const script = [
        'import importlib.metadata as m',
        'out = []',
        "for name in ['mcp', 'psycopg', 'py-opengauss', 'PyMySQL', 'oracledb']:",
        '    try:',
        "        out.append(name + '=' + m.version(name))",
        '    except Exception:',
        "        out.append(name + '=missing')",
        "print(';'.join(out))",
      ].join('\n')
      const probe = await run(interpreter, ['-c', script], 20000)
      packages = probe.ok ? probe.stdout : null
    }
    return {
      ok: Boolean(interpreter),
      detected: python,
      venvDir,
      venvPython: interpreter,
      requirementsFile: requirements,
      requirementsPresent: existsSync(requirements),
      packages,
      error: interpreter ? null : 'no virtual environment at ' + venvDir,
    }
  }

  async function setupPython() {
    const python = await detectPython(config, pythonCache)
    if (!python.ok || !python.command) {
      return { status: 400, body: { ok: false, error: 'no usable Python interpreter was found on this machine' } }
    }
    const venvDir = join(dir, '.venv')
    const venvPython = process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python')
    const steps = []
    if (!existsSync(venvPython)) {
      const created = await run(python.command, ['-m', 'venv', venvDir], 180000)
      steps.push({ step: 'create venv', ok: created.ok, output: (created.stdout || created.stderr || created.error || '').slice(-2000) })
      if (!created.ok) return { status: 500, body: { ok: false, steps } }
    }
    const requirements = join(options.packageDir || fileURLToPath(new URL('..', import.meta.url)), 'server', 'requirements.txt')
    const install = await run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements], 600000)
    steps.push({ step: 'pip install -r server/requirements.txt', ok: install.ok, output: (install.stdout || install.stderr || install.error || '').slice(-4000) })
    if (install.ok) await bridge.restart().catch(() => {})
    return { status: install.ok ? 200 : 500, body: { ok: install.ok, steps, python: await pythonEnv() } }
  }

  async function listDatasources() {
    const registry = await readRegistry()
    const { secrets } = await readSecrets()
    return {
      file: registryFile,
      missing: registry.missing,
      error: registry.error,
      datasources: registry.datasources.map((item) => publicProfile(item, secrets)).filter(Boolean),
    }
  }

  async function health() {
    const listing = await listDatasources()
    const registry = await readRegistry()
    const python = await detectPython(config, pythonCache)
    const mcpState = bridge.status()
    if (mcpState.phase === 'idle') void ensureMcp()
    return {
      ok: listing.error === null,
      plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION, phase: 'P7' },
      host: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        pid: process.pid,
        startedAt: new Date(startedAt).toISOString(),
        uptimeMs: Date.now() - startedAt,
      },
      python,
      runtime: {
        dir,
        registryFile,
        registryMissing: listing.missing,
        registryError: listing.error,
        secretsFile,
        dbeaverRoots: dbeaverRoots(),
      },
      datasources: listing.datasources,
      groups: registry.groups || [],
      settings: await readSettings(),
      http: bridge.httpStatus(),
      mcp: {
        serverName: trimmed(config.mcpServerName) || 'db',
        wired: mcpState.phase === 'ready',
        phase: mcpState.phase,
        error: mcpState.error,
        tools: mcpState.tools,
        python: mcpState.python,
        command: mcpState.command,
        serverInfo: mcpState.serverInfo,
        startedAt: mcpState.startedAt,
        stderr: mcpState.stderr,
      },
    }
  }

  async function saveDatasource(payload) {
    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    const list = [...registry.datasources]
    const requestedId = trimmed(payload.id)
    const index = requestedId ? list.findIndex((item) => item.id === requestedId) : -1
    const existing = index >= 0 ? list[index] : null

    const normalized = normalizeInput(payload, existing)
    if (normalized.error) return { status: 400, body: { ok: false, error: normalized.error } }

    const profile = normalized.profile
    if (!existing && list.length >= MAX_SOURCES) {
      return { status: 400, body: { ok: false, error: `at most ${MAX_SOURCES} datasources are supported` } }
    }

    /* The same endpoint reached with the same login is one data source, not two:
       an agent that names it by host would otherwise have to guess which row it
       meant. Only creation is gated — rows that already exist (created before
       this rule) must stay editable and deletable. */
    if (!existing) {
      const identity = sourceIdentity(profile.kind, profile.config, profile.config.user)
      const twin = list.find(
        (item) => sourceIdentity(item.kind, item.config, item.config.user) === identity,
      )
      if (twin) {
        return {
          status: 409,
          body: {
            ok: false,
            error: `${twin.name || twin.id} already uses this connection and user`,
            existingId: twin.id,
          },
        }
      }
    }

    if (profile.isDefault || list.length === 0) {
      for (const item of list) item.isDefault = false
      profile.isDefault = true
    }
    if (!list.some((item) => item.isDefault)) profile.isDefault = true

    if (index >= 0) list[index] = profile
    else list.push(profile)

    await writeRegistry(list)

    const secretChange = {}
    if (normalized.password !== undefined) {
      const { secrets } = await readSecrets()
      if (normalized.password === '') {
        if (secrets[profile.id]) {
          delete secrets[profile.id]
          secretChange.cleared = true
        }
      } else {
        secrets[profile.id] = { password: normalized.password }
        secretChange.saved = true
      }
      await writeSecrets(secrets)
    }

    const { secrets } = await readSecrets()
    return { status: 200, body: { ok: true, datasource: publicProfile(profile, secrets), secret: secretChange } }
  }

  /**
   * One endpoint for the list checkboxes: delete, move to a group, flip the
   * read-only flag, or probe several sources in one call.
   */
  async function bulkDatasources(payload) {
    const action = trimmed(payload.action)
    const ids = Array.isArray(payload.ids) ? [...new Set(payload.ids.map((id) => trimmed(id)).filter(Boolean))] : []
    if (!['delete', 'group', 'readOnly', 'test'].includes(action)) {
      return { status: 400, body: { ok: false, error: `unsupported bulk action: ${action || '(empty)'}` } }
    }
    if (ids.length === 0) return { status: 400, body: { ok: false, error: 'ids must be a non-empty array' } }

    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    const known = new Set(registry.datasources.map((item) => item.id))
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length === ids.length) {
      return { status: 404, body: { ok: false, error: `unknown datasources: ${ids.join(', ')}` } }
    }
    const target = ids.filter((id) => known.has(id))

    if (action === 'delete') {
      const list = registry.datasources.filter((item) => !target.includes(item.id))
      if (list.length > 0 && !list.some((item) => item.isDefault)) list[0].isDefault = true
      await writeRegistry(list)
      const { secrets } = await readSecrets()
      let changed = false
      for (const id of target) {
        if (secrets[id]) {
          delete secrets[id]
          changed = true
        }
      }
      if (changed) await writeSecrets(secrets)
      return {
        status: 200,
        body: { ok: true, action, affected: target.length, datasources: list.map((item) => publicProfile(item, secrets)) },
      }
    }

    if (action === 'test') {
      const results = []
      for (const id of target) {
        const stored = registry.datasources.find((item) => item.id === id)
        const { secrets } = await readSecrets()
        const result = await testProfile(stored, secrets[id] || null, {
          probeTimeoutMs: Number(config.probeTimeoutMs) || 10_000,
          remote: remoteProbe,
        })
        const probe = { ok: result.ok, message: result.message, latencyMs: result.latencyMs, at: isoNow(), detail: result.detail || null }
        results.push({ id, probe })
      }
      const merged = registry.datasources.map((item) => {
        const hit = results.find((entry) => entry.id === item.id)
        return hit ? { ...item, lastProbe: hit.probe } : item
      })
      try {
        await writeRegistry(merged)
      } catch {
        /* the probe result still matters even if the note cannot be stored */
      }
      const { secrets } = await readSecrets()
      return {
        status: 200,
        body: {
          ok: true,
          action,
          affected: target.length,
          results,
          datasources: merged.map((item) => publicProfile(item, secrets)),
        },
      }
    }

    const next = registry.datasources.map((item) => {
      if (!target.includes(item.id)) return item
      if (action === 'group') return { ...item, group: trimmed(payload.group).slice(0, 48), updatedAt: isoNow() }
      return { ...item, readOnly: payload.readOnly !== false, updatedAt: isoNow() }
    })
    await writeRegistry(next)
    const { secrets } = await readSecrets()
    return {
      status: 200,
      body: { ok: true, action, affected: target.length, datasources: next.map((item) => publicProfile(item, secrets)) },
    }
  }

  /** Reorder the registry so the list keeps the order the user dragged it into. */
  async function reorderDatasources(payload) {
    const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => trimmed(id)).filter(Boolean) : []
    if (ids.length === 0) return { status: 400, body: { ok: false, error: 'ids must be a non-empty array' } }

    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    const byId = new Map(registry.datasources.map((item) => [item.id, item]))
    const ordered = []
    for (const id of ids) {
      const item = byId.get(id)
      if (!item) continue
      ordered.push(item)
      byId.delete(id)
    }
    for (const item of byId.values()) ordered.push(item)
    await writeRegistry(ordered, registry.groups)
    const { secrets } = await readSecrets()
    return {
      status: 200,
      body: { ok: true, datasources: ordered.map((item) => publicProfile(item, secrets)) },
    }
  }

  /**
   * User-created groups. A group is just a name shared by some sources, so
   * creating one writes an empty group, renaming rewrites the members and
   * deleting empties them.
   */
  async function listGroups() {
    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    return { status: 200, body: { ok: true, groups: registry.groups } }
  }

  async function saveGroup(payload) {
    const name = groupName(payload.name)
    const from = groupName(payload.from)
    if (!name) return { status: 400, body: { ok: false, error: 'group name is required' } }
    if (name.length > 48) return { status: 400, body: { ok: false, error: 'group name must be at most 48 characters' } }

    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    if (from && from !== name && !registry.groups.includes(from)) {
      return { status: 404, body: { ok: false, error: `unknown group: ${from}` } }
    }
    if (name !== from && registry.groups.includes(name)) {
      return { status: 400, body: { ok: false, error: `group already exists: ${name}` } }
    }

    const datasources = from && from !== name
      ? registry.datasources.map((item) => (groupName(item.group) === from ? { ...item, group: name, updatedAt: isoNow() } : item))
      : registry.datasources
    const groups = [...new Set(registry.groups.map((item) => (item === from ? name : item)).concat([name]))]
    await writeRegistry(datasources, groups)
    const { secrets } = await readSecrets()
    return {
      status: 200,
      body: { ok: true, groups, datasources: datasources.map((item) => publicProfile(item, secrets)) },
    }
  }

  async function deleteGroup(payload) {
    const name = groupName(payload.name)
    if (!name) return { status: 400, body: { ok: false, error: 'group name is required' } }
    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    if (!registry.groups.includes(name)) {
      return { status: 404, body: { ok: false, error: `unknown group: ${name}` } }
    }
    const datasources = registry.datasources.map((item) =>
      groupName(item.group) === name ? { ...item, group: '', updatedAt: isoNow() } : item,
    )
    const groups = registry.groups.filter((item) => item !== name)
    await writeRegistry(datasources, groups)
    const { secrets } = await readSecrets()
    return {
      status: 200,
      body: { ok: true, groups, datasources: datasources.map((item) => publicProfile(item, secrets)) },
    }
  }

  async function deleteDatasource(payload) {
    const id = trimmed(payload.id)
    if (!id) return { status: 400, body: { ok: false, error: 'id is required' } }
    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    const list = registry.datasources.filter((item) => item.id !== id)
    if (list.length === registry.datasources.length) {
      return { status: 404, body: { ok: false, error: `unknown datasource: ${id}` } }
    }
    if (list.length > 0 && !list.some((item) => item.isDefault)) list[0].isDefault = true
    await writeRegistry(list)
    const { secrets } = await readSecrets()
    if (secrets[id]) {
      delete secrets[id]
      await writeSecrets(secrets)
    }
    return { status: 200, body: { ok: true, removed: id, datasources: list.map((item) => publicProfile(item, secrets)) } }
  }

  /**
   * Read-only schema browsing for the panel (P7). It only calls list_tables and
   * describe_table, so it can never run SQL.
   */
  async function inspectSchema(search) {
    const id = trimmed(search.get('datasource'))
    if (!id) return [400, { ok: false, error: 'datasource is required' }]
    const registry = await readRegistry()
    if (registry.error) return [500, { ok: false, error: registry.error }]
    const profile = registry.datasources.find((item) => item.id === id) || null
    if (!profile) return [404, { ok: false, error: `unknown datasource: ${id}` }]
    const table = trimmed(search.get('table'))
    const schema = trimmed(search.get('schema'))
    const target = describeTarget(profile.kind, profile.config)

    try {
      if (!table) {
        const args = schema ? { datasource: id, schema } : { datasource: id }
        const result = await bridge.call('list_tables', args, { audit: false })
        const value = result.value || {}
        if (value.ok === false) {
          return [200, { ok: false, datasource: id, target, error: value.error || { message: 'list_tables failed' } }]
        }
        return [200, { ok: true, datasource: id, target, tables: value.tables || [] }]
      }
      const args = schema ? { datasource: id, table, schema } : { datasource: id, table }
      const result = await bridge.call('describe_table', args, { audit: false })
      const value = result.value || {}
      if (value.ok === false) {
        return [200, { ok: false, datasource: id, target, table, error: value.error || { message: 'describe_table failed' } }]
      }
      return [
        200,
        {
          ok: true,
          datasource: id,
          target,
          table: value.table || table,
          schema: value.schema || null,
          columns: value.columns || [],
          primaryKey: value.primaryKey || [],
        },
      ]
    } catch (error) {
      return [
        503,
        {
          ok: false,
          error: String((error && error.message) || error),
          hint: 'start the MCP server from the panel and try again',
        },
      ]
    }
  }

  async function remoteProbe(profile, password) {    const args = profile.id
      ? { datasource: profile.id }
      : { kind: profile.kind, config: profile.config, read_only: Boolean(profile.readOnly) }
    if (password) args.password = password
    const result = await bridge.call('test_connection', args, { audit: false })
    return result.value
  }

  async function testDatasource(payload) {
    const probeOptions = {
      probeTimeoutMs: Number(config.probeTimeoutMs) || 10_000,
      remote: remoteProbe,
    }
    const id = trimmed(payload.id)
    const registry = await readRegistry()
    const stored = id ? registry.datasources.find((item) => item.id === id) || null : null

    let profile
    if (payload.kind && payload.config) {
      const normalized = normalizeInput({ ...payload, id: id || 'probe' }, null)
      if (normalized.error) return { status: 400, body: { ok: false, error: normalized.error } }
      profile = normalized.profile
      profile.id = (stored && stored.id) || null
    } else if (stored) {
      profile = stored
    } else {
      return { status: 404, body: { ok: false, error: `unknown datasource: ${id || '(none)'}` } }
    }

    const { secrets } = await readSecrets()
    // An inline probe has no registry entry, so the password typed into the form
    // is the only one available; a saved source keeps using its stored secret.
    const supplied = typeof payload.password === 'string' ? payload.password : ''
    const secret = profile.id ? secrets[profile.id] : supplied ? { password: supplied } : null
    const result = await testProfile(profile, secret, probeOptions)
    const probe = {
      ok: result.ok,
      message: result.message,
      latencyMs: result.latencyMs,
      at: isoNow(),
      detail: result.detail || null,
    }

    if (stored) {
      const list = registry.datasources.map((item) =>
        item.id === stored.id ? { ...item, lastProbe: probe } : item,
      )
      try {
        await writeRegistry(list)
      } catch {
        /* a failed note must not fail the probe itself */
      }
    }
    return { status: 200, body: { ok: true, probe, target: result.target || describeTarget(profile.kind, profile.config) } }
  }

  async function importDatasources(payload) {
    const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => trimmed(id)).filter(Boolean) : []
    if (ids.length === 0) return { status: 400, body: { ok: false, error: 'ids is required' } }
    const registry = await readRegistry()
    if (registry.error) return { status: 500, body: { ok: false, error: registry.error } }
    const scan = await scanDBeaver({ withSecrets: true, existing: registry.datasources })
    const available = scan.sources.flatMap((source) =>
      source.connections.filter((item) => item.importable).map((item) => ({ ...item })),
    )
    const list = [...registry.datasources]
    const { secrets } = await readSecrets()
    const imported = []
    const skipped = []
    const failed = []
    const warnings = []

    // Same endpoint + database + account means the source is already here.
    const identities = new Map()
    for (const profile of list) {
      identities.set(sourceIdentity(profile.kind, profile.config, profile.config && profile.config.user), profile.id)
    }

    for (const id of ids) {
      const found = available.find((item) => item.id === id)
      if (!found) {
        failed.push({ id, error: 'not found in DBeaver' })
        continue
      }
      const identity = sourceIdentity(found.kind, found.config, found.config && found.config.user)
      const clash = identities.get(identity)
      if (clash) {
        skipped.push({ id, existingId: clash })
        continue
      }
      const slug = (trimmed(found.name) || id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'imported'
      let candidate = slug
      let counter = 2
      while (list.some((item) => item.id === candidate)) {
        candidate = `${slug.slice(0, 27)}-${counter++}`
      }

      const profile = {
        id: candidate,
        name: String(found.name || candidate).slice(0, 64),
        kind: found.kind,
        config: found.config,
        readOnly: true,
        isDefault: list.length === 0,
        tags: ['dbeaver'],
        createdAt: isoNow(),
        updatedAt: isoNow(),
        lastProbe: null,
      }
      list.push(profile)
      identities.set(identity, candidate)
      if (found.password) secrets[candidate] = { password: found.password }
      if (profile.kind !== 'sqlite' && !trimmed(profile.config && profile.config.user)) {
        warnings.push({
          id: candidate,
          message: 'DBeaver stored no user for this connection; open Edit and fill it in',
        })
      }
      if (profile.kind !== 'sqlite' && found.hasPassword === false) {
        warnings.push({
          id: candidate,
          message: 'DBeaver did not save a password for this connection; the source was imported without one',
        })
      }
      imported.push({ ...publicProfile(profile, secrets), sourceId: id })
    }

    if (imported.length > 0) {
      await writeRegistry(list)
      await writeSecrets(secrets)
    }
    return {
      status: 200,
      body: {
        ok: failed.length === 0,
        imported,
        skipped,
        failed,
        warnings,
        datasources: list.map((item) => publicProfile(item, secrets)),
      },
    }
  }

  async function handle(request, response) {
    let route = '/'
    try {
      const url = new URL(request.url, 'http://localhost')
      route = url.pathname.slice(API_PREFIX.length) || '/'
    } catch {
      return sendJson(response, 400, { ok: false, error: 'unreadable request url' })
    }
    const method = (request.method || 'GET').toUpperCase()

    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(request)) {
      return sendJson(response, 403, { ok: false, error: 'cross-origin write rejected' })
    }

    try {
      if (method === 'GET' || method === 'HEAD') {
        if (route === '/' || route === '/health') return sendJson(response, 200, await health())
        if (route === '/datasources') {
          const listing = await listDatasources()
          return sendJson(response, 200, { ok: listing.error === null, ...listing })
        }
        if (route === '/groups') {
          const result = await listGroups()
          return sendJson(response, result.status, result.body)
        }
        if (route === '/dbeaver/scan') {
          const registry = await readRegistry()
          return sendJson(response, 200, { ok: true, ...(await scanDBeaver({ existing: registry.datasources })) })
        }
        if (route === '/schema') {
          const search = new URL(request.url, 'http://localhost').searchParams
          return sendJson(response, ...(await inspectSchema(search)))
        }
        if (route === '/settings') return sendJson(response, 200, { ok: true, settings: await readSettings() })
        if (route === '/tools') {
          const settingsNow = await readSettings()
          const listing = bridge.toolCatalog()
          return sendJson(response, 200, {
            ok: true,
            disabled: settingsNow.disabledTools || [],
      limits: settingsNow.limits,
            tools: listing.tools,
            scopeTool: listing.scopeTool,
          })
        }
        if (route === '/scopes') {
          const listing = await readScopes()
          return sendJson(response, 200, {
            ok: listing.error === null,
            file: listing.file,
            error: listing.error,
            sessions: Object.entries(listing.sessions).map(([session, entry]) => ({ session, ...entry })),
          })
        }
        if (route === '/audit') {
          const limit = Math.min(200, Math.max(1, Number(new URL(request.url, 'http://localhost').searchParams.get('limit')) || 20))
          const listing = await readAudit(limit)
          return sendJson(response, 200, { ok: listing.error === null, file: auditFile, ...listing })
        }
        if (route === '/python/env' || route === '/python/status') return sendJson(response, 200, { ok: true, ...(await pythonEnv()) })
        if (route === '/http/status') {
          const settings = await readSettings()
          return sendJson(response, 200, { ok: true, settings, ...bridge.httpStatus() })
        }
        if (route === '/clients') return sendJson(response, 200, await inspectClients())
        if (route === '/mcp/status') {
          const state = bridge.status()
          return sendJson(response, 200, { ok: state.phase !== 'failed', ...state })
        }
        return sendJson(response, 404, { ok: false, error: `unknown route: ${method} ${route}` })
      }

      if (method !== 'POST') return sendJson(response, 405, { ok: false, error: `method not allowed: ${method}` })

      let payload
      try {
        payload = await readBody(request)
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: String((error && error.message) || error) })
      }

      if (route === '/datasources/save') {
        const result = await saveDatasource(payload)
        if (result.status === 200) void bridge.restart().catch(() => {})
        return sendJson(response, result.status, result.body)
      }
      if (route === '/datasources/delete') {
        const result = await deleteDatasource(payload)
        if (result.status === 200) void bridge.restart().catch(() => {})
        return sendJson(response, result.status, result.body)
      }
      if (route === '/datasources/test') {
        const result = await testDatasource(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/datasources/bulk') {
        const result = await bulkDatasources(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/groups/save') {
        const result = await saveGroup(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/groups/delete') {
        const result = await deleteGroup(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/datasources/reorder') {
        const result = await reorderDatasources(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/dbeaver/import') {
        const result = await importDatasources(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/settings') {
        const settings = await writeSettings({
          allowWrite: payload.allowWrite,
          auditLog: payload.auditLog,
          disabledTools: payload.disabledTools,
        limits: payload.limits,
          httpEnabled: payload.httpEnabled,
          httpPort: payload.httpPort,
        })
        if (!settings) return sendJson(response, 400, { ok: false, error: 'httpPort must be an integer between 1024 and 65535' })
        if (
        payload.allowWrite !== undefined ||
        payload.disabledTools !== undefined ||
        payload.limits !== undefined
      ) {
          void bridge.restart().catch(() => {})
        }
        return sendJson(response, 200, { ok: true, settings })
      }
      if (route === '/scopes') {
        const result = await setSessionScope(payload.session, payload.datasources)
        if (result.error) return sendJson(response, 400, { ok: false, error: result.error })
        return sendJson(response, 200, {
          ok: true,
          session: String(payload.session || ''),
          datasources: result.ids,
          sessions: Object.entries(result.sessions || {}).map(([session, entry]) => ({ session, ...entry })),
        })
      }
      if (route === '/python/setup') {
        const result = await setupPython()
        return sendJson(response, result.status, result.body)
      }
      if (route === '/http/start') {
        const current = await readSettings()
        const port = Number(payload.port) || current.httpPort
        const saved = await writeSettings({ httpPort: port })
        if (!saved) return sendJson(response, 400, { ok: false, error: `port must be between ${HTTP_PORT_MIN} and ${HTTP_PORT_MAX}` })
        const http = await bridge.startHttp({ port: saved.httpPort })
        const ok = http.running === true
        return sendJson(response, ok ? 200 : 500, { ok, http, settings: saved })
      }
      if (route === '/http/stop') {
        const http = bridge.stopHttp()
        return sendJson(response, 200, { ok: true, http })
      }
      if (route === '/clients/configure') {
        const result = await configureClient(payload)
        return sendJson(response, result.status, result.body)
      }
      if (route === '/mcp/start' || route === '/mcp/restart') {
        const state = route === '/mcp/start' ? await ensureMcp() : await bridge.restart().catch((error) => ({ ...bridge.status(), phase: 'failed', error: String((error && error.message) || error) }))
        return sendJson(response, state.phase === 'ready' ? 200 : 500, { ok: state.phase === 'ready', ...state })
      }
      if (route === '/mcp/call') {
        const tool = trimmed(payload.tool)
        if (!tool) return sendJson(response, 400, { ok: false, error: 'tool is required' })
        try {
          const state = await ensureMcp()
          if (state.phase !== 'ready') return sendJson(response, 500, { ok: false, error: state.error || 'server not running', ...state })
          const callArgs = payload.arguments && typeof payload.arguments === 'object' ? { ...payload.arguments } : {}
          const source = trimmed(payload.datasource)
          if (source && callArgs.datasource === undefined) callArgs.datasource = source
          const result = await bridge.call(tool, callArgs)
          return sendJson(response, 200, { ok: true, ...result })
        } catch (error) {
          return sendJson(response, 500, { ok: false, error: String((error && error.message) || error) })
        }
      }
      return sendJson(response, 404, { ok: false, error: `unknown route: ${method} ${route}` })
    } catch (error) {
      return sendJson(response, 500, { ok: false, error: String((error && error.message) || error) })
    }
  }

  // Publish the MCP tools as soon as the host half mounts, so the agent can use
  // them even if nobody opens the Database panel.
  void ensureMcp()

  // Outside clients (VS Code, Cursor, Codex) need a URL rather than stdio, so the
  // HTTP half starts too unless the user switched it off in settings. It only
  // starts inside a live plugin: a bare createHost() call (tests, probes) must not
  // leave a Python child behind that keeps the process alive.
  if (options.ctx) {
    void readSettings()
      .then((settings) => (settings.httpEnabled ? bridge.startHttp({ port: settings.httpPort }) : null))
      .catch(() => null)
  }

  return {
    version: PLUGIN_VERSION,
    handle,
    __test: { parseJdbcUrl, parseOracleUrl, mapDBeaverConnection, sourceIdentity, hostsOf, endpointLabel },
    dispose: async () => {
      await bridge.dispose()
    },
  }
}
