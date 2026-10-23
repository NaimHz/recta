import { describe, expect, it } from 'vitest'
import { findInventions } from './validate'

const text = `Samedi 24 octobre, Paris
09:00-11:00 Musée du Louvre
12:30 déjeuner au Comptoir des Marronniers`

const plan = {
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
          type: null,
          sourceText: '09:00-11:00 Musée du Louvre',
        },
        {
          name: 'Comptoir des Marronniers',
          startText: '12:30',
          endText: null,
          type: null,
          sourceText: '12:30 déjeuner au Comptoir des Marronniers',
        },
      ],
    },
  ],
}

describe('findInventions', () => {
  it('accepte une extraction justifiée par le texte', () => {
    expect(findInventions(text, plan)).toEqual([])
  })

  it('tolère les accents, la casse et les apostrophes', () => {
    const result = findInventions(text.toUpperCase(), {
      days: [
        {
          dateText: 'samedi 24 octobre',
          city: 'paris',
          timezoneText: null,
          stops: [
            {
              name: 'musee du louvre',
              startText: '09:00',
              endText: '11:00',
              type: null,
              sourceText: '09:00-11:00 musee du louvre',
            },
          ],
        },
      ],
    })

    expect(result).toEqual([])
  })

  it('signale un nom absent de la citation', () => {
    const inventions = findInventions(text, {
      days: [
        {
          ...plan.days[0]!,
          stops: [
            {
              ...plan.days[0]!.stops[0]!,
              name: "Musée d'Orsay",
            },
          ],
        },
      ],
    })

    expect(inventions).toEqual([
      {
        path: 'days[0].stops[0].name',
        value: "Musée d'Orsay",
      },
    ])
  })

  it('signale une citation absente du texte', () => {
    const inventions = findInventions(text, {
      days: [
        {
          ...plan.days[0]!,
          stops: [
            {
              ...plan.days[0]!.stops[0]!,
              sourceText: 'Un texte qui n’existe pas',
            },
          ],
        },
      ],
    })

    expect(inventions[0]?.path).toBe('days[0].stops[0].sourceText')
  })

  it('signale une date ou une ville non justifiée', () => {
    const inventions = findInventions(text, {
      days: [
        {
          ...plan.days[0]!,
          dateText: 'Dimanche 25 octobre',
          city: 'Lyon',
        },
      ],
    })

    expect(inventions.map((invention) => invention.path)).toEqual([
      'days[0].dateText',
      'days[0].city',
    ])
  })

  it('signale un type absent de la citation', () => {
    const inventions = findInventions(text, {
      days: [
        {
          ...plan.days[0]!,
          stops: [
            {
              ...plan.days[0]!.stops[0]!,
              type: 'restaurant',
            },
          ],
        },
      ],
    })

    expect(inventions).toEqual([
      {
        path: 'days[0].stops[0].type',
        value: 'restaurant',
      },
    ])
  })

  it('ignore les champs null', () => {
    const inventions = findInventions(text, {
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
              sourceText: 'Musée du Louvre',
            },
          ],
        },
      ],
    })

    expect(inventions).toEqual([])
  })
})
