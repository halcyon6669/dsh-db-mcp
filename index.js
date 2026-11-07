/**
 * dsh-db-mcp — Host half entry.
 *
 * This file is deliberately tiny: the Cordis entry is imported once per process,
 * so keeping the implementation out of it lets `POST /plugins/db-mcp/api/reload`
 * swap in a fresh copy of ./src/host.js while DSH keeps running. During
 * development that replaces a full app restart.
 *
 * Storage and API details live in src/host.js.
 */
import { join } from 'node:path'
import { homedir } from 'node:os'

const API_PREFIX = '/plugins/db-mcp/api'
const RELOAD_PATH = `${API_PREFIX}/reload`

export const inject = ['webServer']

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function apply(ctx, config = {}) {
  const dir = (config && config.runtimeDir) || join(dshHome(), 'db-mcp')
  let generation = 0
  let hostPromise = null
  let hostRef = null

  function loadHost() {
    if (!hostPromise) {
      generation += 1
      const specifier = new URL(`./src/host.js?v=${generation}`, import.meta.url)
      hostPromise = import(specifier.href).then(async (module) => {
        hostRef = await module.createHost({ dir, config, ctx })
        return hostRef
      })
      hostPromise.catch(() => {
        hostPromise = null
      })
    }
    return hostPromise
  }

  async function unloadHost() {
    const previous = hostRef
    hostRef = null
    hostPromise = null
    if (previous && typeof previous.dispose === 'function') {
      try {
        await previous.dispose()
      } catch {
        /* nothing left to do at reload time */
      }
    }
  }

  // Warm the implementation so a broken edit fails at mount time, not on the
  // first request, but never block the loader on it.
  loadHost().catch(() => {})

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: RELOAD_PATH,
      handler: async (request, response) => {
        const send = (status, body) => {
          const payload = JSON.stringify(body)
          response.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          response.end(payload)
        }
        if ((request.method || 'GET').toUpperCase() !== 'POST') {
          return send(405, { ok: false, error: 'POST required' })
        }
        const origin = request.headers.origin
        if (origin) {
          try {
            if (new URL(origin).host !== request.headers.host) return send(403, { ok: false, error: 'cross-origin reload rejected' })
          } catch {
            return send(403, { ok: false, error: 'unreadable origin' })
          }
        }
        hostPromise = null
        await unloadHost()
        try {
          const host = await loadHost()
          return send(200, { ok: true, generation, version: host.version, dir })
        } catch (error) {
          return send(500, { ok: false, error: String((error && error.message) || error) })
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (request, response) => {
        let host
        try {
          host = await loadHost()
        } catch (error) {
          response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: false, error: `host module failed to load: ${(error && error.message) || error}` }))
          return
        }
        await host.handle(request, response)
      },
    }),
  )

  // Stop the Python child (and unregister its tools) when the plugin unloads.
  ctx.effect(() => () => {
    void unloadHost()
  })
}
