/**
 * Structural check for the Markdown docs: balanced code fences, tables whose rows
 * agree on their column count, and relative links that point at real files.
 *
 *   node dev/docs.check.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['README.md', 'README.zh.md', ...readdirSync(join(root, 'docs')).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)]

const problems = []
const checked = []
const links = []

/** Fenced blocks are skipped for tables and links; they only need to balance. */
function cellCount(row) {
  // Escaped pipes (\|) and pipes inside inline code are content, not separators.
  let count = 0
  let code = false
  for (const [index] of [...row].entries()) {
    const char = row[index]
    if (char === '`') code = !code
    if (char === '\\') continue
    if (char !== '|' || code) continue
    if (index > 0 && row[index - 1] === '\\') continue
    count += 1
  }
  return count
}

function inspect(file) {
  const text = readFileSync(join(root, file), 'utf8')
  if (text.charCodeAt(0) === 0xfeff) problems.push(`${file}: starts with a byte-order mark`)
  const lines = text.split('\n')
  let fence = null
  let table = null
  lines.forEach((line, index) => {
    const where = `${file}:${index + 1}`
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (fence === null) {
        fence = trimmed
      } else if (trimmed === fence || trimmed === '```') {
        fence = null
      } else {
        problems.push(`${where}: closing fence ${trimmed} does not match ${fence}`)
        fence = null
      }
      table = null
      return
    }
    if (fence !== null) return
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = cellCount(trimmed) - 1
      if (table === null) {
        table = cells
      } else if (cells !== table) {
        problems.push(`${where}: table row has ${cells} cells, header has ${table}`)
      }
      return
    }
    if (table !== null && trimmed !== '') table = null
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue
      links.push({ file, where, target })
    }
  })
  if (fence !== null) problems.push(`${file}: unclosed code fence ${fence}`)
  checked.push({ file, lines: lines.length, links: links.filter((entry) => entry.file === file).length })
}

for (const file of files) inspect(file)

for (const { file, where, target } of links) {
  const [path, anchor] = target.split('#')
  if (path === '') continue
  const resolved = resolve(root, dirname(file), decodeURI(path))
  if (!existsSync(resolved)) {
    problems.push(`${where}: link target ${target} does not exist`)
    continue
  }
  if (anchor && resolved.endsWith('.md')) {
    const body = readFileSync(resolved, 'utf8')
    const slug = anchor.toLowerCase()
    const headings = body.split('\n').filter((line) => line.startsWith('#')).map((line) =>
      line.replace(/^#+\s*/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-'),
    )
    if (!headings.includes(slug)) problems.push(`${where}: no heading #{anchor} in ${path}`)
  }
}

for (const entry of checked) console.log(`ok   ${entry.file} — ${entry.lines} lines, ${entry.links} link(s)`)
if (problems.length > 0) {
  console.log('')
  for (const problem of problems) console.log(`FAIL ${problem}`)
  console.log(`\n${problems.length} problem(s) in ${checked.length} file(s)`)
  process.exitCode = 1
} else {
  console.log(`\ndocs.check: ${checked.length}/${checked.length} files clean`)
}
