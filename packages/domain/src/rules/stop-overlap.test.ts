import { describe, expect, it } from 'vitest'
import { COORDINATES, PARIS_FACTS, dayPlan, locatedStop } from './__fixtures__/plans'
import { stopOverlap } from './stop-overlap'

describe('stopOverlap', () => {
  it('signale deux stops qui se chevauchent, avec les citations du plan', () => {
    const findings = stopOverlap.run({
      plan: dayPlan('2026-11-10', [
        locatedStop('louvre', COORDINATES.louvre, '09:00', '11:00'),
        locatedStop('dejeuner', COORDINATES.cafeMarly, '10:30', '12:00'),
      ]),
      facts: PARIS_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'issue',
        issue: expect.objectContaining({
          id: 'stop_overlap:louvre,dejeuner',
          severity: 'error',
          message: 'louvre (09:00-11:00) et dejeuner (10:30-12:00) se chevauchent de 30 min.',
          evidence: [
            expect.objectContaining({ source: 'plan', raw: '09:00-11:00 louvre' }),
            expect.objectContaining({ source: 'plan', raw: '10:30-12:00 dejeuner' }),
          ],
        }),
      },
    ])
  })

  it('détecte un chevauchement d’une minute', () => {
    const findings = stopOverlap.run({
      plan: dayPlan('2026-11-10', [
        locatedStop('a', null, '09:00', '11:01'),
        locatedStop('b', null, '11:00', '12:00'),
      ]),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: { severity: 'error', message: expect.stringContaining('se chevauchent de 1 min') },
    })
  })

  it('accepte deux stops bout à bout', () => {
    expect(
      stopOverlap.run({
        plan: dayPlan('2026-11-10', [
          locatedStop('a', null, '09:00', '11:00'),
          locatedStop('b', null, '11:00', '12:00'),
        ]),
        facts: PARIS_FACTS,
      }),
    ).toEqual([{ kind: 'pass', code: 'stop_overlap', stopIds: ['a', 'b'] }])
  })

  it('détecte un chevauchement après minuit et plafonne une fin par défaut', () => {
    const findings = stopOverlap.run({
      plan: dayPlan('2026-11-10', [
        locatedStop('bar', null, '22:00', '01:00', 'default_duration'),
        locatedStop('club', null, '23:30', '03:00'),
      ]),
      facts: PARIS_FACTS,
    })

    expect(findings[0]).toMatchObject({
      kind: 'issue',
      issue: { severity: 'warning', message: expect.stringContaining('90 min') },
    })
  })

  it('rend indéterminé un stop sans heure', () => {
    const findings = stopOverlap.run({
      plan: dayPlan('2026-11-10', [
        locatedStop('a', null, '09:00', '11:00'),
        locatedStop('b', null, null, null),
      ]),
      facts: PARIS_FACTS,
    })

    expect(findings).toEqual([
      {
        kind: 'undetermined',
        undetermined: { codes: ['stop_overlap'], stopIds: ['b'], reason: 'time_unknown' },
      },
    ])
  })
})
