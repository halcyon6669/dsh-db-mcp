/**
 * Bridges the Python MCP server into DSH tools.
 *
 * The Python process is spawned lazily on first use, its `tools/list` becomes
 * `mcp__db__<name>` on the host `tools` service, and every call is forwarded over
 * MCP. When a datasource changes the bridge can be restarted; tool registrations
 * are disposed and rebuilt around the new process.
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';

// Same cache-busting marker as host.js, so editing this file takes effect on the
// next `POST /api/reload` without restarting DSH.
const GENERATION = new URL(import.meta.url).searchParams.get('v') || '0';
const { McpClient, McpError, childEnvironment } = await import(new URL(`./mcp.js?v=${GENERATION}`, import.meta.url).href);

export const TOOL_PREFIX = 'mcp__db__';
/** Path the streamable-HTTP transport answers on; kept in one place. */
const HTTP_PATH = '/dsh-db-mcp';
const TOOL_TIMEOUT_MS = 60_000;

/** Candidate interpreters, most specific first. */
export function pythonCandidates(config, runtimeDir) {
  const list = [];
  if (config.pythonPath) list.push(config.pythonPath);
  list.push(join(runtimeDir, '.venv', 'Scripts', 'python.exe')); // Windows venv
  list.push(join(runtimeDir, '.venv', 'bin', 'python')); // POSIX venv
  list.push('python');
  list.push('python3');
  return list.filter((entry, index) => entry && list.indexOf(entry) === index);
}

export function serverEntry(packageDir) {
  return join(packageDir, 'server', 'main.py');
}

/** Render the answer of the session-scope tool. */
export function renderScope(value) {
  if (!value || typeof value !== 'object') return String(value);
  if (value.ok === false && value.error) return `error [${value.error.code || 'error'}]: ${value.error.message || 'unknown error'}`;
  if (value.all === true) return 'this conversation may use every data source';
  const ids = Array.isArray(value.datasources) ? value.datasources : [];
  if (ids.length === 0) return 'this conversation may use every data source';
  return `this conversation may only use: ${ids.join(', ')}`;
}

/** Render one MCP tool result as readable text. */
export function renderResult(value) {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : JSON.stringify(value);
  if (value.ok === false && value.error) {
    const { code = 'error', message = 'unknown error', hint } = value.error;
    return `error [${code}]: ${message}${hint ? `\n${hint}` : ''}`;
  }
  if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
    if (typeof value.affectedRows === 'number' && value.columns.length === 0) {
      return `ok: ${value.affectedRows} row(s) affected, ${value.elapsedMs}ms`;
    }
    const head = value.columns.join(' | ');
    const body = value.rows
      .slice(0, 50)
      .map((row) => row.map((cell) => (cell === null ? 'NULL' : String(cell))).join(' | '))
      .join('\n');
    const more = value.rows.length > 50 ? `\n… ${value.rows.length - 50} more row(s)` : '';
    const note = value.truncated ? `\ntruncated at ${value.rowCount} row(s)` : '';
    return `${head}\n${'-'.repeat(Math.min(head.length, 120))}\n${body}${more}${note}\n(${value.rowCount} row(s), ${value.elapsedMs}ms)`;
  }
  if (Array.isArray(value.tables)) {
    const lines = value.tables.map((table) => `${table.schema ? `${table.schema}.` : ''}${table.name}  [${table.type}]`);
    const more = value.truncated ? `\n… truncated (${value.total} total)` : '';
    return lines.join('\n') + more || 'no tables';
  }
  if (Array.isArray(value.datasources)) {
    return (
      value.datasources
        .map((source) => `${source.id}  ${source.kind}  ${source.target}${source.readOnly ? '  [read-only]' : ''}${source.isDefault ? '  [default]' : ''}`)
        .join('\n') || 'no datasources configured'
    );
  }
  if (typeof value.ddl === 'string' && value.ddl.trim()) {
    return value.ddl.trim();
  }
  if (Array.isArray(value.columns) && value.table) {
    return value.columns.map((column) => `${column.name}  ${column.type}${column.primaryKey ? '  PK' : ''}${column.nullable ? '' : '  NOT NULL'}`).join('\n');
  }
  return JSON.stringify(value, null, 2);
}

/**
 * MCP emits `anyOf: [{type:'string'}, {type:'null'}]` plus `default: null` and a
 * `title` for every optional argument. That is valid JSON Schema but noisy for the
 * model, so each property is reduced to its real branch before registration.
 */
