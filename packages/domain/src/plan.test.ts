import { describe, expect, it } from 'vitest'
import {
  ConstraintSchema,
  ISSUE_CODES,
  IssueSchema,
  PlanSchema,
  RepairOperationSchema,
  RepairProposalSchema,
  StopSchema,
  VerificationResultSchema,
  type Place,
  type RepairProposal,
  type Stop,
  type VerificationResult,
} from './plan'
import { SCHEMA_VERSION } from './version'

const place: Place = {
  id: 'osm:node/1',
  name: 'Musée',
  coordinates: { lat: 45.75, lon: 4.85 },
  address: '1 rue du Test',
  category: 'tourism:museum',
  openingHoursRaw: 'Tu-Sa 10:00-18:00',
  openingHours: {
    opensAt: '10:00',
    closesAt: '18:00',
    closedOn: ['Mon', 'Sun'],
    raw: '10:00-18:00',
  },
  source: { provider: 'osm', sourceDate: '2026-10-23', retrievedAt: '2026-10-23T07:37:01.372Z' },
}

const resolvedStop: Stop = {
  id: 'stop-1',
  name: 'Musée',
  sourceText: '10h-12h Musée',
  type: 'musée',
  resolution: 'resolved',
  place,
  start: '10:00',
  end: '12:00',
  windowSource: 'explicit',
}

const nightStop: Stop = {
  id: 'stop-2',
  name: 'Bar',
  sourceText: '22h-1h bar',
  type: 'bar',
  resolution: 'resolved',
  place: { ...place, id: 'osm:node/2', name: 'Bar', openingHoursRaw: 'Mo-Su 18:00-02:00' },
  start: '22:00',
  end: '01:00',
  windowSource: 'explicit',
}

const unresolvedStop: Stop = {
  id: 'stop-3',
  name: 'le petit café',
  sourceText: 'le matin, le petit café',
  type: null,
  resolution: 'ambiguous',
  place: null,
  start: '09:00',
  end: '12:00',
  windowSource: 'period',
}

const untimedStop: Stop = {
  id: 'stop-4',
  name: 'parc',
  sourceText: 'parc',
  type: 'parc',
  resolution: 'not_found',
  place: null,
  start: null,
  end: null,
  windowSource: 'unknown',
}

const repair: RepairProposal = {
  id: 'repair-1',
  issueIds: ['outside_opening_hours:stop-1', 'stop_overlap:stop-1,stop-3'],
  operations: [
    { kind: 'move_stop', stopId: 'stop-1', start: '14:00', end: '16:00' },
    { kind: 'replace_place', stopId: 'stop-2', place: { ...place, id: 'osm:node/3' } },
    { kind: 'remove_stop', stopId: 'stop-4' },
    { kind: 'reorder', dayId: 'day-1', stopIds: ['stop-3', 'stop-1'] },
  ],
  relaxedConstraintIds: ['constraint-max-travel'],
  status: 'partial',
  reason: 'Le temps de trajet maximal a été relâché pour garder le musée.',
}

const result: VerificationResult = {
  schemaVersion: SCHEMA_VERSION,
  status: 'violation',
  plan: {
    schemaVersion: SCHEMA_VERSION,
    cityId: 'test-city',
    days: [
      {
        id: 'day-1',
        date: '2026-11-03',
        timezone: 'Europe/Paris',
        stops: [resolvedStop, nightStop],
      },
      { id: 'day-2', date: null, timezone: 'Europe/Paris', stops: [unresolvedStop, untimedStop] },
    ],
    constraints: [
      {
        id: 'constraint-window',
        kind: 'stop_window',
        hard: true,
        priority: 0,
        origin: { kind: 'user_text', quote: 'musée avant midi' },
        stopId: 'stop-1',
        start: '09:00',
        end: '12:00',
      },
      {
        id: 'constraint-visit',
        kind: 'must_visit',
        hard: true,
        priority: 1,
        origin: { kind: 'user_text', quote: 'surtout le musée' },
        stopId: 'stop-1',
      },
      {
        id: 'constraint-bounds',
        kind: 'day_bounds',
        hard: false,
        priority: 2,
        origin: { kind: 'default' },
        dayId: 'day-1',
        start: '09:00',
        end: '23:00',
      },
      {
        id: 'constraint-meal',
        kind: 'meal',
        hard: false,
        priority: 3,
        origin: { kind: 'default' },
        dayId: 'day-1',
        start: '12:00',
        end: '14:00',
        minDurationMinutes: 45,
      },
      {
        id: 'constraint-max-travel',
        kind: 'max_travel_minutes',
        hard: false,
        priority: 4,
        origin: { kind: 'system' },
        dayId: null,
        maxMinutes: 40,
      },
      {
        id: 'constraint-order',
        kind: 'order',
        hard: true,
        priority: 5,
        origin: { kind: 'user_text', quote: 'le bar après le musée' },
        beforeStopId: 'stop-1',
        afterStopId: 'stop-2',
      },
    ],
  },
  issues: [
    {
      id: 'travel_time_infeasible:stop-1,stop-2',
      code: 'travel_time_infeasible',
      severity: 'error',
      message: 'Le trajet dure 24 min, le plan en laisse 10.',
      stopIds: ['stop-1', 'stop-2'],
      evidence: [
        {
          source: 'transitous',
          sourceDate: '2026-11-03',
          retrievedAt: '2026-11-03T08:46:00.000Z',
          url: 'https://api.transitous.org/api/v6/plan',
          attribution: 'Transitous, OpenStreetMap contributors',
          raw: '{"durationSeconds":1440}',
          fields: { gapMinutes: 10, travelMinutes: 24, mode: 'transit' },
        },
        {
          source: 'plan',
          sourceDate: null,
          retrievedAt: null,
          url: null,
          attribution: null,
          raw: '10h-12h Musée',
          fields: { quote: '10h-12h Musée', nested: { list: [1, 'deux', null] } },
        },
      ],
    },
  ],
  undetermined: [
    {
      codes: ['place_closed_day', 'outside_opening_hours'],
      stopIds: ['stop-3'],
      reason: 'date_unknown',
    },
  ],
}

