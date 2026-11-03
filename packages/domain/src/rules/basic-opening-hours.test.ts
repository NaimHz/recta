import { describe, expect, it } from 'vitest'
import type { Plan, Stop } from '../plan'
import { SCHEMA_VERSION } from '../version'
import { basicOpeningHours } from './basic-opening-hours'
import { verifyPlan } from './engine'

function verifyOpeningHours(plan: Plan) {
  return verifyPlan(plan, [basicOpeningHours])
}

function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    id: 'stop-1',
    name: 'Lieu',
    sourceText: null,
    type: null,
    resolution: 'resolved',
    place: {
      id: 'place-1',
      name: 'Lieu',
      coordinates: null,
      address: null,
      category: null,
      openingHoursRaw: '09:00-18:00',
      openingHours: {
        opensAt: '09:00',
        closesAt: '18:00',
        closedOn: [],
        raw: '09:00-18:00',
      },
      source: {
        provider: 'fixture',
        sourceDate: '2026-10-24',
        retrievedAt: null,
      },
    },
    start: '09:00',
    end: '11:00',
    windowSource: 'explicit',
    ...overrides,
  }
}

function makePlan(date: string | null, stops: Stop[]): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    cityId: 'test-city',
    days: [{ id: 'day-1', date, timezone: 'Europe/Paris', stops }],
    constraints: [],
  }
}

