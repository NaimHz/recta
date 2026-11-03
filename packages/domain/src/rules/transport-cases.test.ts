import { describe, expect, it } from 'vitest'
import type { Stop } from '../plan'
import {
  COORDINATES,
  PARIS_FACTS,
  dayPlan,
  departureCheck,
  homeTravel,
  locatedStop,
  withTravel,
} from './__fixtures__/plans'
import { verifyPlan } from './engine'

function bar(end: string): Stop {
  const stop = locatedStop('bar', COORDINATES.saintMichel, '22:00', end)

  return { ...stop, place: stop.place ? { ...stop.place, openingHoursRaw: '24/7' } : null }
}

describe('dernier départ : cas réels Saint-Michel → Versailles', () => {
  it('signale un retour en RER à 00:15 : le prochain RER part à 05:16', () => {
    const result = verifyPlan(
      dayPlan('2026-11-10', [bar('00:15')], [homeTravel('bar', '00:15')]),
      withTravel(PARIS_FACTS, {
        announced: [departureCheck('2026-11-10T23:15:00.000Z', '2026-11-11T04:16:00Z')],
      }),
    )

    expect(result.status).toBe('violation')
    expect(result.issues.map((issue) => [issue.code, issue.message])).toEqual([
      ['last_departure_missed', 'Aucun RER après 00:15 avant 05:16.'],
    ])
  })

  it('accepte un retour à 23:30, avant le dernier train de 23:45', () => {
    const result = verifyPlan(
      dayPlan('2026-11-10', [bar('23:30')], [homeTravel('bar', '23:30')]),
      withTravel(PARIS_FACTS, {
        announced: [departureCheck('2026-11-10T22:30:00.000Z', '2026-11-10T22:45:00Z')],
      }),
    )

    expect(result.issues).toEqual([])
    expect(result.checks.find((count) => count.code === 'last_departure_missed')).toMatchObject({
      executed: 1,
      undetermined: 0,
    })
  })
})
