import { describe, expect, it } from 'vitest'
import { LYON_FACTS, PARIS_FACTS, osmPlace, planOn, stopAt } from './__fixtures__/plans'
import { openingWindow } from './opening-window'

const severo = osmPlace('Le Severo', 'Mo-Fr 12:00-14:00,19:30-21:30')
const tony = osmPlace('Cité musée Tony Garnier', 'Tu-Sa 14:00-18:00')

describe('openingWindow', () => {
  it('signale un stop qui commence pendant une fermeture, avec la prochaine ouverture', () => {
    const findings = openingWindow.run({
      plan: planOn('2026-11-03', stopAt(severo, '14:30', '15:30')),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: {
        code: 'outside_opening_hours',
        severity: 'error',
        message: 'Le stop commence à 14:30, lieu fermé (ouverture à 19:30).',
        evidence: [{ fields: { side: 'before_opening', opensAt: '19:30', closesAt: null } }],
      },
    })
  })

  it('signale un stop qui finit après la fermeture', () => {
    const findings = openingWindow.run({
      plan: planOn('2026-11-03', stopAt(severo, '13:30', '14:30')),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: {
        message: 'Le stop finit à 14:30, après la fermeture de 14:00.',
        evidence: [{ fields: { side: 'after_closing', opensAt: '12:00', closesAt: '14:00' } }],
      },
    })
  })

  it('plafonne à warning une fin tirée d’une durée par défaut', () => {
    const findings = openingWindow.run({
      plan: planOn('2026-11-03', stopAt(severo, '13:00', '14:30', 'default_duration')),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({ kind: 'issue', issue: { severity: 'warning' } })
  })

  it('accepte un passage de minuit dans un lieu ouvert la nuit', () => {
    const place = osmPlace('Le Café Marly', 'Mo-Su 08:00-02:00')

    expect(
      openingWindow.run({
        plan: planOn('2026-11-03', stopAt(place, '22:00', '01:00')),
        facts: PARIS_FACTS,
      }),
    ).toEqual([{ kind: 'pass', code: 'outside_opening_hours', stopIds: ['stop-1'] }])
  })

  it('signale une période entièrement fermée en error', () => {
    const findings = openingWindow.run({
      plan: planOn('2026-11-03', stopAt(tony, '09:00', '12:00', 'period')),
      facts: LYON_FACTS,
    })

    expect(findings[0]).toMatchObject({ kind: 'issue', issue: { severity: 'error' } })
  })

  it('accepte une période partiellement ouverte', () => {
    expect(
      openingWindow.run({
        plan: planOn('2026-11-03', stopAt(severo, '19:00', '22:00', 'period')),
        facts: PARIS_FACTS,
      }),
    ).toEqual([{ kind: 'pass', code: 'outside_opening_hours', stopIds: ['stop-1'] }])
  })

  it.each([
    ['heure inconnue', '2026-11-03', null, 'time_unknown'],
    ['heure inexistante', '2027-03-28', '02:30', 'invalid_local_time'],
  ])('rend indéterminé : %s', (_label, date, start, reason) => {
    const place = osmPlace('Les Arts et Métiers', 'Mo-Su 07:00-02:00')
    const findings = openingWindow.run({
      plan: planOn(date, stopAt(place, start, start === null ? null : '03:30')),
      facts: PARIS_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'undetermined',
        undetermined: { codes: ['outside_opening_hours'], stopIds: ['stop-1'], reason },
      },
    ])
  })
})
