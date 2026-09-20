/**
 * Identifier helpers. Session codes avoid 0/O and 1/I so they can be read
 * off a projector and typed on a phone without ambiguity.
 */

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

/** A 6-character join code such as `KX7P2M`. */
export function newSessionCode(length = CODE_LENGTH): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

/** Normalizes user-typed codes: trims, uppercases, maps 0→O and 1→I. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I')
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false
  return true
}

/** An opaque secret for the teacher; URL-safe. */
export function newToken(bytes = 24): string {
  return Buffer.from(randomBytes(bytes)).toString('base64url')
}