function roundTrip<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value))
}

describe('PlanSchema et VerificationResultSchema', () => {
  it('sérialise et désérialise un résultat complet sans perte', () => {
    const parsed = VerificationResultSchema.parse(roundTrip(result))

    expect(parsed).toEqual(result)
  })

  it('couvre chaque variante de contrainte et de réparation', () => {
    expect(new Set(result.plan.constraints.map((constraint) => constraint.kind))).toEqual(
      new Set(ConstraintSchema.options.map((option) => option.shape.kind.value)),
    )
    expect(new Set(repair.operations.map((operation) => operation.kind))).toEqual(
      new Set(RepairOperationSchema.options.map((option) => option.shape.kind.value)),
    )
  })

  it('refuse une autre version de schéma', () => {
    expect(PlanSchema.safeParse({ ...result.plan, schemaVersion: 1 }).success).toBe(false)
  })
})

describe('StopSchema', () => {
  it('accepte un stop qui passe minuit', () => {
    expect(StopSchema.parse(roundTrip(nightStop))).toEqual(nightStop)
  })

  it('refuse un stop de durée nulle', () => {
    expect(StopSchema.safeParse({ ...resolvedStop, end: '10:00' }).success).toBe(false)
  })

  it('refuse un lieu sur un stop non résolu, et un stop résolu sans lieu', () => {
    expect(StopSchema.safeParse({ ...resolvedStop, resolution: 'ambiguous' }).success).toBe(false)
    expect(StopSchema.safeParse({ ...resolvedStop, place: null }).success).toBe(false)
  })

  it('refuse une fenêtre inconnue avec des heures, et une fenêtre connue sans heures', () => {
    expect(StopSchema.safeParse({ ...resolvedStop, windowSource: 'unknown' }).success).toBe(false)
    expect(StopSchema.safeParse({ ...untimedStop, windowSource: 'explicit' }).success).toBe(false)
    expect(StopSchema.safeParse({ ...resolvedStop, end: null }).success).toBe(false)
  })
})

describe('IssueSchema', () => {
  const issue = result.issues[0]

  it('connaît les 12 types de la taxonomie', () => {
    expect(ISSUE_CODES).toHaveLength(12)
  })

  it('refuse un code hors taxonomie', () => {
    expect(IssueSchema.safeParse({ ...issue, code: 'stop_after_closing' }).success).toBe(false)
  })

  it('refuse une issue sans preuve ou sans stop', () => {
    expect(IssueSchema.safeParse({ ...issue, evidence: [] }).success).toBe(false)
    expect(IssueSchema.safeParse({ ...issue, stopIds: [] }).success).toBe(false)
  })

  it('refuse une source de preuve inconnue', () => {
    const evidence = issue?.evidence[0]

    expect(
      IssueSchema.safeParse({ ...issue, evidence: [{ ...evidence, source: 'wikipedia' }] }).success,
    ).toBe(false)
  })
})

describe('RepairProposalSchema', () => {
  it('sérialise et désérialise une réparation sans perte', () => {
    expect(RepairProposalSchema.parse(roundTrip(repair))).toEqual(repair)
  })

  it('exige une raison pour une réparation partielle', () => {
    expect(RepairProposalSchema.safeParse({ ...repair, reason: null }).success).toBe(false)
    expect(
      RepairProposalSchema.safeParse({ ...repair, status: 'complete', reason: null }).success,
    ).toBe(true)
  })
})

describe('ConstraintSchema', () => {
  it('exige la citation quand la contrainte vient du texte', () => {
    expect(
      ConstraintSchema.safeParse({
        id: 'constraint-visit',
        kind: 'must_visit',
        hard: true,
        priority: 0,
        origin: { kind: 'user_text' },
        stopId: 'stop-1',
      }).success,
    ).toBe(false)
  })
})
