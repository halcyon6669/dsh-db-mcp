/**
 * At-rest encryption for the stored database passwords.
 *
 * `secrets.json` used to hold plaintext. It now holds one AES-256-GCM envelope
 * per source, and the key lives beside it in `secret.key` (mode 0600).
 *
 * What this buys and what it does not: a copy of `secrets.json` alone — a backup,
 * a sync folder, a pasted file in a bug report — no longer carries the passwords.
 * Someone who can read both files in the runtime directory can still decrypt
 * them, and so can anything running as this user. That is the honest boundary of
 * a local key file, and it is why the docs say so instead of implying more.
 *
 * The same envelope is read by the Python child (`server/secretbox.py`), so the
 * format is a plain string both sides can parse without a shared library:
 *
 *     v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 *
 * The data-source id is authenticated as additional data, so a ciphertext moved
 * from one source to another fails to decrypt instead of silently working.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PREFIX = 'v1'
const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

const b64url = (buffer) => Buffer.from(buffer).toString('base64url')
const fromB64url = (text) => Buffer.from(String(text), 'base64url')

/** A stored password, or an envelope that has to be decrypted first. */
export function isEnvelope(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}.`)
}

/**
 * The key for one runtime directory, created on first use.
 *
 * The write is `wx`, so two Host generations racing on a fresh directory cannot
 * end up with two keys and half the secrets encrypted under each.
 */
export async function loadKey(dir) {
  const file = join(dir, 'secret.key')
  try {
    const text = (await readFile(file, 'utf8')).trim()
    const key = fromB64url(text)
    if (key.length !== KEY_BYTES) throw new Error(`${file} does not hold a 32-byte key`)
    return key
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
  }
  const key = randomBytes(KEY_BYTES)
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(file, `${b64url(key)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error) {
    // Somebody else created it between the read and the write: use theirs.
    if (!error || error.code !== 'EEXIST') throw error
    const text = (await readFile(file, 'utf8')).trim()
    return fromB64url(text)
  }
  try {
    await chmod(file, 0o600)
  } catch {
    /* best effort where POSIX modes are unavailable */
  }
  return key
}

export function encrypt(key, plaintext, aad) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(Buffer.from(String(aad ?? ''), 'utf8'))
  const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, b64url(iv), b64url(tag), b64url(data)].join('.')
}

export function decrypt(key, envelope, aad) {
  if (!isEnvelope(envelope)) return String(envelope)
  const parts = envelope.split('.')
  if (parts.length !== 4) throw new Error('malformed secret envelope')
  const iv = fromB64url(parts[1])
  const tag = fromB64url(parts[2])
  const data = fromB64url(parts[3])
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('malformed secret envelope')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAAD(Buffer.from(String(aad ?? ''), 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
