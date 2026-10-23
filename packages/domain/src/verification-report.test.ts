import { describe, expect, it } from 'vitest'
import { verifyOpeningHours } from './opening-hours'
import type { Plan, Stop } from './plan'
import {
  COST_ALERT_EUR,
  COST_STOP_EUR,
  VerificationCostTracker,
  VerificationReportSchema,
  buildFreshnessReport,
  buildVerificationReport,
  estimateUsage,
} from './verification-report'

const NOW = new Date('2026-10-23T12:00:00.000Z')

function makeStop(id: string, sourceDate: string | null): Stop {
  return {
    id,
    place: {
      id: `place-${id}`,
      name: `Lieu ${id}`,
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
        sourceDate,
        retrievedAt: '2026-10-23T10:00:00.000Z',
      },
    },
    start: '09:00',
    end: '10:00',
  }
}

function makePlan(sourceDates: Array<string | null>): Plan {
  return {
    schemaVersion: 1,
    days: [
      {
        date: '2026-10-24',
        timezone: 'Europe/Paris',
        stops: sourceDates.map((sourceDate, index) => makeStop(`stop-${index + 1}`, sourceDate)),
      },
    ],
  }
}

describe('VerificationCostTracker', () => {
  it('compte les appels et estime le coût des sources payantes', () => {
    const tracker = new VerificationCostTracker()

    expect(tracker.record('overpass')).toBe(true)
    expect(tracker.record('nominatim')).toBe(true)
    expect(tracker.record('google', 2)).toBe(true)

    const usage = tracker.snapshot()

    expect(usage.calls).toEqual({ overpass: 1, nominatim: 1, google: 2 })
    expect(usage.totalCalls).toBe(4)
    expect(usage.estimatedCostEur).toBeCloseTo(0.04, 4)
    expect(usage.budget).toMatchObject({
      alertEur: COST_ALERT_EUR,
      stopEur: COST_STOP_EUR,
      status: 'ok',
      degraded: false,
    })
  })

  it('passe en alerte à 0,50 €', () => {
    const tracker = new VerificationCostTracker()

    expect(tracker.record('google', 25)).toBe(true)

    const usage = tracker.snapshot()

    expect(usage.estimatedCostEur).toBeCloseTo(COST_ALERT_EUR, 4)
    expect(usage.budget.status).toBe('alert')
    expect(usage.budget.degraded).toBe(false)
  })

  it("refuse l'appel qui ferait dépasser 1,00 €", () => {
    const tracker = new VerificationCostTracker()

    expect(tracker.record('google', 50)).toBe(true)
    expect(tracker.snapshot().budget.status).toBe('stopped')
    expect(tracker.record('google')).toBe(false)

    const usage = tracker.snapshot()

    expect(usage.calls.google).toBe(50)
    expect(usage.estimatedCostEur).toBeCloseTo(COST_STOP_EUR, 4)
    expect(usage.budget.status).toBe('stopped')
    expect(usage.budget.degraded).toBe(true)
  })

  it('signale un dépassement fourni directement dans les compteurs', () => {
    const usage = estimateUsage({ google: 51 })

    expect(usage.estimatedCostEur).toBeCloseTo(1.02, 4)
    expect(usage.budget.status).toBe('stopped')
    expect(usage.budget.degraded).toBe(true)
  })

  it('refuse une source sans coût connu', () => {
    expect(() => estimateUsage({ source_inconnue: 1 })).toThrow('Coût inconnu')
  })
})

describe('buildFreshnessReport', () => {
  it('distingue une donnée fraîche, ancienne ou sans date', () => {
    const report = buildFreshnessReport(makePlan(['2026-10-01', '2025-10-01', null]), NOW)

    expect(report.checkedAt).toBe(NOW.toISOString())
    expect(report.staleAfterDays).toBe(365)
    expect(report.entries).toHaveLength(3)
    expect(report.entries[0]).toMatchObject({
      stopId: 'stop-1',
      ageDays: 22,
      freshness: 'fraîche',
      warning: null,
    })
    expect(report.entries[1]).toMatchObject({
      stopId: 'stop-2',
      ageDays: 387,
      freshness: 'ancienne',
    })
    expect(report.entries[1]?.warning).toContain('387')
    expect(report.entries[2]).toMatchObject({
      stopId: 'stop-3',
      sourceDate: null,
      ageDays: null,
      freshness: 'inconnue',
      warning: null,
    })
    expect(report.staleCount).toBe(1)
    expect(report.unknownCount).toBe(1)
    expect(report.oldestAgeDays).toBe(387)
  })

  it('ne produit pas un âge négatif pour une date future', () => {
    const report = buildFreshnessReport(makePlan(['2026-10-30']), NOW)

    expect(report.entries[0]).toMatchObject({ ageDays: 0, freshness: 'fraîche' })
  })
})

describe('buildVerificationReport', () => {
  it('ajoute le coût et la fraîcheur au résultat de vérification', () => {
    const result = verifyOpeningHours(makePlan(['2026-10-01', null]))
    const report = buildVerificationReport(result, { now: NOW, calls: { google: 25 } })

    expect(report.status).toBe(result.status)
    expect(report.usage.estimatedCostEur).toBeCloseTo(COST_ALERT_EUR, 4)
    expect(report.usage.budget.status).toBe('alert')
    expect(report.freshness.entries).toHaveLength(2)
    expect(VerificationReportSchema.parse(report)).toEqual(report)
  })

  it('affiche un coût nul quand aucune source payante ne répond', () => {
    const result = verifyOpeningHours(makePlan(['2026-10-01']))
    const report = buildVerificationReport(result, { now: NOW })

    expect(report.usage).toMatchObject({
      calls: {},
      totalCalls: 0,
      estimatedCostEur: 0,
      budget: { status: 'ok', degraded: false },
    })
    expect(report.freshness.staleCount).toBe(0)
  })
})
