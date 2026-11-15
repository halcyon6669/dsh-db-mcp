/**
 * Read and validate CHANGELOG.md.
 *
 *   node dev/changelog.mjs notes 0.9.8    # the release notes for one version, for gh
 *   node dev/changelog.mjs check          # structure: versions, dates, link targets
 *
 * `notes` prints the body of a version section without its heading, which is exactly
 * what `gh release create --notes-file` wants.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const file = join(root, 'CHANGELOG.md')
const text = readFileSync(file, 'utf8')

if (text.charCodeAt(0) === 0xfeff) {
  console.error('CHANGELOG.md starts with a BOM — remove it first')
  process.exit(1)
}

const lines = text.split('\n')

/** One entry per `## [...]` heading: its version, date and body lines. */
function sections() {
  const entries = []
  let current = null
  for (const line of lines) {
    const head = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/.exec(line)
    if (head) {
      current = { version: head[1], date: head[2] || null, body: [] }
      entries.push(current)
      continue
    }
    if (current !== null) current.body.push(line)
  }
  return entries
}

/** The link definitions at the bottom, `[version]: url`. */
function linkTargets() {
  const map = new Map()
  for (const line of lines) {
    const hit = /^\[([^\]]+)\]:\s*(\S+)\s*$/.exec(line)
    if (hit) map.set(hit[1], hit[2])
  }
  return map
}

function trimBlank(rows) {
  const out = [...rows]
  while (out.length > 0 && out[0].trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out
}

const command = process.argv[2] || 'check'

if (command === 'notes') {
  const wanted = process.argv[3]
  if (!wanted) {
    console.error('usage: node dev/changelog.mjs notes <version>')
    process.exit(1)
  }
  const found = sections().find((entry) => entry.version === wanted || entry.version === `v${wanted}`)
  if (!found) {
    console.error(`CHANGELOG.md has no section for ${wanted}`)
    process.exit(1)
  }
  const body = trimBlank(found.body).join('\n').trimEnd()
  if (body === '') {
    console.error(`the ${found.version} section is empty`)
    process.exit(1)
  }
  console.log(body)
  process.exit(0)
}

if (command !== 'check') {
  console.error(`unknown command ${command} — use "notes <version>" or "check"`)
  process.exit(1)
}

const problems = []
const entries = sections()

if (entries.length === 0) problems.push('no `## [version]` section found')
if (entries[0] && entries[0].version !== 'Unreleased') {
  problems.push(`the first section is ${entries[0].version}, expected Unreleased`)
}

const released = entries.filter((entry) => entry.version !== 'Unreleased')
const seen = new Set()
for (const entry of released) {
  if (!/^\d+\.\d+\.\d+$/.test(entry.version)) problems.push(`bad version "${entry.version}"`)
  if (seen.has(entry.version)) problems.push(`version ${entry.version} appears twice`)
  seen.add(entry.version)
  if (entry.date === null) problems.push(`${entry.version} has no date`)
  else if (Number.isNaN(Date.parse(entry.date))) problems.push(`${entry.version} has the date ${entry.date}, which is not a date`)
  if (trimBlank(entry.body).length === 0) problems.push(`${entry.version} has an empty body`)
}

for (let index = 1; index < released.length; index += 1) {
  const previous = released[index - 1].version.split('.').map(Number)
  const current = released[index].version.split('.').map(Number)
  if (current.length !== 3 || previous.length !== 3) continue
  const descends =
    current[0] < previous[0] ||
    (current[0] === previous[0] && current[1] < previous[1]) ||
    (current[0] === previous[0] && current[1] === previous[1] && current[2] < previous[2])
  if (!descends) problems.push(`${released[index].version} is listed after ${released[index - 1].version}`)
}

const targets = linkTargets()
for (const entry of entries) {
  if (!targets.has(entry.version)) problems.push(`no link target for [${entry.version}]`)
}

if (problems.length > 0) {
  for (const problem of problems) console.log(`FAIL ${problem}`)
  console.log(`\nchangelog.check: ${problems.length} problem(s) in ${entries.length} section(s)`)
  process.exitCode = 1
} else {
  console.log(`changelog.check: ${entries.length} section(s) clean (${released.length} released)`)
}
