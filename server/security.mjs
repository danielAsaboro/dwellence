import { createHash, randomBytes, verify } from 'node:crypto'
import * as Nimiq from '@nimiq/core'

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function issueNonce(store, purpose, binding, ttlSeconds = 300, nonce = randomBytes(32).toString('base64url')) {
  store.prepare(
    'INSERT INTO nonces (digest, purpose, binding, expires_at) VALUES (?, ?, ?, ?)',
  ).run(digest(nonce), purpose, binding, Date.now() + ttlSeconds * 1000)
  return nonce
}

export function consumeNonce(store, nonce, purpose, binding) {
  const now = Date.now()
  const result = store.prepare(`
    UPDATE nonces
    SET consumed_at = ?
    WHERE digest = ?
      AND purpose = ?
      AND binding = ?
      AND expires_at >= ?
      AND consumed_at IS NULL
  `).run(now, digest(nonce), purpose, binding, now)
  return result.changes === 1
}

export function verifyEd25519Signature(message, signature, rawPublicKey) {
  if (!Buffer.isBuffer(rawPublicKey) || rawPublicKey.length !== 32) return false
  const publicKey = Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey])
  return verify(null, message, { key: publicKey, format: 'der', type: 'spki' }, signature)
}

export function sha256(value) {
  return digest(value)
}

export function verifyNimiqWalletSignature(message, signatureHex, publicKeyHex, address) {
  try {
    const publicKey = Nimiq.PublicKey.fromHex(publicKeyHex)
    const signature = Nimiq.Signature.fromHex(signatureHex)
    const derivedAddress = publicKey.toAddress().toUserFriendlyAddress().replaceAll(' ', '')
    const suppliedAddress = String(address).replaceAll(' ', '').toUpperCase()
    return derivedAddress === suppliedAddress && publicKey.verify(signature, new TextEncoder().encode(message))
  } catch {
    return false
  }
}

export function isValidNimiqAddress(address) {
  try {
    Nimiq.Address.fromUserFriendlyAddress(String(address))
    return true
  } catch {
    return false
  }
}
