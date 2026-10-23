import { z } from 'zod'
import type { ExtractedPlan, ExtractedStop } from './extraction'
import { LocalTimeSchema } from './plan'

export const STOP_WINDOW_SOURCES = ['explicit', 'period', 'default_duration', 'unknown'] as const

export type StopWindowSource = (typeof STOP_WINDOW_SOURCES)[number]

export const NormalizedStopSchema = z.strictObject({
  name: z.string().min(1),
  startText: z.string().min(1).nullable(),
  endText: z.string().min(1).nullable(),
  type: z.string().min(1).nullable(),
  sourceText: z.string().min(1),
  start: LocalTimeSchema.nullable(),
  end: LocalTimeSchema.nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  windowSource: z.enum(STOP_WINDOW_SOURCES),
})

export type NormalizedStop = z.infer<typeof NormalizedStopSchema>

export const NormalizedDaySchema = z.strictObject({
  dateText: z.string().min(1).nullable(),
  city: z.string().min(1).nullable(),
  timezoneText: z.string().min(1).nullable(),
  stops: z.array(NormalizedStopSchema).min(1),
})

export type NormalizedDay = z.infer<typeof NormalizedDaySchema>

export const NormalizedPlanSchema = z.strictObject({
  days: z.array(NormalizedDaySchema).min(1),
})

export type NormalizedPlan = z.infer<typeof NormalizedPlanSchema>

/**
 * Durées par défaut, en minutes, quand le texte donne un début mais pas de fin.
 * Elles ne remplacent jamais une durée écrite : elles servent seulement à
 * proposer une fenêtre et sont signalées par `windowSource`.
 */
export const DEFAULT_STOP_DURATIONS_MINUTES = {
  museum: 120,
  restaurant: 90,
  cafe: 45,
  park: 60,
  monument: 45,
  market: 60,
  shop: 45,
  bar: 60,
  hotel: 30,
  other: 60,
} as const

export type StopTypeKey = keyof typeof DEFAULT_STOP_DURATIONS_MINUTES

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function hasAny(value: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword))
}

export function stopTypeKeyFor(type: string | null): StopTypeKey {
  const value = fold(type ?? '')

  if (hasAny(value, ['musee', 'museum', 'expo', 'exposition'])) return 'museum'
  if (hasAny(value, ['restaurant', 'brasserie', 'bouchon', 'dejeuner', 'diner', 'repas'])) {
    return 'restaurant'
  }
  if (hasAny(value, ['cafe', 'coffee', 'salon de the', 'tea room'])) return 'cafe'
  if (hasAny(value, ['jardin', 'parc', 'park', 'garden', 'square'])) return 'park'
  if (
    hasAny(value, [
      'monument',
      'basilique',
      'eglise',
      'church',
      'cathedrale',
      'cathedral',
      'opera',
      'pantheon',
      'chateau',
      'castle',
      'tour',
      'tower',
    ])
  ) {
    return 'monument'
  }
  if (hasAny(value, ['marche', 'market', 'halles', 'halle'])) return 'market'
  if (hasAny(value, ['magasin', 'shop', 'boutique', 'galerie', 'galeries', 'store'])) {
    return 'shop'
  }
  if (hasAny(value, ['bar', 'pub', 'cave'])) return 'bar'
  if (hasAny(value, ['hotel', 'auberge'])) return 'hotel'

  return 'other'
}

export function defaultDurationMinutesForType(type: string | null): number {
  return DEFAULT_STOP_DURATIONS_MINUTES[stopTypeKeyFor(type)]
}

type ParsedTimeExpression =
  { kind: 'point'; start: string } | { kind: 'period' | 'range'; start: string; end: string }

