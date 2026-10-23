import type { CityConfig } from './city'
import { resolvePlaces, type ScoredPlace } from './place-resolution'
import type { Coordinates, Place } from './plan'

export const RESOLUTION_AGENT_MAX_CALLS = 6
export const RESOLUTION_AGENT_MIN_SCORE = 0.9
export const RESOLUTION_AGENT_MIN_NAME_SCORE = 0.9
export const RESOLUTION_AGENT_MIN_MARGIN = 0.08
export const RESOLUTION_AGENT_MIN_PLAUSIBLE_NAME_SCORE = 0.6
export const RESOLUTION_AGENT_MIN_OPTION_SCORE = 0.6
export const RESOLUTION_AGENT_MIN_OPTION_NAME_SCORE = 0.7

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

const GENERIC_QUERY_WORDS = new Set([
  'attraction',
  'bar',
  'bistro',
  'bistrot',
  'boutique',
  'cafe',
  'hotel',
  'magasin',
  'marche',
  'market',
  'musee',
  'museum',
  'restaurant',
  'shop',
])

const TYPE_WORDS = new Set([...GENERIC_QUERY_WORDS, 'gallery', 'monument', 'statue'])

export type ResolutionSearchInput = {
  name: string
  city: CityConfig
  type?: string | null
}

export type PlaceSearchTool = {
  readonly name: string
  search(input: ResolutionSearchInput): Promise<Place[]>
}

export type ResolutionAgentOptions = {
  search: PlaceSearchTool
  maxCalls?: number
}

export type ResolutionAgentJournalEntry =
  | {
      step: number
      kind: 'tool'
      tool: 'search'
      source: string
      query: string
      status: 'ok' | 'error'
      resultCount: number
      error?: string
    }
  | {
      step: number
      kind: 'tool'
      tool: 'rank'
      query: string
      status: 'ok'
      resultCount: number
    }
  | {
      step: number
      kind: 'decision'
      decision: ResolutionAgentResult['status']
      reason: string
    }
  | {
      step: number
      kind: 'question'
      question: string
      optionIds: string[]
    }

export type ResolutionAgentOption = {
  id: string
  name: string
  address: string | null
  category: string | null
  score: number
}

