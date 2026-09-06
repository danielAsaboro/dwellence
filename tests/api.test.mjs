import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Nimiq from '@nimiq/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../server/app.mjs'
import { createStore } from '../server/store.mjs'

async function withApi(run) {
  const store = createStore(join(mkdtempSync(join(tmpdir(), 'location-evidence-api-')), 'state.sqlite'))
  const server = createApp({ store, locationEncryptionKey: 'test-only-key-that-is-long-enough-for-aes-256' })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try { await run(url) } finally { await new Promise((resolve) => server.close(resolve)) }
}

async function json(url, path, options = {}) {
  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  })
  return { status: response.status, body: await response.json() }
}

async function authenticate(url, role) {
  const keyPair = Nimiq.KeyPair.generate()
  const walletAddress = keyPair.publicKey.toAddress().toUserFriendlyAddress()
  const challenge = await json(url, '/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role, address: walletAddress }) })
  const signature = keyPair.sign(new TextEncoder().encode(challenge.body.message)).toHex()
  const rawPublicKey = keyPair.publicKey.toHex()
  const verified = await json(url, '/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId: challenge.body.challengeId, publicKey: rawPublicKey, signature, address: walletAddress }),
  })
  expect(verified.status, JSON.stringify(verified.body)).toBe(200)
  return { token: verified.body.token, address: walletAddress, keyPair }
}

async function createSignedRequest(url, seeker, draft) {
  const challenge = await json(url, '/api/requests/challenge', { method: 'POST', headers: { authorization: `Bearer ${seeker.token}` }, body: JSON.stringify(draft) })
  return json(url, '/api/requests', { method: 'POST', headers: { authorization: `Bearer ${seeker.token}` }, body: JSON.stringify({ ...draft, requestChallengeId: challenge.body.challengeId, publicKey: seeker.keyPair.publicKey.toHex(), signature: seeker.keyPair.sign(new TextEncoder().encode(challenge.body.message)).toHex() }) })
}

