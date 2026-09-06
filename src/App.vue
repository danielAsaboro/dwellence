<script setup lang="ts">
import { computed, ref } from 'vue'
import { runConnectivityProbe, type ConnectivityProbeResult } from './lib/connectivity'
import { connectWallet, requestAbuseControlDeviceHandle, sendPurchasePayment, signMessage } from './lib/nimiq'

const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '')
const probeUrl = (import.meta.env.VITE_PROBE_URL || `${window.location.origin}/probe`).replace(/\/$/, '')
const walletAddress = ref('')
const insideNimiqPay = Boolean(window.nimiqPay || window.nimiq)
const consensus = ref<boolean | null>(null)
const deviceConsent = ref(false)
const deviceHandle = ref('')
const status = ref('Open this Mini App in Nimiq Pay, then connect a testnet wallet.')
const busy = ref(false)
const requestId = ref('')
const invitationCode = ref('')
const acceptedTask = ref<{ approximateArea: string; priceLuna: number; windowStartsAt: number; windowEndsAt: number } | null>(null)
const contributorAddress = ref('')
const priceNim = ref('0.01')
const probe = ref<ConnectivityProbeResult | null>(null)
const mode = ref<'seeker' | 'contributor'>('seeker')
const reportId = ref('')
const preview = ref<{ categories: string[]; confidence: string; scorerVersion: string } | null>(null)
const purchase = ref<{ id: string; reference: string; recipient: string; valueLuna: number } | null>(null)
const transactionHash = ref('')
const report = ref<{
  areaCell: string
  confidenceDimensions: Record<string, string>
  limitations: string[]
  connectivity: { endpoint: string; downloadMbps: number; uploadMbps: number; latencyMs: number; jitterMs: number; categoryScore: number }
  environmentalComfort: { temperatureC: number; humidityPercent: number; categoryScore: number }
} | null>(null)
const areaAggregate = ref<{ state: string; sampleCount: number; contributorDevicePairs: number; distinctDays: number; thresholds: { contributorDevicePairs: number; distinctDays: number } } | null>(null)
const readyForApi = computed(() => Boolean(apiUrl && walletAddress.value))

async function api(path: string, options: RequestInit = {}) {
  if (!apiUrl) throw new Error('VITE_API_URL is not configured for this Mini App.')
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.code ?? 'Server request failed')
  return body
}

async function authenticate(role: 'seeker' | 'contributor') {
  if (!deviceConsent.value) throw new Error('Consent to the origin-scoped anti-abuse device handle before signing in.')
  if (!deviceHandle.value) deviceHandle.value = await requestAbuseControlDeviceHandle()
  const challenge = await api('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ role, address: walletAddress.value }) })
  const signed = await signMessage(challenge.message)
  return api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ challengeId: challenge.challengeId, address: walletAddress.value, deviceHandle: deviceHandle.value, ...signed }) })
}

async function connect() {
  busy.value = true
  try { const connected = await connectWallet(); walletAddress.value = connected.address; consensus.value = connected.consensusEstablished; status.value = connected.consensusEstablished ? 'Wallet connected. You can sign a private request.' : 'Wallet connected, but consensus is unavailable.' } catch (error) { status.value = error instanceof Error ? error.message : 'Wallet connection failed.' } finally { busy.value = false }
}

async function createRequest() {
  if (!contributorAddress.value.trim()) { status.value = 'Enter the invited contributor’s Nimiq address first.'; return }
  busy.value = true
  try {
    const session = await authenticate('seeker')
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }))
    const draft = { location: { latitude: position.coords.latitude, longitude: position.coords.longitude, label: 'Private property' }, invitedContributor: contributorAddress.value, windowStartsAt: Date.now(), windowEndsAt: Date.now() + 60 * 60_000, priceLuna: Math.round(Number(priceNim.value) * 100_000) }
    const challenge = await api('/api/requests/challenge', { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: JSON.stringify(draft) })
    const signed = await signMessage(challenge.message)
    const result = await api('/api/requests', { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: JSON.stringify({ ...draft, requestChallengeId: challenge.challengeId, ...signed }) })
    requestId.value = result.id
    invitationCode.value = result.shareCode
    status.value = 'Private request created. Share the invitation code directly with the invited contributor.'
  } catch (error) { status.value = error instanceof Error ? error.message : 'Request creation failed.' } finally { busy.value = false }
}

