import { describe, expect, it } from 'vitest'
import { verifyOpeningHours } from '@recta/domain'
import { FixtureParseError, parseFixture } from './fixture'

const fixture = [
  '# Recta — fixture 1.7',
  'day: 2026-10-24',
  'timezone: Europe/Paris',
  '09:00-11:00 | Louvre | 09:00-18:00 | -',
  '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
  "17:30-19:00 | Musée d'Orsay | 09:30-18:00 | Mon",
].join('\n')

describe('parseFixture', () => {
  it('reads three stops and their hard-coded opening hours', () => {
    const plan = parseFixture(fixture)

    expect(plan.days[0]?.date).toBe('2026-10-24')
    expect(plan.days[0]?.timezone).toBe('Europe/Paris')
    expect(plan.days[0]?.stops).toHaveLength(3)
    expect(plan.days[0]?.stops[0]).toMatchObject({
      id: 'stop-1',
      start: '09:00',
      end: '11:00',
      place: {
        id: 'place-1',
        name: 'Louvre',
        openingHours: {
          opensAt: '09:00',
          closesAt: '18:00',
          closedOn: [],
          raw: '09:00-18:00',
        },
      },
    })
    expect(plan.days[0]?.stops[1]?.place.openingHours?.closedOn).toEqual(['Sun', 'Mon'])
  })

  it('produces a violation with evidence from the parsed fixture', () => {
    const result = verifyOpeningHours(parseFixture(fixture))

    expect(result.status).toBe('violation')
    expect(result.issues[0]).toMatchObject({
      code: 'stop_after_closing',
      stopId: 'stop-3',
      evidence: {
        source: 'fixture',
        sourceDate: '2026-10-24',
        fields: {
          placeName: "Musée d'Orsay",
          stopEnd: '19:00',
        },
      },
    })
  })

  it('rejects a malformed stop line', () => {
    const text = [
      'day: 2026-10-24',
      'timezone: Europe/Paris',
      '09:00-11:00 | Louvre | 09:00-18:00',
    ].join('\n')

    expect(() => parseFixture(text)).toThrow(FixtureParseError)
    expect(() => parseFixture(text)).toThrow(/un stop attendu/)
  })

  it('rejects anything other than three stops', () => {
    const text = [
      'day: 2026-10-24',
      'timezone: Europe/Paris',
      '09:00-11:00 | Louvre | 09:00-18:00 | -',
      '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
    ].join('\n')

    expect(() => parseFixture(text)).toThrow(/3 stops attendus, 2 trouvés/)
  })

  it('rejects an unknown closing day', () => {
    const text = [
      'day: 2026-10-24',
      'timezone: Europe/Paris',
      '09:00-11:00 | Louvre | 09:00-18:00 | Funday',
      '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
      '17:30-19:00 | Orsay | 09:30-18:00 | Mon',
    ].join('\n')

    expect(() => parseFixture(text)).toThrow(/jour de fermeture inconnu/)
  })
})
