import { defaultSleep, type Sleep } from './http'

export type RateLimiterOptions = {
  minIntervalMs: number
  now?: () => number
  sleep?: Sleep
}

/**
 * Sérialise les appels et impose un intervalle minimum entre deux départs.
 * Les sources publiques (Nominatim en particulier) demandent une requête par seconde.
 */
export class RateLimiter {
  private readonly minIntervalMs: number
  private readonly now: () => number
  private readonly sleep: Sleep
  private tail: Promise<unknown> = Promise.resolve()
  private nextAt = 0

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = options.minIntervalMs
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    const execution = this.tail.then(async () => {
      const wait = Math.max(0, this.nextAt - this.now())

      if (wait > 0) await this.sleep(wait)

      this.nextAt = this.now() + this.minIntervalMs

      return task()
    })

    this.tail = execution.then(
      () => undefined,
      () => undefined,
    )

    return execution
  }
}