async function acceptRequest() {
  if (!invitationCode.value.trim()) { status.value = 'Enter the private invitation code first.'; return }
  busy.value = true
  try { const session = await authenticate('contributor'); const accepted = await api(`/api/invitations/${encodeURIComponent(invitationCode.value)}/accept`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' }); requestId.value = accepted.id; acceptedTask.value = accepted; status.value = 'Request accepted. Confirm the approximate area and run the connectivity measurement there.' } catch (error) { status.value = error instanceof Error ? error.message : 'Request acceptance failed.' } finally { busy.value = false }
}

async function cancelRequest() {
  if (!requestId.value) return
  busy.value = true
  try { const session = await authenticate('seeker'); await api(`/api/requests/${encodeURIComponent(requestId.value)}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' }); invitationCode.value = ''; status.value = 'Request cancelled before measurement began.' } catch (error) { status.value = error instanceof Error ? error.message : 'Request cancellation failed.' } finally { busy.value = false }
}

async function measureConnectivity() {
  if (!probeUrl || !requestId.value) { status.value = !probeUrl ? 'VITE_PROBE_URL is not configured. No connectivity result was created.' : 'Enter an accepted private request ID first.'; return }
  busy.value = true
  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }))
    probe.value = await runConnectivityProbe({ endpoint: probeUrl })
    const session = await authenticate('contributor')
    const challenge = await api(`/api/requests/${encodeURIComponent(requestId.value)}/measurement-challenge`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' })
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }).connection
    await api(`/api/requests/${encodeURIComponent(requestId.value)}/connectivity`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: JSON.stringify({ ...probe.value, nonce: challenge.nonce, location: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy }, context: { networkType: connection?.type ?? connection?.effectiveType ?? 'not-exposed', userAgentClass: window.nimiq ? 'nimiq-pay-webview' : 'browser' } }) })
    status.value = 'Connectivity evidence accepted. Wait for the real registered sensor reading, then seal the report.'
  } catch (error) { status.value = error instanceof Error ? error.message : 'Connectivity measurement failed.' } finally { busy.value = false }
}

async function sealReport() {
  if (!requestId.value) { status.value = 'Enter the accepted request ID first.'; return }
  busy.value = true
  try { const session = await authenticate('contributor'); const result = await api(`/api/requests/${encodeURIComponent(requestId.value)}/submit`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' }); reportId.value = result.reportId; status.value = `Sealed report preview created: ${result.reportId}` } catch (error) { status.value = error instanceof Error ? error.message : 'Report generation failed.' } finally { busy.value = false }
}

async function loadPreview() {
  if (!reportId.value) { status.value = 'Enter the report ID shared by the contributor.'; return }
  busy.value = true
  try {
    const session = await authenticate('seeker')
    const result = await api(`/api/reports/${encodeURIComponent(reportId.value)}/preview`, { headers: { authorization: `Bearer ${session.token}` } })
    preview.value = result.preview
    const intent = await api(`/api/reports/${encodeURIComponent(reportId.value)}/purchase-intent`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: '{}' })
    purchase.value = { id: intent.id, reference: intent.reference, recipient: intent.recipient, valueLuna: intent.valueLuna }
    status.value = 'Sealed preview loaded. Review the recipient and low-value testnet amount before the native payment approval.'
  } catch (error) { status.value = error instanceof Error ? error.message : 'Preview loading failed.' } finally { busy.value = false }
}

async function payAndUnlock() {
  if (!purchase.value) return
  busy.value = true
  try {
    transactionHash.value = await sendPurchasePayment({ recipient: purchase.value.recipient, value: purchase.value.valueLuna, data: purchase.value.reference })
    await verifyPayment()
  } catch (error) { status.value = error instanceof Error ? error.message : 'Payment was not verified. The report remains sealed.' } finally { busy.value = false }
}

async function verifyPayment() {
  if (!purchase.value || !transactionHash.value) return
  busy.value = true
  try {
    const session = await authenticate('seeker')
    const verification = await api(`/api/purchases/${purchase.value.id}/verify`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` }, body: JSON.stringify({ transactionHash: transactionHash.value }) })
    if (verification.state !== 'included') { status.value = 'Payment is submitted but still pending canonical inclusion. Retry verification after testnet confirmation.'; return }
    const unlocked = await api(`/api/reports/${encodeURIComponent(reportId.value)}`, { headers: { authorization: `Bearer ${session.token}` } })
    report.value = unlocked.report
    areaAggregate.value = await api(`/api/areas/${encodeURIComponent(report.value!.areaCell)}`)
    status.value = 'Payment independently verified. Your private report is unlocked below.'
  } catch (error) { status.value = error instanceof Error ? error.message : 'Payment verification failed. The report remains sealed.' } finally { busy.value = false }
}
</script>

