/** Bump the plugin version in package.json and src/host.js. Run: node dev/bump.mjs 0.5.0 */
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
console.log(`version -> ${version}`)
