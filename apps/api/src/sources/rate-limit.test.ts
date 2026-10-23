import { describe, expect, it } from 'vitest'
import { RateLimiter } from './rate-limit'

describe('RateLimiter', () => {
  it('waits for the minimum interval between two calls', async () => {
    let now = 0
    const sleeps: number[] = []
    const starts: number[] = []
    const limiter = new RateLimiter({
      minIntervalMs: 1_000,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
    })

    await limiter.run(async () => {
      starts.push(now)
      return 'first'
    })
    await limiter.run(async () => {
      starts.push(now)
      return 'second'
    })

    expect(starts).toEqual([0, 1_000])
    expect(sleeps).toEqual([1_000])
  })

  it('serializes concurrent tasks and survives a rejected task', async () => {
    let active = 0
    let maximum = 0
    const order: number[] = []
    const limiter = new RateLimiter({
      minIntervalMs: 0,
      now: () => 0,
      sleep: async () => undefined,
    })

    await Promise.all(
      [0, 1, 2].map((value) =>
        limiter.run(async () => {
          active += 1
          maximum = Math.max(maximum, active)
          await Promise.resolve()
          order.push(value)
          active -= 1
        }),
      ),
    )

    await expect(
      limiter.run(async () => {
        throw new Error('échec attendu')
      }),
    ).rejects.toThrow('échec attendu')

    await expect(limiter.run(async () => 'après échec')).resolves.toBe('après échec')
    expect(maximum).toBe(1)
    expect(order).toEqual([0, 1, 2])
  })
})
