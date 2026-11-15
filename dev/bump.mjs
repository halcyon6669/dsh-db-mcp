/**
 * Bump the plugin version and cut the changelog entry for it.
 *
 *   node dev/bump.mjs 0.9.8
 *
 * Touches three files so they cannot drift apart: `package.json`, the `PLUGIN_VERSION`
 * in `src/host.js`, and `CHANGELOG.md`. In the changelog the `## [Unreleased]` heading
 * becomes `## [<version>] - <today>` with whatever had accumulated under it, a fresh
 * empty `[Unreleased]` goes back on top, and the two compare links are rewritten.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node dev/bump.mjs <major.minor.patch>')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const raw = readFileSync(pkgPath)
if (raw[0] === 0xef) {
  console.error('package.json starts with a BOM — remove it first')
  process.exit(1)
}
const pkg = JSON.parse(raw.toString('utf8'))
const previous = pkg.version
pkg.version = version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

const hostPath = join(root, 'src', 'host.js')
const host = readFileSync(hostPath, 'utf8')
const next = host.replace(/const PLUGIN_VERSION = '[^']*'/, `const PLUGIN_VERSION = '${version}'`)
if (next === host) {
  console.error('src/host.js does not declare PLUGIN_VERSION')
  process.exit(1)
}
writeFileSync(hostPath, next, 'utf8')

const changelogPath = join(root, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
if (changelog.charCodeAt(0) === 0xfeff) {
  console.error('CHANGELOG.md starts with a BOM — remove it first')
  process.exit(1)
}
// `[ \t]*` rather than `\s*`: a newline-eating suffix would make the replacement
// swallow the blank line that separates the heading from the first `###` section.
const unreleased = /^## \[Unreleased\][ \t]*$/m
if (!unreleased.test(changelog)) {
  console.error('CHANGELOG.md has no `## [Unreleased]` heading to cut the release from')
  process.exit(1)
}
const ahead = changelog.slice(changelog.search(unreleased)).split('\n')
const accumulated = []
for (const line of ahead.slice(1)) {
  if (/^## \[/.test(line)) break
  accumulated.push(line)
}
if (accumulated.join('').trim() === '') {
  console.error('CHANGELOG.md has nothing under [Unreleased] — describe the change first')
  process.exit(1)
}

const today = new Date()
const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const compare = 'https://github.com/halcyon6669/dsh-db-mcp/compare'
const cut = changelog.replace(unreleased, `## [Unreleased]\n\n## [${version}] - ${stamp}`)
// The link block reads newest first, so the new entry goes right below [Unreleased].
const withLink = cut.replace(/^\[Unreleased\]: .*$/m, (line) =>
  [`[Unreleased]: ${compare}/v${version}...HEAD`, `[${version}]: ${compare}/v${previous}...v${version}`].join('\n'),
)
writeFileSync(changelogPath, withLink, 'utf8')

console.log(`${previous} -> ${version}`)
console.log(`CHANGELOG.md: [Unreleased] cut into [${version}] - ${stamp}`)