function simplifyProperty(property) {
  if (!property || typeof property !== 'object') return property;
  const { title: _title, default: _default, ...rest } = property;
  if (Array.isArray(rest.anyOf)) {
    const branch = rest.anyOf.find((item) => item && item.type && item.type !== 'null') ?? { type: 'string' };
    const merged = { ...branch };
    if (rest.description) merged.description = rest.description;
    return simplifyProperty(merged);
  }
  if (Array.isArray(rest.oneOf)) {
    const branch = rest.oneOf.find((item) => item && item.type && item.type !== 'null') ?? { type: 'string' };
    const merged = { ...branch };
    if (rest.description) merged.description = rest.description;
    return simplifyProperty(merged);
  }
  if (rest.type === 'array' && rest.items) rest.items = simplifyProperty(rest.items);
  return rest;
}

function safeParameters(inputSchema) {
  const schema = inputSchema && typeof inputSchema === 'object' ? inputSchema : {};
  const source = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const properties = {};
  for (const [key, value] of Object.entries(source)) properties[key] = simplifyProperty(value);
  const parameters = { type: 'object', properties, additionalProperties: schema.additionalProperties === true };
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    parameters.required = schema.required.filter((name) => Object.prototype.hasOwnProperty.call(properties, name));
  }
  return parameters;
}

/**
 * @param {object} options
 * @param {any} options.ctx host context (needs `tools` and `logger`/`console`)
 * @param {object} options.config plugin config
 * @param {string} options.packageDir plugin package root (holds `server/`)
 * @param {string} options.runtimeDir data directory (holds `.venv`, registry)
 */