describe('private request API', () => {
  it('serves health and the built Mini App from one production process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwellence-static-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Dwellence</title>')
    writeFileSync(join(root, 'assets', 'app.js'), 'console.info("dwellence")')
    const store = createStore(join(root, 'state.sqlite'))
    const server = createApp({ store, locationEncryptionKey: 'test-only-key-that-is-long-enough-for-aes-256', staticDirectory: root })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${server.address().port}`
      expect((await fetch(`${base}/healthz`)).status).toBe(200)
      expect(await (await fetch(`${base}/`)).text()).toContain('<title>Dwellence</title>')
      expect((await fetch(`${base}/assets/app.js`)).headers.get('content-type')).toContain('javascript')
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('allows configured browser origins to preflight authenticated API requests', async () => {
    const store = createStore(join(mkdtempSync(join(tmpdir(), 'location-evidence-cors-')), 'state.sqlite'))
    const server = createApp({ store, locationEncryptionKey: 'test-only-key-that-is-long-enough-for-aes-256', allowedOrigins: ['https://mini.example'] })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/requests`, { method: 'OPTIONS', headers: { origin: 'https://mini.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } })
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://mini.example')
      expect(response.headers.get('access-control-allow-methods')).toContain('POST')
      expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('serves a controlled connectivity probe without fabricated results', async () => {
    await withApi(async (url) => {
      const download = await fetch(`${url}/probe/download?bytes=1024`)
      expect(download.status).toBe(200)
      expect((await download.arrayBuffer()).byteLength).toBe(1024)
      const upload = await fetch(`${url}/probe/upload`, { method: 'POST', body: new Uint8Array(2048) })
      expect(upload.status).toBe(204)
      expect((await fetch(`${url}/probe/ping?i=1`)).status).toBe(204)
    })
  })

  it('rate limits repeated wallet challenge requests without claiming person uniqueness', async () => {
    await withApi(async (url) => {
      const keyPair = Nimiq.KeyPair.generate()
      const address = keyPair.publicKey.toAddress().toUserFriendlyAddress()
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect((await json(url, '/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role: 'seeker', address }) })).status).toBe(201)
      }
      const limited = await json(url, '/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role: 'seeker', address }) })
      expect(limited.status).toBe(429)
      expect(limited.body.code).toBe('RATE_LIMITED')
    })
  })

  it('rejects request creation without an authenticated seeker session', async () => {
    await withApi(async (url) => {
      const result = await json(url, '/api/requests', { method: 'POST', body: '{}' })
      expect(result.status).toBe(401)
    })
  })

  it('rejects an authenticated request that lacks a signature over its exact payload', async () => {
    await withApi(async (url) => {
      const seeker = await authenticate(url, 'seeker')
      const contributor = await authenticate(url, 'contributor')
      const draft = { location: { latitude: 6.5, longitude: 3.3 }, invitedContributor: contributor.address, windowStartsAt: Date.now(), windowEndsAt: Date.now() + 60_000, priceLuna: 1000 }
      const unsigned = await json(url, '/api/requests', { method: 'POST', headers: { authorization: `Bearer ${seeker.token}` }, body: JSON.stringify(draft) })
      expect(unsigned.status).toBe(401)
      expect(unsigned.body.code).toBe('REQUEST_SIGNATURE_REQUIRED')
    })
  })

  it('rejects a signed request with a malformed invited Nimiq address', async () => {
    await withApi(async (url) => {
      const seeker = await authenticate(url, 'seeker')
      const result = await createSignedRequest(url, seeker, { location: { latitude: 6.5, longitude: 3.3 }, invitedContributor: 'NQTHISISNOTAVALIDADDRESS', windowStartsAt: Date.now(), windowEndsAt: Date.now() + 60_000, priceLuna: 1000 })
      expect(result.status).toBe(400)
      expect(result.body.code).toBe('INVALID_REQUEST')
    })
  })

  it('rejects signed requests whose precise coordinates are outside Earth bounds', async () => {
    await withApi(async (url) => {
      const seeker = await authenticate(url, 'seeker')
      const contributor = await authenticate(url, 'contributor')
      const result = await createSignedRequest(url, seeker, { location: { latitude: 91, longitude: 3.3 }, invitedContributor: contributor.address, windowStartsAt: Date.now(), windowEndsAt: Date.now() + 60_000, priceLuna: 1000 })
      expect(result.status).toBe(400)
      expect(result.body.code).toBe('INVALID_REQUEST')
    })
  })

  it('rejects malformed sensor public-key hex before issuing a binding challenge', async () => {
    await withApi(async (url) => {
      const contributor = await authenticate(url, 'contributor')
      const result = await json(url, '/api/sensors/registration-challenge', { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: JSON.stringify({ publicKey: 'zz'.repeat(32), model: 'ESP32', firmware: '1.0.0', calibrationStatus: 'field-checked' }) })
      expect(result.status).toBe(400)
      expect(result.body.code).toBe('INVALID_SENSOR_REGISTRATION')
    })
  })

  it('stores only a digest of a consented origin-scoped device handle', async () => {
    const store = createStore(join(mkdtempSync(join(tmpdir(), 'location-evidence-device-')), 'state.sqlite'))
    const server = createApp({ store, locationEncryptionKey: 'test-only-key-that-is-long-enough-for-aes-256' })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const keyPair = Nimiq.KeyPair.generate()
      const address = keyPair.publicKey.toAddress().toUserFriendlyAddress()
      const challenge = await json(`http://127.0.0.1:${server.address().port}`, '/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role: 'contributor', address }) })
      const rawHandle = 'b'.repeat(64)
      const verified = await json(`http://127.0.0.1:${server.address().port}`, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ challengeId: challenge.body.challengeId, address, publicKey: keyPair.publicKey.toHex(), signature: keyPair.sign(new TextEncoder().encode(challenge.body.message)).toHex(), deviceHandle: rawHandle }) })
      expect(verified.status).toBe(200)
      const row = store.prepare('SELECT device_handle_digest FROM sessions').get()
      expect(row.device_handle_digest).toMatch(/^[0-9a-f]{64}$/)
      expect(row.device_handle_digest).not.toBe(rawHandle)
    } finally { await new Promise((resolve) => server.close(resolve)) }
  })

  it('creates an invitation-only request and permits exactly one contributor acceptance', async () => {
    await withApi(async (url) => {
      const seeker = await authenticate(url, 'seeker')
      const contributor = await authenticate(url, 'contributor')
      const request = await createSignedRequest(url, seeker, {
          location: { label: 'Private property', latitude: 6.5, longitude: 3.3 },
          invitedContributor: contributor.address,
          windowStartsAt: Date.now(),
          windowEndsAt: Date.now() + 60_000,
          priceLuna: 1000,
      })
      expect(request.status).toBe(201)
      expect(request.body.shareCode).toMatch(/^[a-zA-Z0-9_-]{20,}$/)

      const internalIdAttempt = await json(url, `/api/invitations/${request.body.id}/accept`, {
        method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}',
      })
      expect(internalIdAttempt.status).toBe(409)

      const accepted = await json(url, `/api/invitations/${request.body.shareCode}/accept`, {
        method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}',
      })
      expect(accepted.status).toBe(200)
      expect(accepted.body.id).toBe(request.body.id)
      expect(accepted.body.approximateArea).toBe('6.50,3.30')
      expect(accepted.body.priceLuna).toBe(1000)

      const second = await json(url, `/api/invitations/${request.body.shareCode}/accept`, {
        method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}',
      })
      expect(second.status).toBe(409)
    })
  })

  it('lets the seeker cancel before acceptance and prevents later acceptance', async () => {
    await withApi(async (url) => {
      const seeker = await authenticate(url, 'seeker')
      const contributor = await authenticate(url, 'contributor')
      const request = await createSignedRequest(url, seeker, { location: { latitude: 6.5, longitude: 3.3 }, invitedContributor: contributor.address, windowStartsAt: Date.now(), windowEndsAt: Date.now() + 60_000, priceLuna: 1000 })
      const cancelled = await json(url, `/api/requests/${request.body.id}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${seeker.token}` }, body: '{}' })
      expect(cancelled.status).toBe(200)
      expect(cancelled.body.status).toBe('cancelled')
      const accept = await json(url, `/api/invitations/${request.body.shareCode}/accept`, { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}' })
      expect(accept.status).toBe(409)
    })
  })

  it('expires an invitation after its measurement window ends', async () => {
    await withApi(async (url) => {
      const seeker = await authenticate(url, 'seeker')
      const contributor = await authenticate(url, 'contributor')
      const request = await createSignedRequest(url, seeker, { location: { latitude: 6.5, longitude: 3.3 }, invitedContributor: contributor.address, windowStartsAt: Date.now() - 60_000, windowEndsAt: Date.now() - 1, priceLuna: 1000 })
      const accept = await json(url, `/api/invitations/${request.body.shareCode}/accept`, { method: 'POST', headers: { authorization: `Bearer ${contributor.token}` }, body: '{}' })
      expect(accept.status).toBe(410)
      expect(accept.body.code).toBe('REQUEST_EXPIRED')
    })
  })
})
