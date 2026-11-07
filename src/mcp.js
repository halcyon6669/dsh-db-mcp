/**
 * A very small MCP client over stdio.
 *
 * The plugin owns the Python server instead of going through the Loader's
 * `@deepseek-ai/dsh-mcp-client` row: the interpreter and the script live at
 * machine-specific absolute paths that a static bundle patch cannot express, and
 * owning the process lets the panel show its state and restart it after a
 * datasource change.
 *
 * Wire format: newline-delimited JSON-RPC 2.0, one message per line, exactly what
 * the official Python SDK speaks on stdio.
 */

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const INIT_TIMEOUT_MS = 60_000;

export class McpError extends Error {
  constructor(message, { code = 'mcp_error', data } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

export class McpClient {
  #child = null;
  #buffer = '';
  #nextId = 1;
  #pending = new Map();
  #stderr = [];
  #closed = false;
  #exitInfo = null;
  #onExit = null;

  constructor({ command, args = [], cwd, env = {}, label = 'db-mcp' }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.label = label;
    this.serverInfo = null;
    this.tools = [];
  }

  get running() {
    return this.#child !== null && !this.#closed;
  }

  get exitInfo() {
    return this.#exitInfo;
  }

  get stderrTail() {
    return this.#stderr.slice(-40).join('');
  }

  async start() {
    if (this.#child) return this;
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;
    this.#closed = false;
    this.#exitInfo = null;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      this.#stderr.push(String(chunk));
      if (this.#stderr.length > 200) this.#stderr.shift();
    });
    child.on('error', (error) => {
      this.#exitInfo = { code: null, signal: null, error: String(error) };
      this.#failAll(new McpError(`cannot start ${this.command}: ${error.message}`, { code: 'spawn_error' }));
    });
    child.on('exit', (code, signal) => {
      this.#closed = true;
      this.#exitInfo = { code, signal };
      this.#failAll(
        new McpError(`${this.label} exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`, {
          code: 'server_exited',
        }),
      );
      const onExit = this.#onExit;
      this.#onExit = null;
      if (onExit) onExit(this.#exitInfo);
    });

    const init = await this.#request(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'dsh-db-mcp', version: '0.3.0' },
      },
      INIT_TIMEOUT_MS,
    );
    this.serverInfo = init?.serverInfo ?? null;
    this.#notify('notifications/initialized', {});
    const listed = await this.#request('tools/list', {}, INIT_TIMEOUT_MS);
    this.tools = Array.isArray(listed?.tools) ? listed.tools : [];
    return this;
  }

  async callTool(name, args = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const result = await this.#request('tools/call', { name, arguments: args }, timeoutMs);
    const content = Array.isArray(result?.content) ? result.content : [];
    const text = content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
    let parsed;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    return { ...result, text, parsed };
  }

  onExit(handler) {
    this.#onExit = handler;
  }

  async stop() {
    const child = this.#child;
    if (!child) return;
    this.#child = null;
    this.#closed = true;
    this.#failAll(new McpError(`${this.label} stopped`, { code: 'stopped' }));
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  // ------------------------------------------------------------------ wire

  #onStdout(chunk) {
    this.#buffer += chunk;
    let index = this.#buffer.indexOf('\n');
    while (index >= 0) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line) this.#onLine(line);
      index = this.#buffer.indexOf('\n');
    }
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#stderr.push(`[non-json stdout] ${line}\n`);
      return;
    }
    if (message && typeof message.id !== 'undefined' && !message.method) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new McpError(message.error.message || 'MCP request failed', {
            code: message.error.code ?? 'mcp_error',
            data: message.error.data,
          }),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message && message.method && typeof message.id !== 'undefined') {
      this.#answerServerRequest(message);
    }
    // notifications are ignored
  }

  #answerServerRequest(message) {
    const reply = (payload) => this.#send({ jsonrpc: '2.0', id: message.id, ...payload });
    switch (message.method) {
      case 'ping':
        reply({ result: {} });
        break;
      case 'roots/list':
        reply({ result: { roots: [] } });
        break;
      case 'sampling/createMessage':
        reply({ error: { code: -32601, message: 'sampling is not supported by dsh-db-mcp' } });
        break;
      default:
        reply({ error: { code: -32601, message: `unsupported method: ${message.method}` } });
    }
  }

  #send(message) {
    const child = this.#child;
    if (!child || this.#closed || !child.stdin.writable) {
      throw new McpError(`${this.label} is not running`, { code: 'not_running' });
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #notify(method, params) {
    try {
      this.#send({ jsonrpc: '2.0', method, params });
    } catch {
      /* the exit handler reports the real failure */
    }
  }

  #request(method, params, timeoutMs) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new McpError(`${method} timed out after ${timeoutMs}ms`, { code: 'timeout' }));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  #failAll(error) {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
