import { describe, expect, it } from 'vitest'
import { verifyOpeningHours } from './opening-hours'
import type { Plan, Stop } from './plan'

function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    id: 'stop-1',
    place: {
      id: 'place-1',
      name: 'Lieu',
      openingHours: {
        opensAt: '09:00',
        closesAt: '18:00',
        closedOn: [],
        raw: '09:00-18:00',
      },
    },
    start: '09:00',
    end: '11:00',
    ...overrides,
  }
}

function makePlan(date: string, stops: Stop[]): Plan {
  return {
    schemaVersion: 1,
    days: [{ date, timezone: 'Europe/Paris', stops }],
  }
}

describe('verifyOpeningHours', () => {
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
          openingHours: {
            opensAt: '09:30',
            closesAt: '18:00',
            closedOn: ['Mon'],
            raw: '09:30-18:00; fermé Mon',
          },
        },
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('violation')
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      code: 'stop_after_closing',
      severity: 'error',
      stopId: 'stop-3',
      evidence: {
        source: 'fixture',
        sourceDate: '2026-10-24',
        retrievedAt: null,
        raw: '09:30-18:00; fermé Mon',
        fields: {
          placeName: 'Musée',
          weekday: 'Sat',
          opensAt: '09:30',
          closesAt: '18:00',
          stopStart: '17:30',
          stopEnd: '19:00',
        },
      },
    })
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
          openingHours: {
            opensAt: '09:30',
            closesAt: '18:00',
            closedOn: ['Mon'],
            raw: '09:30-18:00; fermé Mon',
          },
        },
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('violation')
    expect(result.issues[0]).toMatchObject({
      code: 'place_closed',
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
      code: 'stop_before_opening',
      message: "Le stop commence à 08:00, avant l'ouverture de 09:00.",
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
          openingHours: null,
        },
      }),
    ])

    const result = verifyOpeningHours(plan)

    expect(result.status).toBe('indéterminé')
    expect(result.issues).toEqual([])
  })
})
