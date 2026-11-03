import { describe, expect, it } from 'vitest'
import { LYON_FACTS, PARIS_FACTS, osmPlace, planOn, stopAt } from './__fixtures__/plans'
import { dayClosure } from './day-closure'

describe('dayClosure', () => {
  it('signale un jour sans aucune plage d’ouverture', () => {
    const place = osmPlace('Cité musée Tony Garnier', 'Tu-Sa 14:00-18:00')
    const findings = dayClosure.run({
      plan: planOn('2026-11-02', stopAt(place, '15:00', '16:00')),
      facts: LYON_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          code: 'place_closed_day',
          severity: 'error',
          evidence: [
            expect.objectContaining({
              source: 'osm',
              raw: 'Tu-Sa 14:00-18:00',
              attribution: '© OpenStreetMap contributors',
            }),
          ],
        }),
      },
      { kind: 'pass', code: 'holiday_closure', stopIds: ['stop-1'] },
    ])
  })

  it('attribue la fermeture au férié quand le même jour ordinaire est ouvert', () => {
    const place = osmPlace(
      "Musée de l'Armée",
      'Nov-Mar: Mo-Su 10:00-17:00; Apr-Oct: Mo-Su 10:00-18:00; Apr-Sep: Tu 21:00+; Jan 1 off; May 1 off; Dec 25 off',
    )
    const findings = dayClosure.run({
      plan: planOn('2027-05-01', stopAt(place, '11:00', '12:00')),
      facts: PARIS_FACTS,
    })

    expect(findings[1]).toMatchObject({
      kind: 'issue',
      issue: {
        code: 'holiday_closure',
        message:
          "Le lieu Musée de l'Armée est fermé le 2027-05-01, jour férié ; il est ouvert le 2027-05-15.",
        evidence: [{ source: 'osm' }, { source: 'calendar', fields: { holiday: true } }],
      },
    })
  })

  it('garde la fermeture hebdomadaire un jour férié', () => {
    const place = osmPlace(
      'Musée des Arts et Métiers',
      'Tu-Th 10:00-18:00; Fr 10:00-21:00; Sa-Su 10:00-18:00',
    )
    const findings = dayClosure.run({
      plan: planOn('2027-03-29', stopAt(place, '10:30', '11:30')),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({ kind: 'issue', issue: { code: 'place_closed_day' } })
  })

  it('valide un jour ouvert, même si l’heure du stop est inconnue', () => {
    const place = osmPlace('Le Severo', 'Mo-Fr 12:00-14:00,19:30-21:30')

    expect(
      dayClosure.run({ plan: planOn('2026-11-03', stopAt(place, null, null)), facts: PARIS_FACTS }),
    ).toEqual([
      { kind: 'pass', code: 'place_closed_day', stopIds: ['stop-1'] },
      { kind: 'pass', code: 'holiday_closure', stopIds: ['stop-1'] },
    ])
  })

  it.each([
    ['date absente', null, osmPlace('Lieu', 'Mo-Su 10:00-18:00'), 'date_unknown'],
    ['lieu non résolu', '2026-11-03', null, 'place_unresolved'],
    ['horaires manquants', '2026-11-03', osmPlace('Lieu', null), 'missing_hours'],
    ['syntaxe invalide', '2026-11-03', osmPlace('Lieu', 'ouvert en semaine'), 'invalid_syntax'],
  ])('rend indéterminé : %s', (_label, date, place, reason) => {
    const findings = dayClosure.run({
      plan: planOn(date, stopAt(place, '10:00', '11:00')),
      facts: PARIS_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'undetermined',
        undetermined: {
          codes: ['place_closed_day', 'holiday_closure'],
          stopIds: ['stop-1'],
          reason,
        },
      },
    ])
  })
})
