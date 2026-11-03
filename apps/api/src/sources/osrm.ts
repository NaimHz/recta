import type { Coordinates } from '@recta/domain'
import { NonRetryableError, defaultSleep, requestJson, type FetchLike, type Sleep } from './http'
import { RateLimiter } from './rate-limit'

export const defaultOsrmBaseUrl = 'https://routing.openstreetmap.de/routed-foot'
export const osrmAttribution = 'OSRM FOSSGIS, © OpenStreetMap contributors'

export type OsrmTable = {
  url: string
  durationsSeconds: (number | null)[][]
  distancesMeters: (number | null)[][]
}

export type OsrmClientOptions = {
  baseUrl?: string
  userAgent?: string
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
  minIntervalMs?: number
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => number
}

type RawOsrmTable = {
  code?: string
  durations?: unknown
  distances?: unknown
}

function matrix(value: unknown, size: number): (number | null)[][] {
  if (!Array.isArray(value) || value.length !== size) {
    throw new Error('Réponse OSRM inattendue : matrice absente ou de mauvaise taille.')
  }

  return value.map((row) => {
    if (!Array.isArray(row) || row.length !== size) {
      throw new Error('Réponse OSRM inattendue : ligne de matrice invalide.')
    }

    return row.map((cell) => (typeof cell === 'number' && Number.isFinite(cell) ? cell : null))
  })
}

export class OsrmClient {
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly retryDelayMs: number
  private readonly fetch: FetchLike
  private readonly sleep: Sleep
  private readonly limiter: RateLimiter

  constructor(options: OsrmClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultOsrmBaseUrl
    this.userAgent = options.userAgent ?? 'Recta/0.1 (https://github.com/NaimHz/recta)'
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.attempts = options.attempts ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 1_000
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init))
    this.sleep = options.sleep ?? defaultSleep
    this.limiter = new RateLimiter({
      minIntervalMs: options.minIntervalMs ?? 1_100,
      ...(options.now ? { now: options.now } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    })
  }

  async table(points: Coordinates[]): Promise<OsrmTable> {
    if (points.length < 2) {
      throw new NonRetryableError('OSRM table : au moins deux points sont nécessaires.')
    }

    const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(';')
    const url = new URL(`${this.baseUrl}/table/v1/foot/${coordinates}`)
    url.searchParams.set('annotations', 'duration,distance')

    const payload = (await requestJson({
      service: 'OSRM',
      url,
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
      fetch: this.fetch,
      run: (task) => this.limiter.run(task),
      sleep: this.sleep,
      attempts: this.attempts,
      retryDelayMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
    })) as RawOsrmTable

    if (payload.code !== 'Ok') {
      throw new NonRetryableError(`OSRM ${payload.code ?? 'réponse sans code'}`)
    }

    return {
      url: url.toString(),
      durationsSeconds: matrix(payload.durations, points.length),
      distancesMeters: matrix(payload.distances, points.length),
    }
  }
}
