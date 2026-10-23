import { describe, expect, it } from 'vitest'
import type { ExtractedPlan } from '@recta/domain'
import { findInventions } from '../extraction/validate'
import {
  loadExtractionF1Corpus,
  scoreExtractionCase,
  type ExtractionF1Case,
} from './extraction-f1-eval'

const testCase: ExtractionF1Case = {
  id: 'test-paris',
  format: 'whatsapp',
  text: 'Samedi à Paris\n9h-11h musée du Louvre',
}

const gold: ExtractedPlan = {
  days: [
    {
      dateText: 'Samedi',
      city: 'Paris',
      timezoneText: null,
      stops: [
        {
          name: 'musée du Louvre',
          startText: '9h',
          endText: '11h',
          type: 'musée',
          sourceText: '9h-11h musée du Louvre',
        },
      ],
    },
  ],
}

describe('corpus extraction F1', () => {
  it('contient 30 textes, 10 par format et des annotations valides', async () => {
    const { cases, gold: annotations } = await loadExtractionF1Corpus()

    expect(cases.cases).toHaveLength(30)
    expect(cases.formats).toEqual(['whatsapp', 'email', 'article'])

    for (const format of cases.formats) {
      expect(cases.cases.filter((item) => item.format === format)).toHaveLength(10)
    }

    for (const item of cases.cases) {
      const plan = annotations.cases[item.id]

      expect(plan).toBeDefined()
      expect(findInventions(item.text, plan!)).toEqual([])
    }
  })
})

describe('scoreExtractionCase', () => {
  it('note une sortie exacte à 1 sur tous les champs', () => {
    const result = scoreExtractionCase(testCase, gold, structuredClone(gold))

    expect(result.schemaValid).toBe(true)
    expect(result.noInvention).toBe(true)
    expect(result.errors).toEqual([])

    for (const field of ['name', 'startText', 'endText', 'type', 'dateText', 'city'] as const) {
      expect(result.fieldCounts[field]).toEqual({ tp: 1, fp: 0, fn: 0 })
    }

    expect(result.fieldCounts.timezoneText).toEqual({ tp: 0, fp: 0, fn: 0 })
  })

  it('tolère une heure écrite dans un autre format et un nom abrégé', () => {
    const prediction = structuredClone(gold)
    prediction.days[0]!.stops[0]!.name = 'Louvre'
    prediction.days[0]!.stops[0]!.startText = '09:00'
    prediction.days[0]!.stops[0]!.endText = '11:00'

    const result = scoreExtractionCase(testCase, gold, prediction)

    expect(result.fieldCounts.name).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(result.fieldCounts.startText).toEqual({ tp: 1, fp: 0, fn: 0 })
    expect(result.fieldCounts.endText).toEqual({ tp: 1, fp: 0, fn: 0 })
  })

  it('tolère un article devant la date', () => {
    const datedCase: ExtractionF1Case = {
      ...testCase,
      text: 'Le samedi à Paris\n9h-11h musée du Louvre',
    }
    const datedGold = structuredClone(gold)
    datedGold.days[0]!.dateText = 'Le samedi'
    const prediction = structuredClone(datedGold)
    prediction.days[0]!.dateText = 'samedi'

    const result = scoreExtractionCase(datedCase, datedGold, prediction)

    expect(result.fieldCounts.dateText).toEqual({ tp: 1, fp: 0, fn: 0 })
  })

  it('signale un stop manquant', () => {
    const goldTwoStops: ExtractedPlan = {
      days: [
        {
          dateText: 'Samedi',
          city: 'Paris',
          timezoneText: null,
          stops: [
            ...gold.days[0]!.stops,
            {
              name: 'musée d’Orsay',
              startText: '14h',
              endText: '16h',
              type: 'musée',
              sourceText: '14h-16h musée d’Orsay',
            },
          ],
        },
      ],
    }
    const prediction = structuredClone(gold)

    const result = scoreExtractionCase(
      { ...testCase, text: `${testCase.text}\n14h-16h musée d’Orsay` },
      goldTwoStops,
      prediction,
    )

    expect(result.errors).toContain('missing_stop')
    expect(result.stopCount).toEqual({ gold: 2, predicted: 1, matched: 1 })
    expect(result.fieldCounts.name.fn).toBe(1)
  })

  it('signale un stop en trop', () => {
    const prediction = structuredClone(gold)
    prediction.days[0]!.stops.push({
      name: 'musée d’Orsay',
      startText: '14h',
      endText: '16h',
      type: 'musée',
      sourceText: '14h-16h musée d’Orsay',
    })

    const result = scoreExtractionCase(
      { ...testCase, text: `${testCase.text}\n14h-16h musée d’Orsay` },
      gold,
      prediction,
    )

    expect(result.errors).toContain('extra_stop')
    expect(result.stopCount).toEqual({ gold: 1, predicted: 2, matched: 1 })
    expect(result.fieldCounts.name.fp).toBe(1)
  })

  it('signale une ville et un type faux', () => {
    const prediction = structuredClone(gold)
    prediction.days[0]!.city = 'Lyon'
    prediction.days[0]!.stops[0]!.type = 'jardin'

    const result = scoreExtractionCase(testCase, gold, prediction)

    expect(result.errors).toContain('wrong_city')
    expect(result.errors).toContain('wrong_type')
    expect(result.fieldCounts.city).toEqual({ tp: 0, fp: 1, fn: 1 })
    expect(result.fieldCounts.type).toEqual({ tp: 0, fp: 1, fn: 1 })
  })

  it('compte une sortie de schéma invalide comme un échec', () => {
    const result = scoreExtractionCase(testCase, gold, {})

    expect(result.schemaValid).toBe(false)
    expect(result.errors).toEqual(['schema'])
    expect(result.fieldCounts.name.fn).toBe(1)
  })

  it('compte une erreur fournisseur comme un échec', () => {
    const result = scoreExtractionCase(testCase, gold, null, 'panne réseau')

    expect(result.schemaValid).toBe(false)
    expect(result.providerError).toBe('panne réseau')
    expect(result.errors).toEqual(['provider'])
  })
})
