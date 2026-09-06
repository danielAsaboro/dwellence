import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Nimiq from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'

async function json(base, path, options = {}) { const response = await fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } }); return { status: response.status, body: await response.json() } }
async function auth(base, role) {
  const key = Nimiq.KeyPair.generate(); const address = key.publicKey.toAddress().toUserFriendlyAddress()
  const challenge = await json(base, '/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role, address }) })
  const verified = await json(base, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ challengeId: challenge.body.challengeId, address, publicKey: key.publicKey.toHex(), signature: key.sign(new TextEncoder().encode(challenge.body.message)).toHex() }) })
  return { address, token: verified.body.token, key }
}
function bearer(token) { return { authorization: `Bearer ${token}` } }
async function createSignedRequest(base, seeker, draft) {
  const challenge = await json(base, '/api/requests/challenge', { method: 'POST', headers: bearer(seeker.token), body: JSON.stringify(draft) })
  return json(base, '/api/requests', { method: 'POST', headers: bearer(seeker.token), body: JSON.stringify({ ...draft, requestChallengeId: challenge.body.challengeId, publicKey: seeker.key.publicKey.toHex(), signature: seeker.key.sign(new TextEncoder().encode(challenge.body.message)).toHex() }) })
}

describe('private request to independently verified report unlock', () => {
  it('requires accepted real-form evidence before a canonical payment transaction unlocks the report', async () => {
    const store = createStore(join(mkdtempSync(join(tmpdir(), 'location-evidence-slice-')), 'state.sqlite'))
    let expectedPayment
    const app = createApp({ store, locationEncryptionKey: 'test-only-key-that-is-long-enough-for-aes-256', transactionLookup: async () => ({ ...expectedPayment, blockNumber: 99 }) })
    await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.address().port}`
    try {
      const seeker = await auth(base, 'seeker'); const contributor = await auth(base, 'contributor')
      const request = await createSignedRequest(base, seeker, { location: { latitude: 6.5, longitude: 3.3 }, invitedContributor: contributor.address, windowStartsAt: Date.now() - 1_000, windowEndsAt: Date.now() + 60_000, priceLuna: 1000 })
      await json(base, `/api/invitations/${request.body.shareCode}/accept`, { method: 'POST', headers: bearer(contributor.token), body: '{}' })
      const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const sensor = await json(base, '/api/sensors/register', { method: 'POST', headers: bearer(contributor.token), body: JSON.stringify({ publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), model: 'BME280', firmware: '1.0.0', calibrationStatus: 'manufacturer-specified' }) })
      const sensorNonce = await json(base, `/api/sensors/${sensor.body.id}/challenge`, { method: 'POST', headers: bearer(contributor.token), body: '{}' }); const timestamp = Date.now(); const sensorMessage = `${request.body.id}\n${sensorNonce.body.nonce}\n${timestamp}\n24\n50`
      expect((await json(base, `/api/sensors/${sensor.body.id}/readings`, { method: 'POST', body: JSON.stringify({ requestId: request.body.id, nonce: sensorNonce.body.nonce, timestamp, temperatureC: 24, humidityPercent: 50, signature: sign(null, Buffer.from(sensorMessage), privateKey).toString('hex') }) })).status).toBe(201)
      const connectivityNonce = await json(base, `/api/requests/${request.body.id}/measurement-challenge`, { method: 'POST', headers: bearer(contributor.token), body: '{}' })
      const farReading = await json(base, `/api/requests/${request.body.id}/connectivity`, { method: 'POST', headers: bearer(contributor.token), body: JSON.stringify({ nonce: connectivityNonce.body.nonce, endpoint: 'https://probe.example', downloadMbps: 50, uploadMbps: 10, latencyMs: 20, jitterMs: 5, measuredAt: Date.now(), location: { latitude: 7.5, longitude: 3.3, accuracyMeters: 10 }, context: { networkType: 'wifi', userAgentClass: 'mobile-webview' } }) })
      expect(farReading.status).toBe(422)
      expect(farReading.body.code).toBe('LOCATION_OUTSIDE_REQUEST_TOLERANCE')
      const retryNonce = await json(base, `/api/requests/${request.body.id}/measurement-challenge`, { method: 'POST', headers: bearer(contributor.token), body: '{}' })
      expect((await json(base, `/api/requests/${request.body.id}/connectivity`, { method: 'POST', headers: bearer(contributor.token), body: JSON.stringify({ nonce: retryNonce.body.nonce, endpoint: 'https://probe.example', downloadMbps: 50, uploadMbps: 10, latencyMs: 20, jitterMs: 5, measuredAt: Date.now(), location: { latitude: 6.5001, longitude: 3.3001, accuracyMeters: 20 }, context: { networkType: 'wifi', userAgentClass: 'mobile-webview' } }) })).status).toBe(201)
      const report = await json(base, `/api/requests/${request.body.id}/submit`, { method: 'POST', headers: bearer(contributor.token), body: '{}' }); expect(report.status).toBe(201)
      expect(report.body.preview.confidenceDimensions.integrity).toBe('verified')
      expect(report.body.preview.confidenceDimensions.spatial).toBe('within_tolerance')
      const aggregate = await json(base, '/api/areas/6.50%2C3.30')
      expect(aggregate.status).toBe(200)
      expect(aggregate.body.state).toBe('insufficient_evidence')
      expect(aggregate.body.score).toBeUndefined()
      expect(aggregate.body.thresholds).toEqual({ contributorDevicePairs: 5, distinctDays: 3 })
      const preview = await json(base, `/api/reports/${report.body.reportId}/preview`, { headers: bearer(seeker.token) }); expect(preview.status).toBe(200)
      const intent = await json(base, `/api/reports/${report.body.reportId}/purchase-intent`, { method: 'POST', headers: bearer(seeker.token), body: '{}' }); expectedPayment = { recipient: intent.body.recipient, valueLuna: intent.body.valueLuna, reference: intent.body.reference }
      const payment = await json(base, `/api/purchases/${intent.body.id}/verify`, { method: 'POST', headers: bearer(seeker.token), body: JSON.stringify({ transactionHash: 'a'.repeat(64) }) }); expect(payment.body.state).toBe('included')
      const unlocked = await json(base, `/api/reports/${report.body.reportId}`, { headers: bearer(seeker.token) }); expect(unlocked.status).toBe(200); expect(unlocked.body.report.connectivity.categoryScore).toBeTypeOf('number')
    } finally { await new Promise((resolve) => app.close(resolve)) }
  })
})
