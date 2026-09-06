export interface ConnectivityProbeResult {
  endpoint: string
  downloadMbps: number
  uploadMbps: number
  latencyMs: number
  jitterMs: number
  packetLossPercent: null
  measuredAt: number
}

export interface ConnectivityProbeOptions {
  endpoint: string
  fetchImpl?: typeof fetch
  now?: () => number
}

function rateMbps(bytes: number, milliseconds: number): number {
  if (milliseconds <= 0) throw new Error('Probe timing was invalid')
  return Number(((bytes * 8) / milliseconds / 1_000).toFixed(2))
}

export async function runConnectivityProbe({ endpoint, fetchImpl = fetch, now = () => performance.now() }: ConnectivityProbeOptions): Promise<ConnectivityProbeResult> {
  const baseUrl = endpoint.replace(/\/$/, '')
  const payload = new Uint8Array(125_000)
  try {
    const downloadStarted = now()
    const downloadResponse = await fetchImpl(`${baseUrl}/download?bytes=${payload.byteLength}`, { cache: 'no-store' })
    if (!downloadResponse.ok) throw new Error(`Download endpoint returned ${downloadResponse.status}`)
    const downloaded = await downloadResponse.arrayBuffer()
    const downloadMbps = rateMbps(downloaded.byteLength, now() - downloadStarted)

    const uploadStarted = now()
    const uploadResponse = await fetchImpl(`${baseUrl}/upload`, { method: 'POST', body: payload, cache: 'no-store' })
    if (!uploadResponse.ok) throw new Error(`Upload endpoint returned ${uploadResponse.status}`)
    const uploadMbps = rateMbps(payload.byteLength, now() - uploadStarted)

    const pings: number[] = []
    for (let index = 0; index < 3; index += 1) {
      const started = now()
      const response = await fetchImpl(`${baseUrl}/ping?i=${index}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Ping endpoint returned ${response.status}`)
      pings.push(now() - started)
    }
    const latencyMs = Number((pings.reduce((sum, value) => sum + value, 0) / pings.length).toFixed(2))
    const jitterMs = Number((pings.reduce((sum, value) => sum + Math.abs(value - latencyMs), 0) / pings.length).toFixed(2))

    return { endpoint: baseUrl, downloadMbps, uploadMbps, latencyMs, jitterMs, packetLossPercent: null, measuredAt: Date.now() }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Connectivity probe failed: ${reason}`)
  }
}
