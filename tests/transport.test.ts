import { describe, expect, it } from 'vitest'
import { fetchWithTimeout, withTimeout } from '../src/lib/transport'

describe('bounded transport', () => {
  it('aborts a fetch that exceeds the configured deadline', async () => {
    await expect(
      fetchWithTimeout(
        '/slow',
        {},
        async (_input, init) => await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
        5,
      ),
    ).rejects.toThrow('timed out')
  })

  it('turns a hung provider operation into a recoverable timeout', async () => {
    await expect(withTimeout(new Promise(() => {}), 5, 'Nimiq provider')).rejects.toThrow('Nimiq provider timed out')
  })
})
