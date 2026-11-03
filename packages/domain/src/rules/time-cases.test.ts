import { describe, expect, it } from 'vitest'
import type { Coordinates, IssueCode, IssueSeverity, Stop, VerificationStatus } from '../plan'
import {
  COORDINATES,
  GARE_LOUVRE_MARLY_WALK,
  LOUVRE_DEFENSE_MARLY_WALK,
  PARIS_FACTS,
  dayPlan,
  locatedStop,
  transitLeg,
  withTravel,
} from './__fixtures__/plans'
import { verifyPlan } from './engine'
import type { TravelFacts } from './rule'

type TimeCase = {
  label: string
  stops: Stop[]
  travel: Partial<TravelFacts>
  expected: { status: VerificationStatus; issues: Array<[IssueCode, IssueSeverity]> }
}

function open(id: string, coordinates: Coordinates | null, start: string, end: string): Stop {
  const stop = locatedStop(id, coordinates, start, end)

  return { ...stop, place: stop.place ? { ...stop.place, openingHoursRaw: '24/7' } : null }
}

const gareToLouvre = transitLeg(
  'gare',
  'louvre',
  '2026-11-10T07:00:00.000Z',
  '2026-11-10T07:23:00Z',
)
const gareLouvreTravel = { walk: [GARE_LOUVRE_MARLY_WALK], transit: [gareToLouvre] }

const CASES: TimeCase[] = [
  {
    label: 'trajet infaisable : Gare du Nord 08:00 → Louvre 08:10',
    stops: [
      open('gare', COORDINATES.gareDuNord, '07:30', '08:00'),
      open('louvre', COORDINATES.louvre, '08:10', '11:00'),
    ],
    travel: gareLouvreTravel,
    expected: { status: 'violation', issues: [['travel_time_infeasible', 'error']] },
  },
  {
    label: 'marge insuffisante : 23 min de métro pour 30 min d’écart',
    stops: [
      open('gare', COORDINATES.gareDuNord, '07:30', '08:00'),
      open('louvre', COORDINATES.louvre, '08:30', '11:00'),
    ],
    travel: gareLouvreTravel,
    expected: { status: 'violation', issues: [['insufficient_buffer', 'warning']] },
  },
  {
    label: 'chevauchement : Louvre jusqu’à 11:00, déjeuner à 10:30',
    stops: [
      open('louvre', COORDINATES.louvre, '09:00', '11:00'),
      open('marly', COORDINATES.cafeMarly, '10:30', '12:00'),
    ],
    travel: { walk: [GARE_LOUVRE_MARLY_WALK] },
    expected: { status: 'violation', issues: [['stop_overlap', 'error']] },
  },
  {
    label: 'demi-journée éclatée : Louvre → La Défense → Café Marly',
    stops: [
      open('louvre', COORDINATES.louvre, '09:00', '11:00'),
      open('defense', COORDINATES.laDefense, '11:45', '12:45'),
      open('marly', COORDINATES.cafeMarly, '13:30', '14:30'),
    ],
    travel: {
      walk: [LOUVRE_DEFENSE_MARLY_WALK],
      transit: [
        transitLeg('louvre', 'defense', '2026-11-10T10:00:00.000Z', '2026-11-10T10:30:00Z'),
        transitLeg('defense', 'marly', '2026-11-10T11:45:00.000Z', '2026-11-10T12:20:00Z'),
      ],
    },
    expected: { status: 'violation', issues: [['fragmented_half_day', 'warning']] },
  },
  {
    label: 'journée surchargée : de 07:00 à 22:30',
    stops: [
      open('marche', null, '07:00', '09:00'),
      open('musee', null, '10:00', '17:00'),
      open('diner', null, '21:00', '22:30'),
    ],
    travel: {},
    expected: { status: 'violation', issues: [['overloaded_day', 'warning']] },
  },
  {
    label: 'conforme : 45 min pour 23 min de métro',
    stops: [
      open('gare', COORDINATES.gareDuNord, '07:30', '08:00'),
      open('louvre', COORDINATES.louvre, '08:45', '11:00'),
    ],
    travel: gareLouvreTravel,
    expected: { status: 'conforme', issues: [] },
  },
  {
    label: 'indéterminé : transports en panne et marche trop longue',
    stops: [
      open('gare', COORDINATES.gareDuNord, '07:30', '08:00'),
      open('louvre', COORDINATES.louvre, '08:10', '11:00'),
    ],
    travel: {
      walk: [GARE_LOUVRE_MARLY_WALK],
      unavailable: [
        { service: 'transitous', scope: 'gare->louvre', reason: 'Transitous HTTP 502' },
      ],
    },
    expected: { status: 'indéterminé', issues: [] },
  },
  {
    label: 'indéterminé : lieux sans coordonnées',
    stops: [open('a', null, '07:30', '08:00'), open('b', null, '08:10', '11:00')],
    travel: {},
    expected: { status: 'indéterminé', issues: [] },
  },
]

function run(testCase: TimeCase) {
  return verifyPlan(dayPlan('2026-11-10', testCase.stops), withTravel(PARIS_FACTS, testCase.travel))
}

describe('règles de temps : un cas par type', () => {
  it.each(CASES)('$label', (testCase) => {
    const result = run(testCase)

    expect(result.status).toBe(testCase.expected.status)
    expect(result.issues.map((issue) => [issue.code, issue.severity])).toEqual(
      testCase.expected.issues,
    )
  })

  it('couvre les cinq types de temps', () => {
    const codes = new Set(
      CASES.flatMap((testCase) => testCase.expected.issues.map(([code]) => code)),
    )

    expect(codes).toEqual(
      new Set([
        'travel_time_infeasible',
        'insufficient_buffer',
        'stop_overlap',
        'fragmented_half_day',
        'overloaded_day',
      ]),
    )
  })
})
