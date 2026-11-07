/**
 * i18n checks for the client half: en/zh dictionary parity, no dead keys, no
 * copy that bypasses the dictionaries, and valid locale metadata.
 *
 *   node dev/i18n.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'client.js'), 'utf8')

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

const enStart = src.indexOf('en: {')
const zhStart = src.indexOf('zh: {')
const zhEnd = src.indexOf('\n      },', zhStart)
const enBlock = src.slice(enStart, zhStart)
const zhBlock = src.slice(zhStart, zhEnd)

const keysOf = (block) => new Set([...block.matchAll(/^\s*'([a-zA-Z][\w.]*)':/gm)].map((match) => match[1]))
const en = keysOf(enBlock)
const zh = keysOf(zhBlock)

check('english dictionary is not empty', en.size > 100, `${en.size} keys`)
check('chinese dictionary is not empty', zh.size > 100, `${zh.size} keys`)
check(
  'both dictionaries define the same keys',
  en.size === zh.size && [...en].every((key) => zh.has(key)) && [...zh].every((key) => en.has(key)),
  `en ${en.size} / zh ${zh.size}; en-only ${[...en].filter((key) => !zh.has(key)).join(',')}; zh-only ${[...zh].filter((key) => !en.has(key)).join(',')}`,
)

// A call site looks like t('key') but apiGet('/health') must not match, so the
// character before `t` has to be something other than a letter.
const used = new Set([...src.matchAll(/(^|[^A-Za-z_$])t\('([^']+)'\)/gm)].map((match) => match[2]))
const missing = [...used].filter((key) => !en.has(key) || !zh.has(key))
check('every used key is defined in both dictionaries', missing.length === 0, missing.join(', '))

const unused = [...en].filter((key) => !used.has(key))
check('no dead keys in the dictionaries', unused.length === 0, unused.join(', '))

// Chinese copy must live in the zh dictionary only.
const lines = src.split(/\r?\n/)
const zhStartLine = src.slice(0, zhStart).split(/\r?\n/).length
const zhEndLine = src.slice(0, zhEnd).split(/\r?\n/).length
const strayCjk = lines
  .map((line, index) => ({ line, number: index + 1 }))
  .filter((entry) => /[\u4e00-\u9fff]/.test(entry.line))
  .filter((entry) => entry.number < zhStartLine || entry.number > zhEndLine)
check('no hard-coded Chinese outside the zh dictionary', strayCjk.length === 0, strayCjk.map((entry) => `${entry.number}`).join(','))

for (const locale of ['en', 'zh']) {
  const raw = readFileSync(join(root, 'locale', `${locale}.json`))
  check(`${locale}.json has no BOM`, raw[0] !== 0xef)
  let parsed = null
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch (error) {
    check(`${locale}.json parses`, false, String(error.message))
  }
  if (parsed) {
    check(`${locale}.json parses`, true)
    check(
      `${locale}.json has a title and a description`,
      Boolean(parsed.meta && parsed.meta.title && parsed.meta.description),
      JSON.stringify(parsed.meta),
    )
  }
}

console.log(`\ni18n.test: ${pass}/${pass + fail} passed`)
process.exit(fail === 0 ? 0 : 1)
