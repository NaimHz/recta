import { describe, expect, it } from 'vitest'
import {
  ExtractionInventionError,
  ExtractionSchemaError,
  extractPlan,
  validateExtraction,
  type ExtractionClient,
} from './client'

const text = '09:00-11:00 Musée du Louvre'

const validOutput = {
  days: [
    {
      dateText: null,
      city: null,
      timezoneText: null,
      stops: [
        {
          name: 'Musée du Louvre',
          startText: '09:00',
          endText: '11:00',
          type: null,
          sourceText: '09:00-11:00 Musée du Louvre',
        },
      ],
    },
  ],
}

function clientReturning(value: unknown): ExtractionClient {
  return {
    extract: async () => value,
  }
}

describe('validateExtraction', () => {
  it('accepte une sortie conforme au schéma et au texte', () => {
    const validation = validateExtraction(text, validOutput)

    expect(validation.ok).toBe(true)
  })

  it('distingue une erreur de schéma', () => {
    const validation = validateExtraction(text, {
      ...validOutput,
      unexpected: true,
    })

    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.stage).toBe('schema')
  })

  it('distingue un champ inventé', () => {
    const validation = validateExtraction(text, {
      days: [
        {
          ...validOutput.days[0]!,
          city: 'Lyon',
        },
      ],
    })

    expect(validation.ok).toBe(false)
    if (!validation.ok && validation.stage === 'invention') {
      expect(validation.inventions[0]?.path).toBe('days[0].city')
    }
  })
})

describe('extractPlan', () => {
  it('retourne le plan validé', async () => {
    const plan = await extractPlan(text, clientReturning(validOutput))

    expect(plan.days[0]?.stops[0]?.name).toBe('Musée du Louvre')
  })

  it('lève une erreur de schéma', async () => {
    await expect(extractPlan(text, clientReturning({ days: [] }))).rejects.toBeInstanceOf(
      ExtractionSchemaError,
    )
  })

  it('lève une erreur quand un champ est inventé', async () => {
    await expect(
      extractPlan(
        text,
        clientReturning({
          days: [
            {
              ...validOutput.days[0]!,
              city: 'Lyon',
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(ExtractionInventionError)
  })
})