describe('basicOpeningHours', () => {
  it('flags a stop that ends after closing time with evidence', () => {
    const plan = makePlan('2026-10-24', [
      makeStop(),
      makeStop({
        id: 'stop-2',
        start: '12:00',
        end: '13:30',
      }),
      makeStop({
        id: 'stop-3',
        start: '17:30',
        end: '19:00',
        place: {
          id: 'place-3',
          name: 'Musée',
          coordinates: null,
          address: null,
          category: null,
          openingHoursRaw: '09:30-18:00; fermé Mon',
          openingHours: {
            opensAt: '09:30',
            closesAt: '18:00',
            closedOn: ['Mon'],
            raw: '09:30-18:00; fermé Mon',
          },
          source: {
            provider: 'fixture',
            sourceDate: '2026-10-24',
            retrievedAt: null,
          },
        },
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('violation')
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      id: 'outside_opening_hours:stop-3',
      code: 'outside_opening_hours',
      severity: 'error',
      stopIds: ['stop-3'],
      evidence: [
        {
          source: 'fixture',
          sourceDate: '2026-10-24',
          retrievedAt: null,
          url: null,
          attribution: null,
          raw: '09:30-18:00; fermé Mon',
          fields: {
            placeName: 'Musée',
            weekday: 'Sat',
            opensAt: '09:30',
            closesAt: '18:00',
            stopStart: '17:30',
            stopEnd: '19:00',
            side: 'after_closing',
          },
        },
      ],
    })
    expect(result.undetermined).toEqual([])
  })

  it('flags a stop on a closing day', () => {
    const plan = makePlan('2026-10-26', [
      makeStop({
        id: 'stop-1',
        start: '15:00',
        end: '17:00',
        place: {
          id: 'place-1',
          name: 'Musée',
          coordinates: null,
          address: null,
          category: null,
          openingHoursRaw: '09:30-18:00; fermé Mon',
          openingHours: {
            opensAt: '09:30',
            closesAt: '18:00',
            closedOn: ['Mon'],
            raw: '09:30-18:00; fermé Mon',
          },
          source: {
            provider: 'fixture',
            sourceDate: '2026-10-24',
            retrievedAt: null,
          },
        },
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('violation')
    expect(result.issues[0]).toMatchObject({
      code: 'place_closed_day',
      severity: 'error',
      message: 'Le lieu Musée est fermé le lundi.',
    })
  })

  it('flags a stop that starts before opening time', () => {
    const plan = makePlan('2026-10-24', [
      makeStop({
        id: 'stop-1',
        start: '08:00',
        end: '09:30',
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('violation')
    expect(result.issues[0]).toMatchObject({
      code: 'outside_opening_hours',
      message: "Le stop commence à 08:00, avant l'ouverture de 09:00.",
      evidence: [{ fields: { side: 'before_opening' } }],
    })
  })

  it('returns conforme when every stop fits the opening window', () => {
    const plan = makePlan('2026-10-24', [
      makeStop({ id: 'stop-1' }),
      makeStop({ id: 'stop-2', start: '12:00', end: '13:30' }),
      makeStop({ id: 'stop-3', start: '15:00', end: '17:00' }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('conforme')
    expect(result.issues).toEqual([])
  })

  it('returns indéterminé when opening hours are missing, without an issue', () => {
    const plan = makePlan('2026-10-24', [
      makeStop({
        place: {
          id: 'place-1',
          name: 'Lieu sans horaires',
          coordinates: null,
          address: null,
          category: null,
          openingHoursRaw: null,
          openingHours: null,
          source: {
            provider: 'fixture',
            sourceDate: '2026-10-24',
            retrievedAt: null,
          },
        },
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('indéterminé')
    expect(result.issues).toEqual([])
    expect(result.undetermined).toEqual([
      {
        codes: ['place_closed_day', 'outside_opening_hours'],
        stopIds: ['stop-1'],
        reason: 'missing_hours',
      },
    ])
  })

  it('reports one issue when a stop overflows both ends', () => {
    const result = verifyOpeningHours(
      makePlan('2026-10-24', [makeStop({ start: '08:00', end: '19:00' })]),
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      code: 'outside_opening_hours',
      message:
        "Le stop commence à 08:00, avant l'ouverture de 09:00. Le stop finit à 19:00, après la fermeture de 18:00.",
      evidence: [{ fields: { side: 'both' } }],
    })
  })

  it('treats a stop that crosses midnight as ending after closing', () => {
    const result = verifyOpeningHours(
      makePlan('2026-10-24', [makeStop({ start: '17:00', end: '01:00' })]),
    )

    expect(result.issues[0]).toMatchObject({
      code: 'outside_opening_hours',
      evidence: [{ fields: { side: 'after_closing' } }],
    })
  })

  it('caps the severity when the window is not fully written', () => {
    const result = verifyOpeningHours(
      makePlan('2026-10-24', [
        makeStop({ start: '17:00', end: '19:00', windowSource: 'default_duration' }),
      ]),
    )

    expect(result.issues[0]).toMatchObject({
      code: 'outside_opening_hours',
      severity: 'warning',
    })
  })

  it('still flags a closing day when the stop has no time', () => {
    const result = verifyOpeningHours(
      makePlan('2026-10-26', [
        makeStop({
          start: null,
          end: null,
          windowSource: 'unknown',
          place: {
            id: 'place-1',
            name: 'Musée',
            coordinates: null,
            address: null,
            category: null,
            openingHoursRaw: '09:30-18:00; fermé Mon',
            openingHours: {
              opensAt: '09:30',
              closesAt: '18:00',
              closedOn: ['Mon'],
              raw: '09:30-18:00; fermé Mon',
            },
            source: { provider: 'fixture', sourceDate: '2026-10-24', retrievedAt: null },
          },
        }),
      ]),
    )

    expect(result.status).toBe('violation')
    expect(result.issues[0]?.code).toBe('place_closed_day')
  })

  it('returns indéterminé for a stop without time on an open day', () => {
    const result = verifyOpeningHours(
      makePlan('2026-10-24', [makeStop({ start: null, end: null, windowSource: 'unknown' })]),
    )

    expect(result.status).toBe('indéterminé')
    expect(result.undetermined).toEqual([
      { codes: ['outside_opening_hours'], stopIds: ['stop-1'], reason: 'time_unknown' },
    ])
  })

  it('returns indéterminé for an unresolved place', () => {
    const result = verifyOpeningHours(
      makePlan('2026-10-24', [makeStop({ resolution: 'not_found', place: null })]),
    )

    expect(result.status).toBe('indéterminé')
    expect(result.undetermined[0]?.reason).toBe('place_unresolved')
  })

  it('returns indéterminé for every stop of a day without date', () => {
    const result = verifyOpeningHours(
      makePlan(null, [makeStop(), makeStop({ id: 'stop-2', start: '12:00', end: '13:00' })]),
    )

    expect(result.status).toBe('indéterminé')
    expect(result.issues).toEqual([])
    expect(result.undetermined.map((entry) => [entry.stopIds, entry.reason])).toEqual([
      [['stop-1'], 'date_unknown'],
      [['stop-2'], 'date_unknown'],
    ])
  })
})
