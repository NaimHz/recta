import type { Coordinates, Place } from './plan'

export type PlaceQuery = {
  name: string
  type?: string | null
  near?: Coordinates | null
}

export type PlaceScoreComponents = {
  name: number
  type: number
  distance: number
  exact: boolean
}

export type ScoredPlace = {
  place: Place
  score: number
  components: PlaceScoreComponents
}

export type ResolvePlacesOptions = {
  limit?: number
  minScore?: number
}

const STOP_WORDS = new Set([
  'a',
  'au',
  'aux',
  'd',
  'de',
  'des',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'of',
  'the',
  'un',
  'une',
])

const TYPE_ALIASES = new Map<string, string>([
  ['art', 'attraction'],
  ['artwork', 'attraction'],
  ['attraction', 'attraction'],
  ['boutique', 'shop'],
  ['cafe', 'cafe'],
  ['coffee', 'cafe'],
  ['gallery', 'museum'],
  ['garden', 'park'],
  ['magasin', 'shop'],
  ['marche', 'market'],
  ['market', 'market'],
  ['marketplace', 'market'],
  ['monument', 'attraction'],
  ['museum', 'museum'],
  ['musee', 'museum'],
  ['park', 'park'],
  ['restaurant', 'restaurant'],
  ['shop', 'shop'],
  ['statue', 'attraction'],
  ['store', 'shop'],
])

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, '')
}

function meaningfulTokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  let current = new Array<number>(right.length + 1)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      const deletion = (previous[rightIndex] ?? 0) + 1
      const insertion = (current[rightIndex - 1] ?? 0) + 1
      const substitution = (previous[rightIndex - 1] ?? 0) + substitutionCost

      current[rightIndex] = Math.min(deletion, insertion, substitution)
    }

    const swap = previous
    previous = current
    current = swap
  }

  return previous[right.length] ?? 0
}

function similarity(left: string, right: string): number {
  const maximumLength = Math.max(left.length, right.length)

  if (maximumLength === 0) return 1

  return 1 - levenshteinDistance(left, right) / maximumLength
}

function nameScore(queryName: string, candidateName: string): { score: number; exact: boolean } {
  const normalizedQuery = normalize(queryName)
  const normalizedCandidate = normalize(candidateName)
  const compactQuery = compact(queryName)
  const compactCandidate = compact(candidateName)

  if (normalizedQuery.length === 0 || normalizedCandidate.length === 0) {
    return { score: 0, exact: false }
  }

  if (compactQuery === compactCandidate) {
    return { score: 1, exact: true }
  }

  const queryTokens = meaningfulTokens(queryName)
  const candidateTokens = meaningfulTokens(candidateName)
  const candidateTokenSet = new Set(candidateTokens)
  const sharedTokens = queryTokens.filter((token) => candidateTokenSet.has(token))
  const queryCoverage = queryTokens.length > 0 ? sharedTokens.length / queryTokens.length : 0
  const candidateCoverage =
    candidateTokens.length > 0 ? sharedTokens.length / candidateTokens.length : 0
  const tokenScore = 0.8 * queryCoverage + 0.2 * candidateCoverage

  let containmentScore = 0

  if (compactQuery.length >= 4 && compactCandidate.includes(compactQuery)) {
    containmentScore = 0.95
  } else if (compactCandidate.length >= 4 && compactQuery.includes(compactCandidate)) {
    containmentScore = 0.9
  }

  const compactSimilarity = similarity(compactQuery, compactCandidate)

  return {
    score: Math.max(tokenScore, containmentScore, compactSimilarity),
    exact: false,
  }
}

function categoryFamily(category: string | null): string | null {
  if (!category) return null

  const [kind, value] = category.split(':')

  if (!kind || !value) return null
  if (kind === 'shop') return 'shop'
  if (kind === 'amenity' && value === 'marketplace') return 'market'
  if (kind === 'tourism') return value === 'museum' ? 'museum' : 'attraction'

  return value
}

function queryTypeFamily(type: string | null | undefined): string | null {
  if (!type) return null

  const normalized = normalize(type)

  return TYPE_ALIASES.get(normalized) ?? normalized
}

function typeScore(queryType: string | null, candidateCategory: string | null): number {
  if (!queryType) return 0.5

  const candidateType = categoryFamily(candidateCategory)

  if (!candidateType) return 0.5

  return queryType === candidateType ? 1 : 0
}

function distanceMeters(from: Coordinates, to: Coordinates): number {
  const earthRadiusMeters = 6_371_000
  const latitudeDelta = ((to.lat - from.lat) * Math.PI) / 180
  const longitudeDelta = ((to.lon - from.lon) * Math.PI) / 180
  const fromLatitude = (from.lat * Math.PI) / 180
  const toLatitude = (to.lat * Math.PI) / 180
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine))
}

function distanceScore(near: Coordinates | null, coordinates: Coordinates | null): number {
  if (!near) return 0.5
  if (!coordinates) return 0

  return 1 / (1 + distanceMeters(near, coordinates) / 1_000)
}

export function resolvePlaces(
  query: PlaceQuery,
  candidates: readonly Place[],
  options: ResolvePlacesOptions = {},
): ScoredPlace[] {
  const queryName = query.name.trim()

  if (queryName.length === 0 || candidates.length === 0) {
    return []
  }

  const queryType = queryTypeFamily(query.type ?? null)
  const limit = Math.max(1, Math.floor(options.limit ?? 3))
  const minScore = options.minScore ?? 0

  return candidates
    .map((place) => {
      const name = nameScore(queryName, place.name)
      const type = typeScore(queryType, place.category)
      const distance = distanceScore(query.near ?? null, place.coordinates)
      const exactBonus = name.exact ? 0.03 : 0
      const score = Math.min(1, 0.9 * name.score + 0.07 * type + 0.03 * distance + exactBonus)

      return {
        place,
        score,
        components: {
          name: name.score,
          type,
          distance,
          exact: name.exact,
        },
      }
    })
    .filter((candidate) => candidate.score >= minScore)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.components.name !== left.components.name) {
        return right.components.name - left.components.name
      }

      if (right.components.distance !== left.components.distance) {
        return right.components.distance - left.components.distance
      }

      const nameOrder = left.place.name.localeCompare(right.place.name, 'fr')

      if (nameOrder !== 0) return nameOrder

      return left.place.id.localeCompare(right.place.id)
    })
    .slice(0, limit)
}