export type ResolutionAgentResult = {
  status: 'resolved' | 'needs_clarification' | 'not_found'
  query: string
  cityId: string
  place: Place | null
  question: string | null
  options: ResolutionAgentOption[]
  journal: ResolutionAgentJournalEntry[]
  budget: {
    maxCalls: number
    usedCalls: number
  }
  reason: string
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function meaningfulTokens(value: string): string[] {
  return value
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
}

function isGenericQuery(value: string): boolean {
  const tokens = meaningfulTokens(value)

  return tokens.length === 1 && tokens[0] !== undefined && GENERIC_QUERY_WORDS.has(tokens[0])
}

function buildQueryVariants(name: string): string[] {
  const trimmed = name.trim().replace(/\s+/g, ' ')

  if (trimmed.length === 0) return []

  const withoutTypeWords = trimmed
    .split(/\s+/)
    .filter((token) => !TYPE_WORDS.has(normalizeToken(token)))
    .join(' ')
    .trim()

  return [...new Set([trimmed, withoutTypeWords].filter((variant) => variant.length > 0))]
}

function dedupePlaces(places: readonly Place[]): Place[] {
  const unique = new Map<string, Place>()

  for (const place of places) {
    unique.set(place.id, place)
  }

  return [...unique.values()]
}

function toOptions(ranked: readonly ScoredPlace[]): ResolutionAgentOption[] {
  return ranked
    .filter(
      (candidate) =>
        candidate.score >= RESOLUTION_AGENT_MIN_OPTION_SCORE &&
        candidate.components.name >= RESOLUTION_AGENT_MIN_OPTION_NAME_SCORE,
    )
    .slice(0, 3)
    .map((candidate) => ({
      id: candidate.place.id,
      name: candidate.place.name,
      address: candidate.place.address,
      category: candidate.place.category,
      score: candidate.score,
    }))
}

function buildQuestion(
  query: string,
  cityName: string,
  options: readonly ResolutionAgentOption[],
): string {
  if (options.length === 0) {
    return `Je ne trouve pas « ${query} » à ${cityName}. Peux-tu préciser le nom ou l'adresse ?`
  }

  const firstOption = options[0]

  if (options.length === 1 && firstOption) {
    return `« ${query} » correspond à « ${firstOption.name} » à ${cityName}. Est-ce bien ce lieu ?`
  }

  return `« ${query} » peut désigner plusieurs lieux à ${cityName}. Lequel veux-tu ?`
}

function buildUnavailableQuestion(query: string, cityName: string): string {
  return `La recherche de « ${query} » à ${cityName} n'a pas abouti. Peux-tu réessayer ou préciser le nom ?`
}

/**
 * Agent déterministe de résolution : boucle de recherche, classement, budget et question.
 * Aucun modèle de langage n'intervient ici. Les outils sont injectés.
 */
export async function runResolutionAgent(
  input: {
    name: string
    city: CityConfig
    type?: string | null
    near?: Coordinates | null
  },
  options: ResolutionAgentOptions,
): Promise<ResolutionAgentResult> {
  const maxCalls = Math.max(1, Math.floor(options.maxCalls ?? RESOLUTION_AGENT_MAX_CALLS))
  const journal: ResolutionAgentJournalEntry[] = []
  const variants = buildQueryVariants(input.name)
  let usedCalls = 0
  let hadSearchError = false
  let bestRanked: ScoredPlace[] = []
  const scoringName = input.name.trim()

  for (const variant of variants) {
    if (usedCalls >= maxCalls) break

    usedCalls += 1

    const searchEntry: ResolutionAgentJournalEntry = {
      step: journal.length + 1,
      kind: 'tool',
      tool: 'search',
      source: options.search.name,
      query: variant,
      status: 'ok',
      resultCount: 0,
    }
    journal.push(searchEntry)

    let candidates: Place[]

    try {
      candidates = await options.search.search({
        name: variant,
        city: input.city,
        ...(input.type ? { type: input.type } : {}),
      })
      searchEntry.resultCount = candidates.length
    } catch (error) {
      searchEntry.status = 'error'
      searchEntry.error = error instanceof Error ? error.message : 'Erreur de recherche inconnue'
      hadSearchError = true
      continue
    }

    const uniqueCandidates = dedupePlaces(candidates)

    if (uniqueCandidates.length === 0) continue
    if (usedCalls >= maxCalls) break

    usedCalls += 1
    const ranked = resolvePlaces(
      {
        name: scoringName,
        ...(input.type ? { type: input.type } : {}),
        ...(input.near ? { near: input.near } : {}),
      },
      uniqueCandidates,
    )

    journal.push({
      step: journal.length + 1,
      kind: 'tool',
      tool: 'rank',
      query: variant,
      status: 'ok',
      resultCount: ranked.length,
    })

    bestRanked = ranked

    const top = ranked[0]

    if (top && top.components.name >= RESOLUTION_AGENT_MIN_PLAUSIBLE_NAME_SCORE) {
      break
    }
  }

  const top = bestRanked[0]
  const second = bestRanked[1]
  const margin = top ? top.score - (second?.score ?? 0) : 0
  const typeDisambiguates =
    Boolean(input.type) &&
    top !== undefined &&
    top.components.type >= 1 &&
    (second?.components.type ?? 0) < 1
  const optionsForQuestion = toOptions(bestRanked)
  const budget = { maxCalls, usedCalls }

  const finish = (
    status: ResolutionAgentResult['status'],
    place: Place | null,
    question: string | null,
    optionsList: ResolutionAgentOption[],
    reason: string,
  ): ResolutionAgentResult => {
    journal.push({
      step: journal.length + 1,
      kind: 'decision',
      decision: status,
      reason,
    })

    if (question) {
      journal.push({
        step: journal.length + 1,
        kind: 'question',
        question,
        optionIds: optionsList.map((option) => option.id),
      })
    }

    return {
      status,
      query: input.name,
      cityId: input.city.id,
      place,
      question,
      options: optionsList,
      journal,
      budget,
      reason,
    }
  }

  if (!top || top.components.name < RESOLUTION_AGENT_MIN_PLAUSIBLE_NAME_SCORE) {
    const reason =
      usedCalls >= maxCalls
        ? 'budget_exhausted'
        : hadSearchError
          ? 'search_error'
          : 'no_plausible_candidate'

    const question =
      reason === 'search_error' || reason === 'budget_exhausted'
        ? buildUnavailableQuestion(input.name, input.city.name)
        : buildQuestion(input.name, input.city.name, [])

    return finish('not_found', null, question, [], reason)
  }

  const question = buildQuestion(input.name, input.city.name, optionsForQuestion)

  if (isGenericQuery(input.name)) {
    return finish('needs_clarification', null, question, optionsForQuestion, 'generic_query')
  }

  if (top.score < RESOLUTION_AGENT_MIN_SCORE) {
    return finish('needs_clarification', null, question, optionsForQuestion, 'low_score')
  }

  if (top.components.name < RESOLUTION_AGENT_MIN_NAME_SCORE) {
    return finish('needs_clarification', null, question, optionsForQuestion, 'low_name_score')
  }

  if (margin < RESOLUTION_AGENT_MIN_MARGIN && !typeDisambiguates) {
    return finish('needs_clarification', null, question, optionsForQuestion, 'close_scores')
  }

  return finish('resolved', top.place, null, [], 'match_confident')
}
