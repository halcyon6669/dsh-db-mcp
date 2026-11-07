/**
 * Bridges the Python MCP server into DSH tools.
 *
 * The Python process is spawned lazily on first use, its `tools/list` becomes
 * `mcp__db__<name>` on the host `tools` service, and every call is forwarded over
 * MCP. When a datasource changes the bridge can be restarted; tool registrations
 * are disposed and rebuilt around the new process.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Same cache-busting marker as host.js, so editing this file takes effect on the
// next `POST /api/reload` without restarting DSH.
const GENERATION = new URL(import.meta.url).searchParams.get('v') || '0';
const { McpClient, McpError } = await import(new URL(`./mcp.js?v=${GENERATION}`, import.meta.url).href);

export const TOOL_PREFIX = 'mcp__db__';
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

/** Render one MCP tool result as readable text. */
export function renderResult(value) {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value : JSON.stringify(value);
  if (value.ok === false && value.error) {
    const { code = 'error', message = 'unknown error', hint } = value.error;
    return `error [${code}]: ${message}${hint ? `\n${hint}` : ''}`;
  }
  if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
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
      serverInfo: state.serverInfo,
      startedAt: state.startedAt,
      command: state.command ?? null,
      python: state.python ?? null,
      exit: client?.exitInfo ?? null,
      stderr: client?.stderrTail ?? '',
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
      const rows = parsed && (parsed.rowCount ?? (Array.isArray(parsed.rows) ? parsed.rows.length : undefined));
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
      const result = await active.callTool(name, args, { timeoutMs: TOOL_TIMEOUT_MS });
      if (audited) auditEntry(name, args, startedAt, result, null);
      return result;
    } catch (error) {
      if (audited) auditEntry(name, args, startedAt, null, error);
      throw error;
    }
  }

  function registerTools(tools) {
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
        execute: async (args) => {
          const result = await invoke(tool.name, args ?? {});
          if (result.parsed) return result.parsed;
          if (result.text) return { ok: true, text: result.text };
          return { ok: true, content: result.content ?? [] };
        },
      });
    });
    registeredNames = names;
    state.tools = tools.map((tool) => tool.name);
  }

  function disposeTools() {
    registeredNames = [];
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
        tools: next.tools.map((tool) => `${TOOL_PREFIX}${tool.name}`),
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

  async function dispose() {
    bootEpoch += 1;
    starting = null;
    disposeTools();
    if (client) {
      await client.stop();
      client = null;
    }
    state = { ...state, phase: 'idle', tools: [] };
  }

  return { ensure, restart, dispose, status, call };
}