export function createBridge({
  ctx,
  config = {},
  packageDir,
  runtimeDir,
  log = () => {},
  settings = null,
  audit = null,
  scope = null,
  setScope = null,
}) {
  let client = null;
  let starting = null;
  let disposers = [];
  // Names of the tools currently published for this bridge instance.
  let registeredNames = [];
  // Bumped by restart()/dispose(): an in-flight boot started under an older epoch
  // must not register its tools into a host that is already being torn down.
  let bootEpoch = 0;
  let state = { phase: 'idle', error: null, tools: [], serverInfo: null, startedAt: null };
  /** Tool names the user switched off in the panel; kept out of the registry. */
  let disabledTools = [];
  /** Everything the Python server advertised, so the panel can list it even when off. */
  let catalog = [];
  /**
   * The optional HTTP side. DSH itself speaks stdio; other MCP clients (VS Code,
   * Cursor, Codex, Claude Desktop) want a URL, so this keeps one more Python
   * process serving `streamable-http` on /mcp over the same registry.
   */
  let httpState = { child: null, port: null, host: null, python: null, startedAt: null, error: null, stderr: '' };

  function toolsService() {
    if (!ctx) return undefined;
    try {
      if (typeof ctx.get === 'function') return ctx.get('tools');
      return ctx.tools;
    } catch {
      return undefined;
    }
  }

  function status() {
    return {
      phase: state.phase,
      error: state.error,
      toolCount: state.tools.length,
      tools: state.tools,
      scopeTool: scopeDisposer !== null,
      serverInfo: state.serverInfo,
      startedAt: state.startedAt,
      command: state.command ?? null,
      python: state.python ?? null,
      exit: client?.exitInfo ?? null,
      stderr: client?.stderrTail ?? '',
      http: httpStatus(),
    };
  }

  function auditEntry(name, args, startedAt, outcome, error) {
    if (!audit) return;
    const call = args && typeof args === 'object' ? args : {};
    const entry = {
      at: new Date().toISOString(),
      tool: `${TOOL_PREFIX}${name}`,
      datasource: typeof call.datasource === 'string' ? call.datasource : null,
      ok: !error && !(outcome && outcome.isError === true),
      ms: Date.now() - startedAt,
    };
    if (typeof call.sql === 'string') entry.sql = call.sql.slice(0, 2000);
    if (typeof call.table === 'string') entry.table = call.table;
    if (error) entry.error = String((error && error.message) || error);
    else {
      const parsed = outcome && outcome.parsed;
      // A write reports how many rows it touched; a read reports how many came back.
      const rows = parsed && (parsed.affectedRows ?? parsed.rowCount ?? (Array.isArray(parsed.rows) ? parsed.rows.length : undefined));
      if (typeof rows === 'number') entry.rows = rows;
      if (parsed && parsed.error && parsed.error.code) entry.code = parsed.error.code;
    }
    try {
      void audit(entry);
    } catch {
      // never let auditing break a call
    }
  }

  async function invoke(name, args = {}, options = {}) {
    const startedAt = Date.now();
    const audited = options.audit !== false;
    try {
      await ensure();
      const active = client;
      if (!active || !active.running) {
        throw new McpError('the database MCP server is not running', { code: 'not_running' });
      }
      const result = await active.callTool(name, withRowLimit(name, args), {
        timeoutMs: TOOL_TIMEOUT_MS,
      });
      if (audited) auditEntry(name, args, startedAt, result, null);
      return result;
    } catch (error) {
      if (audited) auditEntry(name, args, startedAt, null, error);
      throw error;
    }
  }

  /**
   * The data sources this conversation is limited to, or null when it may use
   * everything. A missing entry and an empty id list both mean "no limit".
   */
  async function allowedSources(exec) {
    if (!scope) return null;
    const session = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '';
    if (!session) return null;
    const listing = await scope().catch(() => null);
    const entry = listing && listing.sessions ? listing.sessions[session] : null;
    const ids = entry && Array.isArray(entry.ids) ? entry.ids : [];
    return ids.length === 0 ? null : ids;
  }

  function scopeError(allowed, detail) {
    return {
      ok: false,
      error: {
        code: 'user_error',
        message: `this conversation may only use: ${allowed.join(', ')}${detail ? ` — ${detail}` : ''}`,
      },
    };
  }

  /** Rewrite the target of a call so it can only name an allowed source. */
  function applyScope(allowed, toolName, call) {
    if (!allowed) return { args: call };
    if (toolName === 'list_datasources') return { args: call };
    const requested = typeof call.datasource === 'string' ? call.datasource.trim() : '';
    if (!requested) {
      if (toolName === 'test_connection') {
        return { error: scopeError(allowed, 'pass one of those identifiers instead of an inline connection') };
      }
      if (allowed.length === 1) return { args: { ...call, datasource: allowed[0] } };
      return { error: scopeError(allowed, 'name one of them with the `datasource` argument') };
    }
    if (!allowed.includes(requested)) return { error: scopeError(allowed, `${requested} is out of scope`) };
    return { args: call };
  }

  let scopeDisposer = null;

  /** A native (non-MCP) tool the model calls to scope one conversation. */
  function registerScopeTool(service) {
    if (scopeDisposer || !setScope) return;
    try {
      scopeDisposer = service.register({
        name: `${TOOL_PREFIX}session_scope`,
        description:
          'Limit which data sources this conversation may use, by identifier. Call it when the user asks to restrict the current conversation to certain data sources, or to lift that restriction again. Without a saved limit every data source is reachable.',
        parameters: {
          type: 'object',
          properties: {
            datasources: {
              type: 'array',
              items: { type: 'string' },
              description: 'Identifiers that this conversation keeps. An empty array clears the limit.',
            },
            all: { type: 'boolean', description: 'true clears the limit so every data source is reachable again.' },
          },
          additionalProperties: false,
        },
        timeoutMs: TOOL_TIMEOUT_MS,
        isConcurrencySafe: () => true,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: renderScope(value) }],
        },
        execute: async (args, exec) => {
          const call = args && typeof args === 'object' ? args : {};
          const session = exec && exec.agent && exec.agent.id ? String(exec.agent.id) : '';
          if (!session) {
            return { ok: false, error: { code: 'user_error', message: 'this tool only runs inside a conversation' } };
          }
          const current = await allowedSources(exec);
          if (call.all === true) {
            const saved = await setScope(session, []);
            if (saved && saved.error) return { ok: false, error: { code: 'user_error', message: saved.error } };
            return { ok: true, session, datasources: [], all: true };
          }
          const wanted = Array.isArray(call.datasources)
            ? call.datasources.map((id) => String(id || '').trim()).filter(Boolean)
            : [];
          if (wanted.length === 0) {
            return { ok: true, session, datasources: current || [], all: current === null };
          }
          const saved = await setScope(session, wanted);
          if (saved && saved.error) return { ok: false, error: { code: 'user_error', message: saved.error } };
          return { ok: true, session, datasources: saved.ids, all: false };
        },
      });
    } catch (error) {
      log(`register session_scope failed: ${error}`);
    }
  }

  function isOff(name) {
    return disabledTools.includes(name);
  }

  /**
   * Row limits the agent gets when it does not name one. The panel edits these;
   * the model can still override them per call inside the server's hard cap.
   */
  const ROW_LIMIT_TOOLS = {
    sample_rows: { key: 'sampleRows', argument: 'limit', min: 1, max: 200 },
    execute_sql: { key: 'maxRows', argument: 'max_rows', min: 1, max: 2000 },
  };

  let rowLimits = { sampleRows: 20, maxRows: 200 };

  function withRowLimit(name, args) {
    const rule = ROW_LIMIT_TOOLS[name];
    if (!rule) return args;
    const explicit = args[rule.argument];
    if (explicit !== undefined && explicit !== null && explicit !== '') return args;
    const value = rowLimits[rule.key];
    if (!Number.isInteger(value)) return args;
    return { ...args, [rule.argument]: value };
  }

  /**
   * What the panel shows: every tool the server offers, its purpose, and whether
   * it is currently published to the agent.
   */
  function toolCatalog() {
    const tools = catalog.map((tool) => {
      const rule = ROW_LIMIT_TOOLS[tool.name];
      return {
        name: tool.name,
        full: `${TOOL_PREFIX}${tool.name}`,
        description: tool.description || '',
        parameters: safeParameters(tool.inputSchema),
        enabled: !isOff(tool.name),
        limit: rule
          ? {
              key: rule.key,
              argument: rule.argument,
              value: rowLimits[rule.key],
              min: rule.min,
              max: rule.max,
            }
          : null,
      };
    });
    return { tools, scopeTool: scopeDisposer !== null, disabled: [...disabledTools] };
  }

  function registerTools(all) {
    const tools = all.filter((tool) => !isOff(tool.name));
    catalog = all;
    const service = toolsService();
    if (!service || typeof service.register !== 'function') {
      throw new McpError(
        'the host `tools` service is unavailable, so the MCP tools cannot be published',
        { code: 'no_tools_service' },
      );
    }
    const names = tools.map((tool) => `${TOOL_PREFIX}${tool.name}`);
    // Restarting the Python process must not churn the tool catalog: the agent
    // resolves these names through the registry, so a dispose/re-register pair
    // would make a live call fail with `unknown tool`. Keep the registrations
    // and let `execute` follow the current client instead.
    if (disposers.length === names.length && names.every((name, index) => registeredNames[index] === name)) {
      state.tools = tools.map((tool) => tool.name);
      registerScopeTool(service);
      return;
    }
    disposeTools();
    disposers = tools.map((tool) => {
      const name = `${TOOL_PREFIX}${tool.name}`;
      const description = `${tool.description || tool.name}\n\n(PostgreSQL/MySQL/Oracle/SQLite via the DSH Database panel; source is chosen with the \`datasource\` argument.)`;
      return service.register({
        name,
        description,
        parameters: safeParameters(tool.inputSchema),
        timeoutMs: TOOL_TIMEOUT_MS,
        isConcurrencySafe: () => true,
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
        },
        execute: async (args, exec) => {
          const call = args && typeof args === 'object' ? args : {};
          const allowed = await allowedSources(exec);
          const scoped = applyScope(allowed, tool.name, call);
          if (scoped.error) return scoped.error;
          const result = await invoke(tool.name, scoped.args);
          let value = result.parsed;
          if (!value) value = result.text ? { ok: true, text: result.text } : { ok: true, content: result.content ?? [] };
          if (allowed && tool.name === 'list_datasources' && Array.isArray(value.datasources)) {
            value.datasources = value.datasources.filter((item) => allowed.includes(String(item && item.id)));
            value.scope = allowed;
          }
          return value;
        },
      });
    });
    registeredNames = names;
    registerScopeTool(service);
    state.tools = tools.map((tool) => tool.name);
  }

  function disposeTools() {
    registeredNames = [];
    if (scopeDisposer) {
      try {
        scopeDisposer();
      } catch (error) {
        log(`dispose session_scope failed: ${error}`);
      }
      scopeDisposer = null;
    }
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        log(`dispose tool failed: ${error}`);
      }
    }
    state.tools = [];
  }

  async function boot() {
    const myEpoch = ++bootEpoch;
    const entry = serverEntry(packageDir);
    if (!existsSync(entry)) {
      throw new McpError(`server/main.py not found under ${packageDir}`, { code: 'server_missing' });
    }
    const current = settings ? await settings().catch(() => ({ allowWrite: false })) : { allowWrite: false };
    const allowWrite = current && current.allowWrite === true;
    disabledTools = Array.isArray(current && current.disabledTools)
      ? current.disabledTools.map((name) => String(name || '').trim()).filter(Boolean)
      : [];
    const limits = current && current.limits ? current.limits : {};
    rowLimits = {
      sampleRows: Number.isInteger(limits.sampleRows) ? limits.sampleRows : 20,
      maxRows: Number.isInteger(limits.maxRows) ? limits.maxRows : 200,
    };
    const candidates = pythonCandidates(config, runtimeDir);
    let lastError = null;
    for (const candidate of candidates) {
      if (myEpoch !== bootEpoch) throw new McpError('start superseded', { code: 'superseded' });
      if (candidate.includes('\\') || candidate.includes('/')) {
        if (!existsSync(candidate)) continue;
      }
      const next = new McpClient({
        command: candidate,
        args: [entry],
        cwd: join(packageDir, 'server'),
        env: {
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          DB_MCP_RUNTIME: runtimeDir,
          DB_MCP_ALLOW_WRITE: allowWrite ? '1' : '0',
        },
        label: `db-mcp (${candidate})`,
      });
      try {
        await next.start();
      } catch (error) {
        lastError = error;
        await next.stop();
        log(`start failed with ${candidate}: ${error?.message ?? error}`);
        continue;
      }
      if (myEpoch !== bootEpoch) {
        await next.stop();
        throw new McpError('start superseded', { code: 'superseded' });
      }
      try {
        registerTools(next.tools);
      } catch (error) {
        disposeTools();
        await next.stop();
        state = {
          ...state,
          phase: 'failed',
          error: `tool registration failed: ${error?.message ?? error}`,
          python: candidate,
          command: [candidate, entry].join(' '),
          serverInfo: next.serverInfo,
        };
        throw new McpError(`tool registration failed: ${error?.message ?? error}`, { code: 'tool_registration' });
      }
      client = next;
      state = {
        phase: 'ready',
        error: null,
        tools: next.tools.filter((tool) => !isOff(tool.name)).map((tool) => `${TOOL_PREFIX}${tool.name}`),
        serverInfo: next.serverInfo,
        startedAt: new Date().toISOString(),
        command: [candidate, entry].join(' '),
        python: candidate,
      };
      next.onExit((info) => {
        state = { ...state, phase: 'exited', error: `server exited (code ${info?.code ?? 'null'})` };
        // Keep the published tools: the agent keeps a stable catalog and the
        // next execute() call restarts the process through ensure().
      });
      log(`started ${next.tools.length} tool(s) with ${candidate}`);
      return status();
    }
    state = { ...state, phase: 'failed', error: lastError ? String(lastError.message ?? lastError) : 'no usable Python interpreter' };
    throw lastError ?? new McpError('no usable Python interpreter', { code: 'python_missing' });
  }

  async function ensure() {
    if (client?.running && state.phase === 'ready') return status();
    if (starting) return starting;
    starting = boot().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function restart() {
    bootEpoch += 1;
    if (client) {
      await client.stop();
      client = null;
    }
    state = { ...state, phase: 'idle', error: null };
    return ensure();
  }

  async function call(name, args = {}, options = {}) {
    const result = await invoke(name, args, options);
    return { tool: name, value: result.parsed ?? null, text: result.text, isError: result.isError === true };
  }

  /** The interpreter the stdio bridge would use, resolved the same way. */
  function httpPython() {
    for (const candidate of pythonCandidates(config, runtimeDir)) {
      if (candidate.includes('\\') || candidate.includes('/')) {
        if (existsSync(candidate)) return candidate;
        continue;
      }
      return candidate;
    }
    return null;
  }

  function httpStatus() {
    const port = httpState.port;
    const host = httpState.host || '127.0.0.1';
    return {
      running: Boolean(httpState.child),
      host,
      port,
      url: port ? `http://${host}:${port}${HTTP_PATH}` : null,
      sseUrl: port ? `http://${host}:${port}/sse` : null,
      python: httpState.python,
      startedAt: httpState.startedAt,
      error: httpState.error,
      stderr: httpState.stderr,
      pid: httpState.child?.pid ?? null,
    };
  }

  function stopHttp() {
    const child = httpState.child;
    httpState = { ...httpState, child: null, startedAt: null };
    if (child) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
    return httpStatus();
  }

  /**
   * Find a port this machine will actually let us bind. Windows can refuse a
   * seemingly free port (WinError 10013) when it falls in a reserved range, so
   * the preferred port is only a wish; the next few are tried after it.
   */
  async function pickPort(preferred, host) {
    const first = Number(preferred) || 8765;
    for (let offset = 0; offset <= 20; offset += 1) {
      const candidate = first + offset;
      if (candidate > 65535) break;
      const free = await new Promise((resolve) => {
        const server = createServer();
        server.unref();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        try {
          server.listen(candidate, host);
        } catch {
          resolve(false);
        }
      });
      if (free) return candidate;
    }
    return null;
  }

  /** Resolve once something accepts connections on host:port, or reject. */
  function waitForPort(host, port, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const socket = connect({ host, port });
        let settled = false;
        socket.setTimeout(1200);
        socket.once('connect', () => {
          settled = true;
          socket.destroy();
          resolve();
        });
        const fail = (error) => {
          if (settled) return;
          settled = true;
          socket.destroy();
          if (Date.now() - startedAt > timeoutMs) reject(error);
          else setTimeout(attempt, 350);
        };
        socket.once('error', fail);
        socket.once('timeout', () => fail(new Error('connect timeout')));
      };
      attempt();
    });
  }

  /**
   * Start (or reuse) the HTTP process. `port` defaults to the last one used so a
   * restart after a settings change keeps the same URL visible in the panel.
   */
  async function startHttp({ port, host = '127.0.0.1' } = {}) {
    const wanted = Number(port) || httpState.port || 8765;
    if (httpState.child && httpState.port === wanted) return httpStatus();
    if (httpState.child) stopHttp();
    const python = httpPython();
    if (!python) {
      httpState = { ...httpState, error: 'no usable Python interpreter', port: wanted, host };
      return httpStatus();
    }
    // A preferred port is only a wish: Windows refuses some ports outright.
    const bindPort = await pickPort(wanted, host);
    if (!bindPort) {
      httpState = { ...httpState, child: null, error: `no free port near ${wanted}`, port: wanted, host };
      return httpStatus();
    }
    const entry = serverEntry(packageDir);
    const current = settings ? await settings().catch(() => ({ allowWrite: false })) : { allowWrite: false };
    const child = spawn(python, [entry, '--http', '--host', host, '--port', String(bindPort), '--path', HTTP_PATH], {
      cwd: join(packageDir, 'server'),
      env: childEnvironment({
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        DB_MCP_RUNTIME: runtimeDir,
        DB_MCP_ALLOW_WRITE: current && current.allowWrite === true ? '1' : '0',
      }),
      windowsHide: true,
    });
    httpState = { child, port: bindPort, host, python, startedAt: null, error: null, stderr: '' };
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
      httpState = { ...httpState, stderr };
    });
    child.on('exit', (code, signal) => {
      if (httpState.child === child) {
        httpState = {
          ...httpState,
          child: null,
          startedAt: null,
          error: `HTTP server exited (code ${code ?? 'null'}${signal ? `, ${signal}` : ''})`,
        };
      }
    });
    try {
      await waitForPort(host, wanted, 20_000);
    } catch (error) {
      if (httpState.child === child) stopHttp();
      httpState = {
        ...httpState,
        child: null,
        startedAt: null,
        error: `HTTP server did not answer on ${host}:${wanted} (${error?.message ?? error})`,
        stderr,
      };
      return httpStatus();
    }
    httpState = { ...httpState, startedAt: new Date().toISOString(), error: null };
    log(`HTTP MCP listening on http://${host}:${wanted}${HTTP_PATH}`);
    return httpStatus();
  }

  async function dispose() {
    bootEpoch += 1;
    starting = null;
    stopHttp();
    disposeTools();
    if (client) {
      await client.stop();
      client = null;
    }
    state = { ...state, phase: 'idle', tools: [] };
  }

  return { ensure, restart, dispose, status, call, startHttp, stopHttp, httpStatus, toolCatalog };
}
