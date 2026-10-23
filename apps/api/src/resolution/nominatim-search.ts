import {
  PlaceSchema,
  type CityConfig,
  type Place,
  type PlaceSearchTool,
  type ResolutionSearchInput,
} from '@recta/domain'
import type { NominatimSearchParams, NominatimSearchResult } from '../sources/nominatim'

export type NominatimSearchClient = {
  search(params: NominatimSearchParams): Promise<NominatimSearchResult[]>
}

export type NominatimPlaceSearchOptions = {
  client: NominatimSearchClient
  limit?: number
  now?: () => string
}

function insideBbox(coordinates: { lat: number; lon: number }, bbox: CityConfig['bbox']): boolean {
  const [west, south, east, north] = bbox

  return (
    coordinates.lon >= west &&
    coordinates.lon <= east &&
    coordinates.lat >= south &&
    coordinates.lat <= north
  )
}

function toPlace(result: NominatimSearchResult, retrievedAt: string): Place | null {
  const id =
    result.osmType && result.osmId !== null
      ? `osm:${result.osmType}/${result.osmId}`
      : result.placeId !== null
        ? `nominatim:${result.placeId}`
        : null

  if (!id) return null

  const name = result.displayName.split(',')[0]?.trim() || result.displayName.trim()

  if (!name) return null

  const category =
    result.category && result.type
      ? `${result.category}:${result.type}`
      : (result.category ?? result.type ?? null)

  return PlaceSchema.parse({
    id,
    name,
    coordinates: { lat: result.lat, lon: result.lon },
    address: result.displayName.trim() || null,
    category,
    openingHoursRaw: null,
    openingHours: null,
    source: {
      provider: 'osm',
      sourceDate: null,
      retrievedAt,
    },
  })
}

export class NominatimPlaceSearch implements PlaceSearchTool {
  readonly name = 'nominatim.search'

  private readonly client: NominatimSearchClient
  private readonly limit: number
  private readonly now: () => string

  constructor(options: NominatimPlaceSearchOptions) {
    this.client = options.client
    this.limit = options.limit ?? 8
    this.now = options.now ?? (() => new Date().toISOString())
  }

  async search(input: ResolutionSearchInput): Promise<Place[]> {
    const results = await this.client.search({
      query: `${input.name}, ${input.city.name}`,
      countryCode: input.city.country,
      limit: this.limit,
    })
    const retrievedAt = this.now()
    const places = new Map<string, Place>()

    for (const result of results) {
      if (!insideBbox({ lat: result.lat, lon: result.lon }, input.city.bbox)) continue

      const place = toPlace(result, retrievedAt)

      if (place) places.set(place.id, place)
    }

    return [...places.values()]
  }
}
