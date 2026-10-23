import { describe, expect, it } from 'vitest'
import type { ExtractedStop } from './extraction'
import {
  DEFAULT_STOP_DURATIONS_MINUTES,
  NormalizedStopSchema,
  defaultDurationMinutesForType,
  normalizeExtractedPlan,
  normalizeExtractedStop,
  stopTypeKeyFor,
  type StopWindowSource,
} from './normalize-extraction'

function makeStop(overrides: Partial<ExtractedStop> = {}): ExtractedStop {
  return {
    name: 'Lieu',
    startText: null,
    endText: null,
    type: null,
    sourceText: 'Lieu',
    ...overrides,
  }
}

type ExpressionCase = {
  expression: string
  start: string | null
  end: string | null
  durationMinutes: number | null
  windowSource: StopWindowSource
}

const expressionCases: ExpressionCase[] = [
  {
    expression: '09:00',
    start: '09:00',
    end: '10:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9h',
    start: '09:00',
    end: '10:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9 h',
    start: '09:00',
    end: '10:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9h30',
    start: '09:30',
    end: '10:30',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9 h 30',
    start: '09:30',
    end: '10:30',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9:30',
    start: '09:30',
    end: '10:30',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '14 heures',
    start: '14:00',
    end: '15:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'midi',
    start: '12:00',
    end: '13:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'minuit',
    start: '00:00',
    end: '01:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'matin',
    start: '09:00',
    end: '12:00',
    durationMinutes: 180,
    windowSource: 'period',
  },
  {
    expression: 'après-midi',
    start: '14:00',
    end: '18:00',
    durationMinutes: 240,
    windowSource: 'period',
  },
  {
    expression: 'soir',
    start: '19:00',
    end: '22:00',
    durationMinutes: 180,
    windowSource: 'period',
  },
  {
    expression: '9:00 AM',
    start: '09:00',
    end: '10:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '12:30 PM',
    start: '12:30',
    end: '13:30',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '12 AM',
    start: '00:00',
    end: '01:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '3 PM',
    start: '15:00',
    end: '16:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9h du soir',
    start: '21:00',
    end: '22:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9h de l’après-midi',
    start: '21:00',
    end: '22:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: '9h-11h',
    start: '09:00',
    end: '11:00',
    durationMinutes: 120,
    windowSource: 'explicit',
  },
  {
    expression: 'de 14h à 17h30',
    start: '14:00',
    end: '17:30',
    durationMinutes: 210,
    windowSource: 'explicit',
  },
  {
    expression: 'après le déjeuner',
    start: '14:00',
    end: '15:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'en fin de matinée',
    start: '11:00',
    end: '12:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'début d’après-midi',
    start: '14:00',
    end: '15:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'fin d’après-midi',
    start: '17:00',
    end: '18:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'tôt le matin',
    start: '08:00',
    end: '09:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'fin de journée',
    start: '17:00',
    end: '18:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'avant le dîner',
    start: '18:00',
    end: '19:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
  {
    expression: 'après le dîner',
    start: '20:00',
    end: '21:00',
    durationMinutes: 60,
    windowSource: 'default_duration',
  },
]

describe('normalizeExtractedStop — expressions', () => {
  for (const testCase of expressionCases) {
    it(`normalise « ${testCase.expression} »`, () => {
      const result = normalizeExtractedStop(makeStop({ startText: testCase.expression }))

      expect(result).toMatchObject({
        start: testCase.start,
        end: testCase.end,
        durationMinutes: testCase.durationMinutes,
        windowSource: testCase.windowSource,
      })
    })
  }

  it('combine un début explicite et une fin de période', () => {
    const result = normalizeExtractedStop(makeStop({ startText: '9h', endText: 'après-midi' }))

    expect(result).toMatchObject({
      start: '09:00',
      end: '18:00',
      durationMinutes: 540,
      windowSource: 'period',
    })
  })

  it('combine une période et une fin explicite', () => {
    const result = normalizeExtractedStop(makeStop({ startText: 'matin', endText: '11h' }))

    expect(result).toMatchObject({
      start: '09:00',
      end: '11:00',
      durationMinutes: 120,
      windowSource: 'period',
    })
  })

  it('déduit le début quand seule la fin est écrite', () => {
    const result = normalizeExtractedStop(makeStop({ endText: '12h', type: 'musée' }))

    expect(result).toMatchObject({
      start: '10:00',
      end: '12:00',
      durationMinutes: 120,
      windowSource: 'default_duration',
    })
  })

  it('refuse une fenêtre inversée', () => {
    const result = normalizeExtractedStop(makeStop({ startText: '12h', endText: '11h' }))

    expect(result).toMatchObject({
      start: null,
      end: null,
      durationMinutes: null,
      windowSource: 'unknown',
    })
  })

  it('refuse une fenêtre qui dépasse minuit', () => {
    const result = normalizeExtractedStop(makeStop({ startText: '23h30' }))

    expect(result).toMatchObject({
      start: null,
      end: null,
      durationMinutes: null,
      windowSource: 'unknown',
    })
  })

  it('ne devine rien sans expression', () => {
    const result = normalizeExtractedStop(makeStop())

    expect(result).toMatchObject({
      start: null,
      end: null,
      durationMinutes: null,
      windowSource: 'unknown',
    })
  })
})

describe('normalizeExtractedStop — durées par type', () => {
  const cases: Array<{ type: string | null; end: string; duration: number }> = [
    { type: 'musée', end: '12:00', duration: 120 },
    { type: 'museum', end: '12:00', duration: 120 },
    { type: 'restaurant', end: '11:30', duration: 90 },
    { type: 'brasserie', end: '11:30', duration: 90 },
    { type: 'café', end: '10:45', duration: 45 },
    { type: 'jardin', end: '11:00', duration: 60 },
    { type: 'monument', end: '10:45', duration: 45 },
    { type: 'marché', end: '11:00', duration: 60 },
    { type: 'magasin', end: '10:45', duration: 45 },
    { type: 'bar', end: '11:00', duration: 60 },
    { type: 'hôtel', end: '10:30', duration: 30 },
    { type: null, end: '11:00', duration: 60 },
    { type: 'type inconnu', end: '11:00', duration: 60 },
  ]

  for (const testCase of cases) {
    it(`applique la durée ${testCase.duration} min pour ${testCase.type ?? 'aucun type'}`, () => {
      const result = normalizeExtractedStop(makeStop({ startText: '10:00', type: testCase.type }))

      expect(result).toMatchObject({
        start: '10:00',
        end: testCase.end,
        durationMinutes: testCase.duration,
        windowSource: 'default_duration',
      })
    })
  }

  it('expose les durées par défaut', () => {
    expect(DEFAULT_STOP_DURATIONS_MINUTES.museum).toBe(120)
    expect(DEFAULT_STOP_DURATIONS_MINUTES.other).toBe(60)
    expect(defaultDurationMinutesForType('restaurant')).toBe(90)
    expect(stopTypeKeyFor('Musée du Louvre')).toBe('museum')
  })
})

describe('NormalizedStopSchema', () => {
  it('refuse un champ inconnu', () => {
    const result = NormalizedStopSchema.safeParse({
      ...normalizeExtractedStop(makeStop({ startText: '9h' })),
      extra: true,
    })

    expect(result.success).toBe(false)
  })
})

describe('normalizeExtractedPlan', () => {
  it('normalise chaque jour et conserve les champs d’origine', () => {
    const plan = normalizeExtractedPlan({
      days: [
        {
          dateText: 'Samedi 24 octobre',
          city: 'Paris',
          timezoneText: null,
          stops: [
            makeStop({
              name: 'Musée du Louvre',
              startText: '09:00',
              endText: '11:00',
              type: 'musée',
              sourceText: '09:00-11:00 Musée du Louvre',
            }),
            makeStop({
              name: 'Jardin du Luxembourg',
              startText: 'Matin',
              sourceText: 'Matin : Jardin du Luxembourg',
            }),
          ],
        },
        {
          dateText: 'Dimanche 25 octobre',
          city: null,
          timezoneText: null,
          stops: [makeStop({ name: 'Panthéon', endText: '18h', type: 'monument' })],
        },
      ],
    })

    expect(plan.days[0]?.dateText).toBe('Samedi 24 octobre')
    expect(plan.days[0]?.stops[0]).toMatchObject({
      name: 'Musée du Louvre',
      start: '09:00',
      end: '11:00',
      durationMinutes: 120,
      windowSource: 'explicit',
    })
    expect(plan.days[0]?.stops[1]).toMatchObject({
      start: '09:00',
      end: '12:00',
      durationMinutes: 180,
      windowSource: 'period',
    })
    expect(plan.days[1]?.stops[0]).toMatchObject({
      start: '17:15',
      end: '18:00',
      durationMinutes: 45,
      windowSource: 'default_duration',
    })
  })
})
