/**
 * Runs `dev/engines.test.py` with the plugin's own interpreter, so the Python
 * side is covered by the same `npm test` entry as the Host half.
 *
 *   node dev/engines.test.mjs
 *
 * Only the standard library is needed: the tests import `server/engines.py`
 * against a stub DB-API connection and never open a real database. Candidates
 * are tried in order (configured path, plugin venv, PATH) and the first one that
 * actually starts runs the suite.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pythonCandidates } from '../src/tools.js'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = process.env.DB_MCP_RUNTIME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'db-mcp')
const testFile = join(packageDir, 'dev', 'engines.test.py')

const tried = []
for (const candidate of pythonCandidates({}, runtimeDir)) {
  // A bare `python` is probed by running it; an absolute path is cheap to check.
  if ((candidate.includes('\\') || candidate.includes('/')) && !existsSync(candidate)) {
    tried.push(`${candidate} (missing)`)
    continue
  }
  // stdio: 'inherit' — the suite's output goes straight to the terminal, and it
  // keeps this working where piping a child's output is not permitted.
  const run = spawnSync(candidate, [testFile], { cwd: packageDir, stdio: 'inherit' })
  if (run.error?.code === 'ENOENT') {
    tried.push(`${candidate} (not found)`)
    continue
  }
  if (run.error) {
    tried.push(`${candidate} (${run.error.message})`)
    continue
  }
  console.log(`engines.test.py — ${candidate}`)
  process.exit(run.status ?? 1)
}

console.error(`no usable Python interpreter:\n  ${tried.join('\n  ')}`)
process.exit(1)
