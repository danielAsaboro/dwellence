export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error(`${label} timed out`))
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    operation.then(resolve, reject).finally(() => globalThis.clearTimeout(timer))
  })
}

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
  }
  let timedOut = false
  const operation = fetchImpl(input, { ...init, signal: controller.signal }).catch((error) => {
    if (timedOut) throw new Error('Request timed out')
    throw error
  })
  return new Promise<Response>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('Request timed out'))
    }, timeoutMs)
    operation.then(resolve, reject).finally(() => {
      globalThis.clearTimeout(timer)
      init.signal?.removeEventListener('abort', onAbort)
    })
  })
}
