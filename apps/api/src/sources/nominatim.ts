import { NonRetryableError, defaultSleep, type FetchLike, type Sleep } from './http'
import { RateLimiter } from './rate-limit'

export const defaultNominatimBaseUrl = 'https://nominatim.openstreetmap.org'

export type NominatimSearchParams = {
  query: string
  countryCode?: string
  limit?: number
}

export type NominatimSearchResult = {
  placeId: number | null
  osmType: string | null
  osmId: number | null
  displayName: string
  lat: number
  lon: number
  category: string | null
  type: string | null
  address: Record<string, string> | null
}

type RawNominatimResult = {
  place_id?: number
  osm_type?: string
  osm_id?: number
  display_name?: string
  lat?: string
  lon?: string
  category?: string
  type?: string
  address?: Record<string, string>
}

export type NominatimClientOptions = {
  baseUrl?: string
  userAgent?: string
  acceptLanguage?: string
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
  minIntervalMs?: number
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => number
}

export class NominatimClient {
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly acceptLanguage: string
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly retryDelayMs: number
  private readonly fetch: FetchLike
  private readonly sleep: Sleep
  private readonly limiter: RateLimiter

  constructor(options: NominatimClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultNominatimBaseUrl
    this.userAgent = options.userAgent ?? 'Recta/0.1 (https://github.com/NaimHz/recta)'
    this.acceptLanguage = options.acceptLanguage ?? 'fr'
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

  async search(params: NominatimSearchParams): Promise<NominatimSearchResult[]> {
    const url = new URL('/search', this.baseUrl)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('q', params.query)
    url.searchParams.set('limit', String(params.limit ?? 5))
    url.searchParams.set('addressdetails', '1')

    if (params.countryCode) {
      url.searchParams.set('countrycodes', params.countryCode.toLowerCase())
    }

    const payload = await this.request(url)

    if (!Array.isArray(payload)) {
      throw new Error('Réponse Nominatim inattendue : tableau attendu.')
    }

    return payload.map((raw) => {
      const result = raw as RawNominatimResult
      const lat = Number(result.lat)
      const lon = Number(result.lon)

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error('Réponse Nominatim inattendue : coordonnées invalides.')
      }

      return {
        placeId: result.place_id ?? null,
        osmType: result.osm_type ?? null,
        osmId: result.osm_id ?? null,
        displayName: result.display_name ?? '',
        lat,
        lon,
        category: result.category ?? null,
        type: result.type ?? null,
        address: result.address ?? null,
      }
    })
  }

  private async request(url: URL): Promise<unknown> {
    let lastError: unknown

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      try {
        const response = await this.limiter.run(() =>
          this.fetch(url, {
            headers: {
              Accept: 'application/json',
              'Accept-Language': this.acceptLanguage,
              'User-Agent': this.userAgent,
            },
            signal: AbortSignal.timeout(this.timeoutMs),
          }),
        )

        if (!response.ok) {
          const message = `Nominatim HTTP ${response.status}`

          if (response.status === 429 || response.status >= 500) {
            throw new Error(message)
          }

          throw new NonRetryableError(message)
        }

        return await response.json()
      } catch (error) {
        if (error instanceof NonRetryableError) throw error

        lastError = error

        if (attempt < this.attempts) {
          await this.sleep(attempt * this.retryDelayMs)
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Nominatim indisponible')
  }
}
