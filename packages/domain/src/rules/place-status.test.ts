import { describe, expect, it } from 'vitest'
import {
  PARIS_FACTS,
  curatedSource,
  osmPlace,
  planOn,
  stopAt,
  withPlaceFacts,
} from './__fixtures__/plans'
import { placeStatus } from './place-status'

const pompidou = osmPlace('Centre Pompidou', 'We-Mo 11:00-21:00', 'osm:way/55503397')
const plan = planOn('2026-11-04', stopAt(pompidou, '14:00', '16:00'))
const source = curatedSource(
  'https://www.centrepompidou.fr/en/centre-pompidou-is-transforming-itself',
)

describe('placeStatus', () => {
  it('signale un lieu fermé temporairement avec la source curatée', () => {
    const facts = withPlaceFacts(PARIS_FACTS, pompidou.id, [
      { key: 'business_status', value: 'closed_temporarily', source },
    ])

    expect(placeStatus.run({ plan, facts })).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          id: 'place_not_operating:stop-1',
          severity: 'error',
          message: 'Le lieu Centre Pompidou est fermé temporairement.',
          evidence: [
            expect.objectContaining({
              source: 'curated',
              url: source.url,
              sourceDate: '2026-11-03',
              raw: 'closed_temporarily',
            }),
          ],
        }),
      },
    ])
  })

  it('valide un lieu en activité', () => {
    const facts = withPlaceFacts(PARIS_FACTS, pompidou.id, [
      { key: 'business_status', value: 'operational', source },
    ])

    expect(placeStatus.run({ plan, facts })).toEqual([
      { kind: 'pass', code: 'place_not_operating', stopIds: ['stop-1'] },
    ])
  })

  it('rend indéterminé un statut inconnu', () => {
    const facts = withPlaceFacts(PARIS_FACTS, pompidou.id, [
      { key: 'business_status', value: 'unknown', source },
    ])

    expect(placeStatus.run({ plan, facts })[0]).toMatchObject({
      kind: 'undetermined',
      undetermined: { reason: 'unknown' },
    })
  })

  it('ne contrôle pas un lieu sans fait', () => {
    expect(placeStatus.run({ plan, facts: PARIS_FACTS })).toEqual([])
  })
})
