import { describe, expect, it } from 'vitest'
import { verifyPlan } from '@recta/domain'
import { loadVerificationFacts } from '../verification/facts'
import { FixtureParseError, parseFixture } from './fixture'

const fixture = [
  '# Recta — fixture 1.7',
  'city: test-city',
  'day: 2026-10-24',
  'timezone: Europe/Paris',
  '09:00-11:00 | Louvre | 09:00-18:00 | -',
  '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
  "17:30-19:00 | Musée d'Orsay | 09:30-18:00 | Mon",
].join('\n')

describe('parseFixture', () => {
  it('reads three stops and their hard-coded opening hours', () => {
    const plan = parseFixture(fixture)

    expect(plan.cityId).toBe('test-city')
    expect(plan.days[0]?.date).toBe('2026-10-24')
    expect(plan.days[0]?.timezone).toBe('Europe/Paris')
    expect(plan.days[0]?.stops).toHaveLength(3)
    expect(plan.days[0]?.stops[0]).toMatchObject({
      id: 'stop-1',
      name: 'Louvre',
      sourceText: '09:00-11:00 | Louvre | 09:00-18:00 | -',
      resolution: 'resolved',
      start: '09:00',
      end: '11:00',
      windowSource: 'explicit',
      place: {
        id: 'place-1',
        name: 'Louvre',
      },
    })
    expect(plan.days[0]?.stops[0]?.place?.openingHoursRaw).toBe('09:00-18:00')
    expect(plan.days[0]?.stops[1]?.place?.openingHoursRaw).toBe('12:00-14:30; Su,Mo off')
  })

  it('produces a violation with evidence from the parsed fixture', async () => {
    const result = verifyPlan(parseFixture(fixture), await loadVerificationFacts('paris'))

    expect(result.status).toBe('violation')
    expect(result.issues[0]).toMatchObject({
      code: 'outside_opening_hours',
      stopIds: ['stop-3'],
      evidence: [
        {
          source: 'fixture',
          sourceDate: '2026-10-24',
          fields: {
            placeName: "Musée d'Orsay",
            stopEnd: '19:00',
            side: 'after_closing',
            closesAt: '18:00',
          },
        },
      ],
    })
    expect(result.undetermined).toEqual([])
  })

  it('rejects a fixture without city', () => {
    const text = fixture.replace('city: test-city\n', '')

    expect(() => parseFixture(text)).toThrow(/city: … » manquante/)
  })

  it('rejects a malformed stop line', () => {
    const text = [
      'city: test-city',
      'day: 2026-10-24',
      'timezone: Europe/Paris',
      '09:00-11:00 | Louvre | 09:00-18:00',
    ].join('\n')

    expect(() => parseFixture(text)).toThrow(FixtureParseError)
    expect(() => parseFixture(text)).toThrow(/un stop attendu/)
  })

  it('rejects anything other than three stops', () => {
    const text = [
      'city: test-city',
      'day: 2026-10-24',
      'timezone: Europe/Paris',
      '09:00-11:00 | Louvre | 09:00-18:00 | -',
      '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
    ].join('\n')

    expect(() => parseFixture(text)).toThrow(/3 stops attendus, 2 trouvés/)
  })

  it('rejects an unknown closing day', () => {
    const text = [
      'city: test-city',
      'day: 2026-10-24',
      'timezone: Europe/Paris',
      '09:00-11:00 | Louvre | 09:00-18:00 | Funday',
      '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
      '17:30-19:00 | Orsay | 09:30-18:00 | Mon',
    ].join('\n')

    expect(() => parseFixture(text)).toThrow(/jour de fermeture inconnu/)
  })
})
