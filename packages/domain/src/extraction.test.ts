import { describe, expect, it } from 'vitest'
import { ExtractedPlanSchema } from './extraction'

const validPlan = {
  days: [
    {
      dateText: 'Samedi 24 octobre',
      city: 'Paris',
      timezoneText: null,
      stops: [
        {
          name: 'Musée du Louvre',
          startText: '09:00',
          endText: '11:00',
          type: 'musée',
          sourceText: '09:00-11:00 Musée du Louvre',
        },
      ],
    },
  ],
}

describe('ExtractedPlanSchema', () => {
  it('accepte une extraction complète', () => {
    expect(ExtractedPlanSchema.parse(validPlan).days[0]?.stops[0]?.name).toBe('Musée du Louvre')
  })

  it('accepte les champs absents sous forme de null', () => {
    const parsed = ExtractedPlanSchema.parse({
      days: [
        {
          dateText: null,
          city: null,
          timezoneText: null,
          stops: [
            {
              name: 'Louvre',
              startText: null,
              endText: null,
              type: null,
              sourceText: 'Louvre',
            },
          ],
        },
      ],
    })

    expect(parsed.days[0]?.stops[0]?.startText).toBeNull()
  })

  it('refuse un champ inconnu', () => {
    const result = ExtractedPlanSchema.safeParse({
      ...validPlan,
      source: 'inventé',
    })

    expect(result.success).toBe(false)
  })

  it('refuse un champ manquant même quand il peut être null', () => {
    const day = validPlan.days[0]!

    const result = ExtractedPlanSchema.safeParse({
      days: [
        {
          dateText: day.dateText,
          city: day.city,
          stops: day.stops,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('refuse une journée sans stop', () => {
    const result = ExtractedPlanSchema.safeParse({
      days: [
        {
          dateText: null,
          city: null,
          timezoneText: null,
          stops: [],
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('refuse un nom vide', () => {
    const result = ExtractedPlanSchema.safeParse({
      days: [
        {
          dateText: null,
          city: null,
          timezoneText: null,
          stops: [
            {
              name: '',
              startText: null,
              endText: null,
              type: null,
              sourceText: 'Louvre',
            },
          ],
        },
      ],
    })

    expect(result.success).toBe(false)
  })
})