<template>
  <main>
    <header><p class="eyebrow">Dwellence · Nimiq Pay Mini App · testnet only</p><h1>Know how a place performs.</h1><p class="lede">Commission fresh, private connectivity and environmental evidence for a property. Reports are informational—not inspections, appraisals, or guarantees.</p></header>
    <section v-if="!insideNimiqPay" class="notice"><strong>Nimiq Pay required:</strong> this browser can inspect the interface, but wallet signatures and report payment only work when this URL is opened as a Mini App inside Nimiq Pay. No browser fallback simulates success.</section>
    <section class="notice"><strong>Privacy:</strong> exact property locations and readings stay off-chain. A direct NIM payment contains only an opaque report reference. Signatures establish key control, not physical truth.</section>
    <section class="card wallet"><div><h2>1. Connect</h2><p>{{ walletAddress || 'No wallet connected' }}</p></div><button :disabled="busy" @click="connect">{{ walletAddress ? 'Reconnect wallet' : 'Connect Nimiq Pay' }}</button><small v-if="consensus === false">Consensus is unavailable; payment must remain disabled.</small></section>
    <section class="card consent"><h2>Consent for abuse controls</h2><label><input v-model="deviceConsent" type="checkbox" /> Allow Nimiq Pay to provide this app an origin-scoped device handle for replay and abuse controls. It identifies this device, not you, and the server stores only a digest.</label></section>
    <section class="card"><div class="tabs"><button :class="{ active: mode === 'seeker' }" @click="mode = 'seeker'">I’m seeking evidence</button><button :class="{ active: mode === 'contributor' }" @click="mode = 'contributor'">I’m contributing</button></div>
      <template v-if="mode === 'seeker'"><h2>2. Commission a private measurement</h2><label>Invited contributor Nimiq address <input v-model="contributorAddress" autocomplete="off" placeholder="NQ…" /></label><label>Testnet report price (NIM) <input v-model="priceNim" inputmode="decimal" /></label><button :disabled="busy || !readyForApi" @click="createRequest">Sign and create request</button><p v-if="invitationCode" class="credential"><strong>Private invitation code</strong><code>{{ invitationCode }}</code></p><button v-if="requestId && invitationCode" class="secondary" :disabled="busy" @click="cancelRequest">Cancel unaccepted request</button></template>
      <template v-else><h2>2. Accept an invitation</h2><label>Private invitation code <input v-model="invitationCode" autocomplete="off" placeholder="Paste invitation code" /></label><button :disabled="busy || !readyForApi" @click="acceptRequest">Sign and accept request</button><p v-if="requestId">Accepted request: <code>{{ requestId }}</code></p><dl v-if="acceptedTask"><div><dt>Approximate task area</dt><dd>{{ acceptedTask.approximateArea }}</dd></div><div><dt>Offered price</dt><dd>{{ acceptedTask.priceLuna / 100000 }} NIM</dd></div></dl></template>
    </section>
    <section class="card"><h2>3. Run a live connectivity check</h2><p>Measures download, upload, latency, and jitter against the configured endpoint. It never fabricates a result or calls endpoint performance a property maximum.</p><button :disabled="busy" @click="measureConnectivity">Run and submit connectivity probe</button><dl v-if="probe"><div><dt>Download</dt><dd>{{ probe.downloadMbps }} Mbps</dd></div><div><dt>Upload</dt><dd>{{ probe.uploadMbps }} Mbps</dd></div><div><dt>Latency</dt><dd>{{ probe.latencyMs }} ms</dd></div><div><dt>Jitter</dt><dd>{{ probe.jitterMs }} ms</dd></div></dl></section>
    <section class="card"><h2>4. Seal evidence or unlock a report</h2><p>A registered physical sensor must separately submit its nonce-bound signed temperature/humidity reading. Sealing fails until both evidence types are verified.</p><button :disabled="busy || !readyForApi" @click="sealReport">Seal verified evidence</button><label>Private report ID <input v-model="reportId" autocomplete="off" placeholder="report_…" /></label><button :disabled="busy || !readyForApi" @click="loadPreview">Load sealed preview</button><p v-if="preview">{{ preview.categories.join(' + ') }} · {{ preview.confidence }} confidence · {{ preview.scorerVersion }}</p><button v-if="purchase && !transactionHash" :disabled="busy || consensus !== true" @click="payAndUnlock">Approve {{ purchase.valueLuna / 100000 }} NIM direct payment</button><button v-if="purchase && transactionHash && !report" :disabled="busy" @click="verifyPayment">Retry canonical payment verification</button></section>
    <section v-if="purchase" class="notice"><strong>Direct and irreversible:</strong> payment goes from your wallet directly to <code>{{ purchase.recipient }}</code>. This app does not hold funds, provide escrow, or reverse a confirmed transfer. Verify the {{ purchase.valueLuna / 100000 }} NIM testnet amount before approving in Nimiq Pay.</section>
    <section v-if="report" class="card report"><h2>Unlocked private report</h2><dl><div><dt>Download</dt><dd>{{ report.connectivity.downloadMbps }} Mbps</dd></div><div><dt>Upload</dt><dd>{{ report.connectivity.uploadMbps }} Mbps</dd></div><div><dt>Latency</dt><dd>{{ report.connectivity.latencyMs }} ms</dd></div><div><dt>Jitter</dt><dd>{{ report.connectivity.jitterMs }} ms</dd></div><div><dt>Connectivity score</dt><dd>{{ report.connectivity.categoryScore }}/100</dd></div><div><dt>Temperature</dt><dd>{{ report.environmentalComfort.temperatureC }} °C</dd></div><div><dt>Humidity</dt><dd>{{ report.environmentalComfort.humidityPercent }}%</dd></div><div><dt>Comfort score</dt><dd>{{ report.environmentalComfort.categoryScore }}/100</dd></div></dl><h3>Confidence: low</h3><dl><div v-for="(value, dimension) in report.confidenceDimensions" :key="dimension"><dt>{{ dimension }}</dt><dd>{{ value }}</dd></div></dl><h3>Limits</h3><ul><li v-for="limitation in report.limitations" :key="limitation">{{ limitation }}</li></ul></section>
    <section v-if="areaAggregate" class="card"><h2>Privacy-safe area evidence</h2><p v-if="areaAggregate.state === 'insufficient_evidence'"><strong>Insufficient evidence.</strong> No public score is shown. This area has {{ areaAggregate.contributorDevicePairs }}/{{ areaAggregate.thresholds.contributorDevicePairs }} independent contributor/device pairs across {{ areaAggregate.distinctDays }}/{{ areaAggregate.thresholds.distinctDays }} required days.</p></section>
    <p class="status" aria-live="polite">{{ status }}</p>
  </main>
</template>
