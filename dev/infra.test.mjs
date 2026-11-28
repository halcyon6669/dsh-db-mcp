/**
 * Regression guards for the test infrastructure itself.
 *
 * `docs/development.md` names two traps that have bitten this repository
 * before. Both fixes are in place, but nothing failed if someone undid them —
 * these two checks are that missing alarm.
 *
 *   1. `dev/selftest.mjs` takes `--dir=<path>`. The value has to be sliced off
 *      the flag before it is used as a directory; passing the whole argument on
 *      creates a folder literally named `--dir=C:\...` next to the caller and
 *      the run looks fine while writing somewhere it was told not to.
 *   2. Line-anchored regexes must tolerate a trailing `\r`. Windows checkouts
 *      with `core.autocrlf` hand the reader CRLF files, and an anchored `$`
 *      then matches nothing at all — the parser returns zero statements for a
 *      project full of joins. The `\r` half of that lives in
 *      `dev/sources.test.py` (a CRLF mapper has to scan the same as an LF one);
 *      the built artifact is guarded by `dev/build-client.mjs --check`.
 *
 * Run through `npm test`.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

let pass = 0
let fail = 0
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  ok   ${name}`)
  } else {
    fail += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * The selftest writes into the directory it is given and deletes it again on a
 * clean run, so `--keep` is what makes the result inspectable. A run without it
 * still proves the point: a mis-sliced `--dir=` leaves a stray folder behind and
 * the kept directory would not exist at all.
 */
const scratch = await mkdtemp(join(tmpdir(), 'dbmcp-infra-'))
const target = join(scratch, 'runtime dir')
try {
  const { stdout } = await run(process.execPath, ['dev/selftest.mjs', `--dir=${target}`, '--keep'], {
    cwd: root,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const kept = await stat(target).catch(() => null)
  check(
    'selftest: --dir= is read as a path, not passed through as a flag',
    Boolean(kept && kept.isDirectory()),
    `no directory at ${target}; tail: ${stdout.trim().split('\n').slice(-2).join(' | ')}`,
  )

  const entries = await readdir(root)
  const strays = entries.filter((entry) => entry.startsWith('--dir'))
  check('selftest: a --dir= run leaves no folder named after the flag', strays.length === 0, strays.join(', '))

  check('selftest: the run itself finishes green', /checks passed/.test(stdout) && !/FAIL /.test(stdout), stdout.trim().split('\n').slice(-1)[0])
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log(`\n${pass}/${pass + fail} checks passed`)
if (fail > 0) process.exitCode = 1
