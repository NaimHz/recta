import { describe, expect, it } from 'vitest'
import {
  COORDINATES,
  GARE_LOUVRE_MARLY_WALK,
  PARIS_FACTS,
  dayPlan,
  locatedStop,
  transitLeg,
  walkMatrix,
  withTravel,
} from './__fixtures__/plans'
import { travelTime } from './travel-time'

const DATE = '2026-11-10'
const gareToLouvre = transitLeg(
  'gare',
  'louvre',
  '2026-11-10T07:00:00.000Z',
  '2026-11-10T07:23:00Z',
)
const facts = withTravel(PARIS_FACTS, {
  walk: [GARE_LOUVRE_MARLY_WALK],
  transit: [gareToLouvre],
})

function plan(louvreStart: string) {
  return dayPlan(DATE, [
    locatedStop('gare', COORDINATES.gareDuNord, '07:30', '08:00'),
    locatedStop('louvre', COORDINATES.louvre, louvreStart, '11:00'),
  ])
}

describe('travelTime', () => {
  it('signale un écart plus court que le trajet le plus rapide', () => {
    const findings = travelTime.run({ plan: plan('08:10'), facts })

    expect(findings).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          id: 'travel_time_infeasible:gare,louvre',
          severity: 'error',
          message:
            'De gare à louvre : 23 min au plus vite en transports en commun, le plan en laisse 10.',
          evidence: [
            expect.objectContaining({ source: 'osrm' }),
            expect.objectContaining({
              source: 'transitous',
              fields: expect.objectContaining({
                gapMinutes: 10,
                travelMinutes: 23,
                mode: 'transit',
              }),
            }),
          ],
        }),
      },
    ])
  })

  it('signale une marge inférieure à 10 minutes', () => {
    const findings = travelTime.run({ plan: plan('08:30'), facts })

    expect(findings).toEqual([
      { kind: 'pass', code: 'travel_time_infeasible', stopIds: ['gare', 'louvre'] },
      {
        kind: 'issue',
        issue: expect.objectContaining({ code: 'insufficient_buffer', severity: 'warning' }),
      },
    ])
  })

  it('valide un écart suffisant', () => {
    expect(travelTime.run({ plan: plan('08:45'), facts })).toEqual([
      { kind: 'pass', code: 'travel_time_infeasible', stopIds: ['gare', 'louvre'] },
      { kind: 'pass', code: 'insufficient_buffer', stopIds: ['gare', 'louvre'] },
    ])
  })

  it('retient la marche quand les transports ne proposent rien', () => {
    const findings = travelTime.run({
      plan: dayPlan(DATE, [
        locatedStop('louvre', COORDINATES.louvre, '09:00', '11:00'),
        locatedStop('marly', COORDINATES.cafeMarly, '11:01', '12:00'),
      ]),
      facts: withTravel(PARIS_FACTS, {
        walk: [GARE_LOUVRE_MARLY_WALK],
        transit: [transitLeg('louvre', 'marly', '2026-11-10T10:00:00.000Z', null)],
      }),
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: {
        code: 'travel_time_infeasible',
        message: expect.stringContaining('2 min au plus vite à pied'),
      },
    })
  })

  it('ne conclut pas à l’infaisabilité sans réponse des transports', () => {
    const findings = travelTime.run({
      plan: plan('08:10'),
      facts: withTravel(PARIS_FACTS, { walk: [GARE_LOUVRE_MARLY_WALK] }),
    })

    expect(findings).toEqual([
      {
        kind: 'undetermined',
        undetermined: {
          codes: ['travel_time_infeasible', 'insufficient_buffer'],
          stopIds: ['gare', 'louvre'],
          reason: 'transit_unavailable',
        },
      },
    ])
  })

  it('valide sans transports quand la marche seule tient avec la marge', () => {
    expect(
      travelTime.run({
        plan: plan('09:00'),
        facts: withTravel(PARIS_FACTS, { walk: [GARE_LOUVRE_MARLY_WALK] }),
      }),
    ).toEqual([
      { kind: 'pass', code: 'travel_time_infeasible', stopIds: ['gare', 'louvre'] },
      { kind: 'pass', code: 'insufficient_buffer', stopIds: ['gare', 'louvre'] },
    ])
  })

  it('rend indéterminé un lieu sans coordonnées et laisse les chevauchements à leur règle', () => {
    expect(
      travelTime.run({
        plan: dayPlan(DATE, [
          locatedStop('gare', null, '07:30', '08:00'),
          locatedStop('louvre', COORDINATES.louvre, '08:30', '11:00'),
        ]),
        facts,
      })[0],
    ).toMatchObject({ kind: 'undetermined', undetermined: { reason: 'missing_coordinates' } })
    expect(travelTime.run({ plan: plan('07:50'), facts })).toEqual([])
  })

  it('mesure l’écart en temps réel à travers le passage à l’heure d’été', () => {
    const findings = travelTime.run({
      plan: dayPlan('2026-03-29', [
        locatedStop('bar', COORDINATES.louvre, '00:30', '01:50'),
        locatedStop('hotel', COORDINATES.cafeMarly, '03:10', '09:00'),
      ]),
      facts: withTravel(PARIS_FACTS, {
        walk: [
          walkMatrix(
            ['bar', 'hotel'],
            [
              [0, 1800],
              [1800, 0],
            ],
            [
              [0, 2400],
              [2400, 0],
            ],
          ),
        ],
        transit: [transitLeg('bar', 'hotel', '2026-03-29T00:50:00.000Z', null)],
      }),
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: {
        code: 'travel_time_infeasible',
        message: 'De bar à hotel : 30 min au plus vite à pied, le plan en laisse 20.',
      },
    })
  })
})
