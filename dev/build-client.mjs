// Rebuild client.js from its source parts.
//
// DSH loads a single browser module from `client.js` and its loader does not
// resolve sibling relative requires, so the source is kept in small pieces and
// concatenated here. Always edit client.parts/*.js, then run this script.
//
//   node dev/build-client.mjs           # write client.js
//   node dev/build-client.mjs --check   # fail if client.js is stale (used by tests)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

/** Parts are concatenated in this order; each ends with a trailing newline. */
export const PARTS = ['header.js', 'dict.js', 'style.js', 'app.js']

const BANNER = [
  '/**',
  ' * GENERATED FILE — do not edit directly.',
  ' * Source: client.parts/*.js. Run `node dev/build-client.mjs` after editing.',
  ' */',
  '',
].join('\n')

export function buildClientString() {
  const chunks = PARTS.map((name) => fs.readFileSync(path.join(root, 'client.parts', name), 'utf8'))
  return BANNER + chunks.join('')
}

function main() {
  const output = buildClientString()
  const target = path.join(root, 'client.js')
  if (process.argv.includes('--check')) {
    const current = fs.readFileSync(target, 'utf8')
    if (current !== output) {
      console.error('client.js is out of date: run `node dev/build-client.mjs`')
      process.exit(1)
    }
    console.log(`client.js is up to date (${Buffer.byteLength(output)} bytes)`)
    return
  }
  fs.writeFileSync(target, output)
  console.log(`built client.js from ${PARTS.length} parts (${Buffer.byteLength(output)} bytes)`)
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main()
