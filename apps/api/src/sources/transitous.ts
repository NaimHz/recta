import type { Coordinates } from '@recta/domain'
import { defaultSleep, requestJson, type FetchLike, type Sleep } from './http'
import { RateLimiter } from './rate-limit'

export const defaultTransitousBaseUrl = 'https://api.transitous.org'
export const transitousAttribution = 'Transitous, © OpenStreetMap contributors'

export type TransitousStop = {
  name: string
  lat: number | null
  lon: number | null
}

export type TransitousLeg = {
  mode: string
  routeShortName: string | null
  from: TransitousStop
  to: TransitousStop
  startTime: string
  endTime: string
}

export type TransitousItinerary = {
  startTime: string
  endTime: string
  durationSeconds: number
  transfers: number
  legs: TransitousLeg[]
}

export type TransitousPlanRequest = {
  from: Coordinates
  to: Coordinates
  time: string
  arriveBy?: boolean
  transitModes?: string
  numItineraries?: number
}

export type TransitousPlan = {
  url: string
  itineraries: TransitousItinerary[]
}

export type TransitousClientOptions = {
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

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Réponse Transitous inattendue : ${field} manquant.`)
  }

  return value
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stop(value: unknown): TransitousStop {
  const raw = isObject(value) ? value : {}

  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    lat: optionalNumber(raw.lat),
    lon: optionalNumber(raw.lon),
  }
}

function leg(value: unknown): TransitousLeg {
  const raw = isObject(value) ? value : {}

  return {
    mode: text(raw.mode, 'mode'),
    routeShortName: typeof raw.routeShortName === 'string' ? raw.routeShortName : null,
    from: stop(raw.from),
    to: stop(raw.to),
    startTime: text(raw.startTime, 'startTime'),
    endTime: text(raw.endTime, 'endTime'),
  }
}

function itinerary(value: unknown): TransitousItinerary {
  const raw = isObject(value) ? value : {}

  return {
    startTime: text(raw.startTime, 'startTime'),
    endTime: text(raw.endTime, 'endTime'),
    durationSeconds: optionalNumber(raw.duration) ?? 0,
    transfers: optionalNumber(raw.transfers) ?? 0,
    legs: Array.isArray(raw.legs) ? raw.legs.map(leg) : [],
  }
}

export class TransitousClient {
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly retryDelayMs: number
  private readonly fetch: FetchLike
  private readonly sleep: Sleep
  private readonly limiter: RateLimiter

  constructor(options: TransitousClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultTransitousBaseUrl
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

  async plan(request: TransitousPlanRequest): Promise<TransitousPlan> {
    const url = new URL('/api/v6/plan', this.baseUrl)
    url.searchParams.set('fromPlace', `${request.from.lat},${request.from.lon}`)
    url.searchParams.set('toPlace', `${request.to.lat},${request.to.lon}`)
    url.searchParams.set('time', request.time)
    url.searchParams.set('transitModes', request.transitModes ?? 'TRANSIT')
    url.searchParams.set('directModes', 'WALK')
    url.searchParams.set('numItineraries', String(request.numItineraries ?? 5))

    if (request.arriveBy) url.searchParams.set('arriveBy', 'true')

    const payload = await requestJson({
      service: 'Transitous',
      url,
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
      fetch: this.fetch,
      run: (task) => this.limiter.run(task),
      sleep: this.sleep,
      attempts: this.attempts,
      retryDelayMs: this.retryDelayMs,
      timeoutMs: this.timeoutMs,
    })

    if (!isObject(payload) || !Array.isArray(payload.itineraries)) {
      throw new Error('Réponse Transitous inattendue : itinéraires absents.')
    }

    return { url: url.toString(), itineraries: payload.itineraries.map(itinerary) }
  }
}
