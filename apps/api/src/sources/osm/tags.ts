import { IsoDateSchema, PlaceSchema, type Coordinates, type Place } from '@recta/domain'
import type { OverpassElement } from '../overpass'

export type OsmPlaceContext = {
  retrievedAt: string
}

const categoryKeys = ['tourism', 'amenity', 'shop', 'historic', 'leisure'] as const

function coordinatesFor(element: OverpassElement): Coordinates | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lon: element.lon }
  }

  if (element.center) {
    return { lat: element.center.lat, lon: element.center.lon }
  }

  return null
}

function categoryFor(tags: Record<string, string>): string | null {
  for (const key of categoryKeys) {
    const value = tags[key]

    if (value) return `${key}:${value}`
  }

  return null
}

function addressFor(tags: Record<string, string>): string | null {
  const full = tags['addr:full']?.trim()

  if (full) return full

  const street = [tags['addr:housenumber'], tags['addr:street']]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim()
  const locality = [tags['addr:postcode'], tags['addr:city']]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .trim()
  const parts = [street, locality].filter(Boolean)

  return parts.length > 0 ? parts.join(', ') : null
}

function sourceDateFor(tags: Record<string, string>): string | null {
  const value = tags.check_date ?? tags['survey:date']

  if (!value) return null

  return IsoDateSchema.safeParse(value).success ? value : null
}

export function mapOsmElementToPlace(
  element: OverpassElement,
  context: OsmPlaceContext,
): Place | null {
  const tags = element.tags ?? {}
  const name = tags.name?.trim()

  if (!name) return null

  return PlaceSchema.parse({
    id: `osm:${element.type}/${element.id}`,
    name,
    coordinates: coordinatesFor(element),
    address: addressFor(tags),
    category: categoryFor(tags),
    openingHoursRaw: tags.opening_hours?.trim() || null,
    openingHours: null,
    source: {
      provider: 'osm',
      sourceDate: sourceDateFor(tags),
      retrievedAt: context.retrievedAt,
    },
  })
}
