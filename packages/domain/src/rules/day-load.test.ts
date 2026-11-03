import { describe, expect, it } from 'vitest'
import { PARIS_FACTS, dayPlan, locatedStop } from './__fixtures__/plans'
import { dayLoad } from './day-load'

describe('dayLoad', () => {
  it('signale une journée de plus de 13 heures', () => {
    const findings = dayLoad.run({
      plan: dayPlan('2026-11-10', [
        locatedStop('marche', null, '07:00', '09:00'),
        locatedStop('musee', null, '10:00', '17:00'),
        locatedStop('diner', null, '21:00', '22:30'),
      ]),
      facts: PARIS_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          id: 'overloaded_day:marche,musee,diner',
          severity: 'warning',
          message: 'Journée de 15 h 30, de 07:00 à 22:30, au-delà de 13 h.',
        }),
      },
    ])
  })

  it('compte une soirée qui passe minuit', () => {
    const findings = dayLoad.run({
      plan: dayPlan('2026-11-10', [
        locatedStop('musee', null, '11:00', '13:00'),
        locatedStop('bar', null, '22:00', '01:00'),
      ]),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: { message: expect.stringContaining('14 h 00') },
    })
  })

  it('valide une journée raisonnable', () => {
    expect(
      dayLoad.run({
        plan: dayPlan('2026-11-10', [
          locatedStop('a', null, '09:00', '12:00'),
          locatedStop('b', null, '14:00', '19:00'),
        ]),
        facts: PARIS_FACTS,
      }),
    ).toEqual([{ kind: 'pass', code: 'overloaded_day', stopIds: ['a', 'b'] }])
  })

  it('rend indéterminé une journée courte avec un stop sans heure', () => {
    expect(
      dayLoad.run({
        plan: dayPlan('2026-11-10', [
          locatedStop('a', null, '09:00', '12:00'),
          locatedStop('b', null, null, null),
        ]),
        facts: PARIS_FACTS,
      })[0],
    ).toMatchObject({ kind: 'undetermined', undetermined: { reason: 'time_unknown' } })
  })
})
