import { NonRetryableError, defaultSleep, type FetchLike, type Sleep } from './http'
import { RateLimiter } from './rate-limit'

export const defaultOverpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
] as const

export const defaultOsmUserAgent = 'Recta/0.1 (https://github.com/NaimHz/recta)'

export type OverpassElementType = 'node' | 'way' | 'relation'

export type OverpassElement = {
  type: OverpassElementType
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  center?: {
    lat: number
    lon: number
  }
}

type OverpassResponse = {
  elements?: OverpassElement[]
  remark?: string
  osm3s?: {
    timestamp_osm_base?: string
  }
}

export type OverpassResult = {
  elements: OverpassElement[]
  endpoint: string
  osmBaseTimestamp: string | null
}

export type OverpassClientOptions = {
  endpoints?: readonly string[]
  userAgent?: string
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
  minIntervalMs?: number
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => number
}

export class OverpassClient {
  private readonly endpoints: readonly string[]
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly retryDelayMs: number
  private readonly fetch: FetchLike
  private readonly sleep: Sleep
  private readonly limiter: RateLimiter

  constructor(options: OverpassClientOptions = {}) {
    this.endpoints = options.endpoints ?? defaultOverpassEndpoints
    this.userAgent = options.userAgent ?? defaultOsmUserAgent
    this.timeoutMs = options.timeoutMs ?? 180_000
    this.attempts = options.attempts ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 3_000
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.sleep = options.sleep ?? defaultSleep
    this.limiter = new RateLimiter({
      minIntervalMs: options.minIntervalMs ?? 1_000,
      ...(options.now ? { now: options.now } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    })

    if (this.endpoints.length === 0) {
      throw new Error('Au moins un endpoint Overpass est requis.')
    }
  }

  async query(query: string): Promise<OverpassResult> {
    let lastError: unknown

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      for (const endpoint of this.endpoints) {
        try {
          const response = await this.limiter.run(() =>
            this.fetch(endpoint, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': this.userAgent,
              },
              body: new URLSearchParams({ data: query }),
              signal: AbortSignal.timeout(this.timeoutMs),
            }),
          )

          if (!response.ok) {
            const message = `Overpass HTTP ${response.status}`

            if (response.status === 429 || response.status >= 500) {
              throw new Error(message)
            }

            throw new NonRetryableError(message)
          }

          const payload = (await response.json()) as OverpassResponse

          if (payload.remark && /error|timed out|out of memory/i.test(payload.remark)) {
            throw new Error(`Overpass : ${payload.remark}`)
          }

          return {
            elements: payload.elements ?? [],
            endpoint,
            osmBaseTimestamp: payload.osm3s?.timestamp_osm_base ?? null,
          }
        } catch (error) {
          if (error instanceof NonRetryableError) throw error

          lastError = error
        }
      }

      if (attempt < this.attempts) {
        await this.sleep(attempt * this.retryDelayMs)
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Overpass indisponible')
  }
}
