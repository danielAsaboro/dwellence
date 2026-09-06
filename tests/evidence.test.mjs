import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Nimiq from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'

async function withApi(run) {
  const store = createStore(join(mkdtempSync(join(tmpdir(), 'location-evidence-evidence-')), 'state.sqlite'))
  const server = createApp({ store, locationEncryptionKey: 'test-only-key-that-is-long-enough-for-aes-256' })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${server.address().port}`) } finally { await new Promise((resolve) => server.close(resolve)) }
}
async function json(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
  return { status: response.status, body: await response.json() }
}
async function auth(url, role) {
  const keyPair = Nimiq.KeyPair.generate()
  const address = keyPair.publicKey.toAddress().toUserFriendlyAddress()
  const challenge = await json(url, '/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role, address }) })
  const verified = await json(url, '/api/auth/verify', { method: 'POST', body: JSON.stringify({
    challengeId: challenge.body.challengeId, address, publicKey: keyPair.publicKey.toHex(), signature: keyPair.sign(new TextEncoder().encode(challenge.body.message)).toHex(),
  }) })
  return { token: verified.body.token, address, keyPair }
}
async function createSignedRequest(url, seeker, draft) {
  const challenge = await json(url, '/api/requests/challenge', { method: 'POST', headers: { authorization: `Bearer ${seeker.token}` }, body: JSON.stringify(draft) })
  return json(url, '/api/requests', { method: 'POST', headers: { authorization: `Bearer ${seeker.token}` }, body: JSON.stringify({ ...draft, requestChallengeId: challenge.body.challengeId, publicKey: seeker.keyPair.publicKey.toHex(), signature: seeker.keyPair.sign(new TextEncoder().encode(challenge.body.message)).toHex() }) })
}
function sensorPayload({ requestId, nonce, timestamp = Date.now(), temperatureC = 24, humidityPercent = 50 }) {
  return { requestId, nonce, timestamp, temperatureC, humidityPercent }
}
function signedReading(privateKey, payload) {
  return sign(null, Buffer.from(`${payload.requestId}\n${payload.nonce}\n${payload.timestamp}\n${payload.temperatureC}\n${payload.humidityPercent}`), privateKey).toString('hex')
}
async function registerSensor(url, contributor, metadata) {
  const challenge = await json(url, '/api/sensors/registration-challenge', { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: JSON.stringify(metadata) })
  return json(url, '/api/sensors/register', { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: JSON.stringify({ ...metadata, registrationChallengeId: challenge.body.challengeId, walletPublicKey: contributor.keyPair.publicKey.toHex(), walletSignature: contributor.keyPair.sign(new TextEncoder().encode(challenge.body.message)).toHex() }) })
}

describe('signed sensor readings', () => {
  it('accepts one valid physical-sensor payload and rejects its replay', async () => {
    await withApi(async (url) => {
      const seeker = await auth(url, 'seeker')
      const contributor = await auth(url, 'contributor')
      const request = await createSignedRequest(url, seeker, {
        location: { latitude: 6.5, longitude: 3.3 }, invitedContributor: contributor.address, windowStartsAt: Date.now() - 1000, windowEndsAt: Date.now() + 60_000, priceLuna: 1000,
      })
      await json(url, `/api/invitations/${request.body.shareCode}/accept`, { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}' })
      const { privateKey, publicKey } = generateKeyPairSync('ed25519')
      const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
      const sensor = await registerSensor(url, contributor, { publicKey: rawPublicKey, model: 'BME280', firmware: '1.0.0', calibrationStatus: 'manufacturer-specified' })
      const challenge = await json(url, `/api/sensors/${sensor.body.id}/challenge`, { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}' })
      const payload = sensorPayload({ requestId: request.body.id, nonce: challenge.body.nonce })
      const reading = { ...payload, signature: signedReading(privateKey, payload) }
      const accepted = await json(url, `/api/sensors/${sensor.body.id}/readings`, { method: 'POST', body: JSON.stringify(reading) })
      expect(accepted.status).toBe(201)
      expect(accepted.body.status).toBe('accepted')
      const replay = await json(url, `/api/sensors/${sensor.body.id}/readings`, { method: 'POST', body: JSON.stringify(reading) })
      expect(replay.status).toBe(409)
      expect(replay.body.code).toMatch(/REPLAY|NONCE/)
    })
  })

  it('rejects an altered reading after it was signed', async () => {
    await withApi(async (url) => {
      const contributor = await auth(url, 'contributor')
      const { privateKey, publicKey } = generateKeyPairSync('ed25519')
      const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')
      const sensor = await registerSensor(url, contributor, { publicKey: rawPublicKey, model: 'BME280', firmware: '1.0.0', calibrationStatus: 'manufacturer-specified' })
      const challenge = await json(url, `/api/sensors/${sensor.body.id}/challenge`, { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}' })
      const payload = sensorPayload({ requestId: 'req_not_used', nonce: challenge.body.nonce })
      const tampered = { ...payload, temperatureC: 35, signature: signedReading(privateKey, payload) }
      const rejected = await json(url, `/api/sensors/${sensor.body.id}/readings`, { method: 'POST', body: JSON.stringify(tampered) })
      expect(rejected.status).toBe(422)
      expect(rejected.body.code).toBe('SENSOR_SIGNATURE_INVALID')
    })
  })

  it('rejects sensor registration without a wallet signature over its metadata', async () => {
    await withApi(async (url) => {
      const contributor = await auth(url, 'contributor')
      const { publicKey } = generateKeyPairSync('ed25519')
      const result = await json(url, '/api/sensors/register', { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: JSON.stringify({ publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), model: 'BME280', firmware: '1.0.0', calibrationStatus: 'manufacturer-specified' }) })
      expect(result.status).toBe(401)
      expect(result.body.code).toBe('SENSOR_BINDING_SIGNATURE_REQUIRED')
    })
  })
})
