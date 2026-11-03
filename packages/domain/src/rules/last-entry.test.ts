import { describe, expect, it } from 'vitest'
import {
  PARIS_FACTS,
  curatedSource,
  osmPlace,
  planOn,
  stopAt,
  withPlaceFacts,
} from './__fixtures__/plans'
import { lastEntry } from './last-entry'

const louvre = osmPlace(
  'Musée du Louvre',
  'Mo,Th,Sa,Su 09:00-18:00; We,Fr 09:00-21:00; Tu off',
  'osm:relation/7515426',
)
const facts = withPlaceFacts(PARIS_FACTS, louvre.id, [
  {
    key: 'last_entry_before_close_minutes',
    value: 60,
    source: curatedSource('https://www.louvre.fr/en/visit'),
  },
])

describe('lastEntry', () => {
  it('signale un stop qui commence après la dernière entrée', () => {
    const findings = lastEntry.run({
      plan: planOn('2026-11-02', stopAt(louvre, '17:15', '18:00')),
      facts,
    })

    expect(findings).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          code: 'after_last_entry',
          severity: 'error',
          message:
            'Le stop commence à 17:15, après la dernière entrée de 17:00 (fermeture à 18:00).',
          evidence: [
            expect.objectContaining({ source: 'curated', url: 'https://www.louvre.fr/en/visit' }),
            expect.objectContaining({
              source: 'osm',
              fields: expect.objectContaining({ lastEntryAt: '17:00' }),
            }),
          ],
        }),
      },
    ])
  })

  it('accepte une entrée pile à l’heure limite et suit la nocturne', () => {
    expect(
      lastEntry.run({ plan: planOn('2026-11-02', stopAt(louvre, '17:00', '18:00')), facts }),
    ).toEqual([{ kind: 'pass', code: 'after_last_entry', stopIds: ['stop-1'] }])
    expect(
      lastEntry.run({ plan: planOn('2026-11-04', stopAt(louvre, '19:30', '20:30')), facts }),
    ).toEqual([{ kind: 'pass', code: 'after_last_entry', stopIds: ['stop-1'] }])
  })

  it('ne contrôle pas sans fait, ni hors des plages d’ouverture', () => {
    const plan = planOn('2026-11-02', stopAt(louvre, '17:15', '18:00'))

    expect(lastEntry.run({ plan, facts: PARIS_FACTS })).toEqual([])
    expect(
      lastEntry.run({ plan: planOn('2026-11-03', stopAt(louvre, '17:15', '18:00')), facts }),
    ).toEqual([])
  })

  it('rend indéterminé un stop sans heure', () => {
    expect(
      lastEntry.run({ plan: planOn('2026-11-02', stopAt(louvre, null, null)), facts })[0],
    ).toMatchObject({ kind: 'undetermined', undetermined: { reason: 'time_unknown' } })
  })
})
