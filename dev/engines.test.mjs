/**
 * Runs the Python suites in `dev/*.test.py` with the plugin's own interpreter,
 * so the Python side is covered by the same `npm test` entry as the Host half.
 *
 *   node dev/engines.test.mjs
 *
 * Only the standard library is needed for `engines.test.py`: it imports
 * `server/engines.py` against a stub DB-API connection and never opens a real
 * database. `writes.test.py` is the same, and `secretbox.test.py` additionally
 * needs `cryptography`, skipping itself when that is missing. Candidates are
 * tried in order (configured path, plugin venv, PATH) and the first one that
 * actually starts runs the suites.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pythonCandidates } from '../src/tools.js'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = process.env.DB_MCP_RUNTIME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'db-mcp')
const testFiles = [
  join(packageDir, 'dev', 'engines.test.py'),
  join(packageDir, 'dev', 'writes.test.py'),
  join(packageDir, 'dev', 'secretbox.test.py'),
]

const tried = []
for (const candidate of pythonCandidates({}, runtimeDir)) {
  // A bare `python` is probed by running it; an absolute path is cheap to check.
  if ((candidate.includes('\\') || candidate.includes('/')) && !existsSync(candidate)) {
    tried.push(`${candidate} (missing)`)
    continue
  }
  // The first suite decides whether this interpreter works at all; a missing
  // interpreter has to fall through to the next candidate rather than fail.
  let status = 0
  for (const [index, testFile] of testFiles.entries()) {
    // stdio: 'inherit' — the suites' output goes straight to the terminal, and it
    // keeps this working where piping a child's output is not permitted.
    const run = spawnSync(candidate, [testFile], { cwd: packageDir, stdio: 'inherit' })
    if (run.error?.code === 'ENOENT' || (index === 0 && run.error)) {
      tried.push(`${candidate} (${run.error ? run.error.message : 'not found'})`)
      status = null
      break
    }
    if (run.error) {
      console.error(`could not run ${testFile}: ${run.error.message}`)
      status = 1
      break
    }
    console.log(`${testFile.split(/[\\/]/).pop()} — ${candidate}`)
    if (run.status !== 0) {
      status = run.status ?? 1
      break
    }
  }
  if (status === null) continue
  process.exit(status)
}

console.error(`no usable Python interpreter:\n  ${tried.join('\n  ')}`)
process.exit(1)