const PERIODS: ReadonlyArray<{ pattern: RegExp; start: string; end: string }> = [
  { pattern: /^(?:le |la |en |dans la )?matin(?:ee)?$/, start: '09:00', end: '12:00' },
  { pattern: /^(?:l'|l )?apres midi$/, start: '14:00', end: '18:00' },
  { pattern: /^(?:l'|l )?aprem$/, start: '14:00', end: '18:00' },
  { pattern: /^(?:le |la |en )?soir(?:ee)?$/, start: '19:00', end: '22:00' },
  { pattern: /^(?:la )?nuit$/, start: '22:00', end: '23:59' },
]

const RELATIVE_POINTS: ReadonlyArray<{ pattern: RegExp; time: string }> = [
  { pattern: /apres (?:le )?dejeuner/, time: '14:00' },
  { pattern: /avant (?:le )?diner/, time: '18:00' },
  { pattern: /apres (?:le )?diner/, time: '20:00' },
  { pattern: /(?:en )?fin de matinee/, time: '11:00' },
  { pattern: /debut d'?apres midi/, time: '14:00' },
  { pattern: /fin d'?apres midi/, time: '17:00' },
  { pattern: /tot le matin/, time: '08:00' },
  { pattern: /fin de journee/, time: '17:00' },
]

function timeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)

  if (!match?.[1] || !match[2]) return null

  return Number(match[1]) * 60 + Number(match[2])
}

function minutesToTime(total: number): string | null {
  if (!Number.isInteger(total) || total < 0 || total >= 24 * 60) return null

  const hours = Math.floor(total / 60)
  const minutes = total % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parsePoint(raw: string): string | null {
  let text = raw.trim()
  text = text.replace(/^(?:a|vers|environ|des|le|la|en|dans)\s+(?=\d)/, '')

  let meridian: 'am' | 'pm' | null = null
  const periodSuffix =
    /(?:du|de la|de l'|dans la|en)\s*(matin|matinee|apres midi|apres-midi|soir|soiree|nuit)$/.exec(
      text,
    )

  if (periodSuffix?.[1]) {
    meridian = periodSuffix[1] === 'matin' || periodSuffix[1] === 'matinee' ? 'am' : 'pm'
    text = text.slice(0, periodSuffix.index).trim()
  }

  const explicitMeridian = /\s*(am|pm)$/.exec(text)

  if (explicitMeridian?.[1]) {
    meridian = explicitMeridian[1] === 'am' ? 'am' : 'pm'
    text = text.slice(0, explicitMeridian.index).trim()
  }

  const match = /^(\d{1,2})(?:\s*(?:[:h]|heures?|hrs?)\s*(\d{2})?)?$/.exec(text)

  if (!match?.[1]) return null

  let hours = Number(match[1])
  const minutes = match[2] ? Number(match[2]) : 0

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null
  if (minutes < 0 || minutes > 59) return null

  if (meridian) {
    if (hours < 1 || hours > 12) return null
    hours = meridian === 'am' ? (hours === 12 ? 0 : hours) : hours === 12 ? 12 : hours + 12
  } else if (hours < 0 || hours > 23) {
    return null
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseRange(text: string): ParsedTimeExpression | null {
  const match = /^(?:de\s+)?(.+?)\s*(?:-|–|—|\ba\b|\bau\b|\bjusqu'a\b)\s*(.+)$/.exec(text)

  if (!match?.[1] || !match[2]) return null

  const start = parsePoint(match[1])
  const end = parsePoint(match[2])

  if (!start || !end || start >= end) return null

  return { kind: 'range', start, end }
}

function parseTimeExpression(raw: string | null): ParsedTimeExpression | null {
  if (!raw) return null

  const text = fold(raw)

  if (text === '') return null

  const range = parseRange(text)

  if (range) return range

  const words = text.replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim()

  for (const relative of RELATIVE_POINTS) {
    if (relative.pattern.test(words)) {
      return { kind: 'point', start: relative.time }
    }
  }

  for (const period of PERIODS) {
    if (period.pattern.test(words)) {
      return { kind: 'period', start: period.start, end: period.end }
    }
  }

  if (words === 'midi' || words === 'noon') {
    return { kind: 'point', start: '12:00' }
  }

  if (words === 'minuit' || words === 'midnight') {
    return { kind: 'point', start: '00:00' }
  }

  const point = parsePoint(text)

  return point ? { kind: 'point', start: point } : null
}

export function normalizeExtractedStop(stop: ExtractedStop): NormalizedStop {
  const startHint = parseTimeExpression(stop.startText)
  const endHint = parseTimeExpression(stop.endText)
  const defaultDuration = defaultDurationMinutesForType(stop.type)

  let start: string | null = null
  let end: string | null = null
  let windowSource: StopWindowSource = 'unknown'

  if (startHint?.kind === 'range') {
    start = startHint.start
    end = startHint.end
    windowSource = 'explicit'
  } else if (!startHint && endHint?.kind === 'range') {
    start = endHint.start
    end = endHint.end
    windowSource = 'explicit'
  } else if (startHint && endHint) {
    start = startHint.start
    end = endHint.kind === 'point' ? endHint.start : endHint.end

    if (start && end && start < end) {
      windowSource =
        startHint.kind === 'period' || endHint.kind === 'period' ? 'period' : 'explicit'
    } else {
      start = null
      end = null
    }
  } else if (startHint?.kind === 'period') {
    start = startHint.start
    end = startHint.end
    windowSource = 'period'
  } else if (startHint?.kind === 'point') {
    const startMinutes = timeToMinutes(startHint.start)

    start = startHint.start
    end = startMinutes === null ? null : minutesToTime(startMinutes + defaultDuration)
    windowSource = end ? 'default_duration' : 'unknown'

    if (!end) start = null
  } else if (endHint?.kind === 'period') {
    start = endHint.start
    end = endHint.end
    windowSource = 'period'
  } else if (endHint?.kind === 'point') {
    const endMinutes = timeToMinutes(endHint.start)

    end = endHint.start
    start = endMinutes === null ? null : minutesToTime(endMinutes - defaultDuration)
    windowSource = start ? 'default_duration' : 'unknown'

    if (!start) end = null
  }

  const startMinutes = start ? timeToMinutes(start) : null
  const endMinutes = end ? timeToMinutes(end) : null
  const durationMinutes =
    startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : null

  return NormalizedStopSchema.parse({
    ...stop,
    start,
    end,
    durationMinutes,
    windowSource,
  })
}

export function normalizeExtractedPlan(plan: ExtractedPlan): NormalizedPlan {
  return NormalizedPlanSchema.parse({
    days: plan.days.map((day) => ({
      dateText: day.dateText,
      city: day.city,
      timezoneText: day.timezoneText,
      stops: day.stops.map(normalizeExtractedStop),
    })),
  })
}
