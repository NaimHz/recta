import { z } from 'zod'
import {
  IsoDateSchema,
  PlaceSourceSchema,
  VerificationResultSchema,
  type Plan,
  type VerificationResult,
} from './plan'

export const STALE_AFTER_DAYS = 365
export const COST_ALERT_EUR = 0.5
export const COST_STOP_EUR = 1

/**
 * Coût estimé par appel payant, en euros. OSM, OSRM et Transitous sont gratuits.
 * Google Places est estimé à 0,02 € par appel utile (place Details).
 */
export const SOURCE_CALL_COSTS_EUR = {
  overpass: 0,
  nominatim: 0,
  google: 0.02,
  osrm: 0,
  transitous: 0,
  fixture: 0,
} as const

export type SourceCallCosts = Record<string, number>

export const SourceCallCountsSchema = z.record(z.string().min(1), z.number().int().nonnegative())
export type SourceCallCounts = z.infer<typeof SourceCallCountsSchema>

export const VerificationBudgetSchema = z.object({
  alertEur: z.number().nonnegative(),
  stopEur: z.number().positive(),
  status: z.enum(['ok', 'alert', 'stopped']),
  degraded: z.boolean(),
})
export type VerificationBudget = z.infer<typeof VerificationBudgetSchema>

export const VerificationUsageSchema = z.object({
  calls: SourceCallCountsSchema,
  totalCalls: z.number().int().nonnegative(),
  estimatedCostEur: z.number().nonnegative(),
  budget: VerificationBudgetSchema,
})
export type VerificationUsage = z.infer<typeof VerificationUsageSchema>

export const FreshnessEntrySchema = z.object({
  stopId: z.string().min(1),
  placeId: z.string().min(1),
  placeName: z.string().min(1),
  provider: PlaceSourceSchema.shape.provider,
  sourceDate: IsoDateSchema.nullable(),
  retrievedAt: z.string().nullable(),
  ageDays: z.number().int().nonnegative().nullable(),
  freshness: z.enum(['fraîche', 'ancienne', 'inconnue']),
  warning: z.string().min(1).nullable(),
})
export type FreshnessEntry = z.infer<typeof FreshnessEntrySchema>

export const FreshnessReportSchema = z.object({
  checkedAt: z.string().min(1),
  staleAfterDays: z.literal(STALE_AFTER_DAYS),
  entries: z.array(FreshnessEntrySchema),
  staleCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  oldestAgeDays: z.number().int().nonnegative().nullable(),
})
export type FreshnessReport = z.infer<typeof FreshnessReportSchema>

export const VerificationReportSchema = VerificationResultSchema.extend({
  usage: VerificationUsageSchema,
  freshness: FreshnessReportSchema,
})
export type VerificationReport = z.infer<typeof VerificationReportSchema>

export type VerificationReportOptions = {
  calls?: SourceCallCounts
  usage?: VerificationUsage
  now?: Date
  alertEur?: number
  stopEur?: number
  costs?: SourceCallCosts
}

function roundEur(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function costFor(source: string, costs: SourceCallCosts): number {
  const cost = costs[source]

  if (cost === undefined) {
    throw new Error(`Coût inconnu pour la source « ${source} ».`)
  }

  return cost
}

export function estimateCostEur(
  calls: SourceCallCounts,
  costs: SourceCallCosts = SOURCE_CALL_COSTS_EUR,
): number {
  const parsedCalls = SourceCallCountsSchema.parse(calls)

  return roundEur(
    Object.entries(parsedCalls).reduce(
      (total, [source, count]) => total + (count === 0 ? 0 : costFor(source, costs) * count),
      0,
    ),
  )
}

export function estimateUsage(
  calls: SourceCallCounts,
  options: { alertEur?: number; stopEur?: number; costs?: SourceCallCosts } = {},
): VerificationUsage {
  const parsedCalls = SourceCallCountsSchema.parse(calls)
  const activeCalls = Object.fromEntries(
    Object.entries(parsedCalls).filter(([, count]) => count > 0),
  )
  const alertEur = options.alertEur ?? COST_ALERT_EUR
  const stopEur = options.stopEur ?? COST_STOP_EUR
  const estimatedCostEur = estimateCostEur(activeCalls, options.costs)
  const status =
    estimatedCostEur >= stopEur ? 'stopped' : estimatedCostEur >= alertEur ? 'alert' : 'ok'

  return {
    calls: activeCalls,
    totalCalls: Object.values(activeCalls).reduce((total, count) => total + count, 0),
    estimatedCostEur,
    budget: {
      alertEur,
      stopEur,
      status,
      degraded: estimatedCostEur > stopEur,
    },
  }
}

export type VerificationCostTrackerOptions = {
  alertEur?: number
  stopEur?: number
  costs?: SourceCallCosts
}

/**
 * Compteur d'appels d'une vérification. `record` refuse l'appel qui ferait
 * dépasser le plafond et le signale par `degraded`.
 */
export class VerificationCostTracker {
  private readonly alertEur: number
  private readonly stopEur: number
  private readonly costs: SourceCallCosts
  private readonly calls: Record<string, number> = {}
  private estimatedCostEur = 0
  private degraded = false

  constructor(options: VerificationCostTrackerOptions = {}) {
    this.alertEur = options.alertEur ?? COST_ALERT_EUR
    this.stopEur = options.stopEur ?? COST_STOP_EUR
    this.costs = options.costs ?? SOURCE_CALL_COSTS_EUR
  }

  canCall(source: string, count = 1): boolean {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error('Le nombre d’appels doit être un entier positif ou nul.')
    }

    if (count === 0) return true

    return this.estimatedCostEur + costFor(source, this.costs) * count <= this.stopEur
  }

  record(source: string, count = 1): boolean {
    if (count === 0) return true

    if (!this.canCall(source, count)) {
      this.degraded = true
      return false
    }

    this.calls[source] = (this.calls[source] ?? 0) + count
    this.estimatedCostEur = roundEur(this.estimatedCostEur + costFor(source, this.costs) * count)

    return true
  }

  snapshot(): VerificationUsage {
    const usage = estimateUsage(this.calls, {
      alertEur: this.alertEur,
      stopEur: this.stopEur,
      costs: this.costs,
    })

    return {
      ...usage,
      budget: {
        ...usage.budget,
        degraded: this.degraded || usage.budget.degraded,
      },
    }
  }
}

function ageDaysFor(sourceDate: string | null, now: Date): number | null {
  if (sourceDate === null) return null

  const sourceTimestamp = Date.parse(`${sourceDate}T00:00:00.000Z`)

  if (Number.isNaN(sourceTimestamp)) return null

  const todayTimestamp = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())

  return Math.max(0, Math.floor((todayTimestamp - sourceTimestamp) / 86_400_000))
}

export function buildFreshnessReport(plan: Plan, now = new Date()): FreshnessReport {
  const entries = plan.days.flatMap((day) =>
    day.stops.map((stop): FreshnessEntry => {
      const sourceDate = stop.place.source.sourceDate
      const ageDays = ageDaysFor(sourceDate, now)
      const freshness =
        ageDays === null ? 'inconnue' : ageDays > STALE_AFTER_DAYS ? 'ancienne' : 'fraîche'

      return {
        stopId: stop.id,
        placeId: stop.place.id,
        placeName: stop.place.name,
        provider: stop.place.source.provider,
        sourceDate,
        retrievedAt: stop.place.source.retrievedAt,
        ageDays,
        freshness,
        warning:
          freshness === 'ancienne'
            ? `Donnée source vieille de ${ageDays} jours (seuil : ${STALE_AFTER_DAYS}).`
            : null,
      }
    }),
  )
  const ages = entries.map((entry) => entry.ageDays).filter((age): age is number => age !== null)

  return {
    checkedAt: now.toISOString(),
    staleAfterDays: STALE_AFTER_DAYS,
    entries,
    staleCount: entries.filter((entry) => entry.freshness === 'ancienne').length,
    unknownCount: entries.filter((entry) => entry.freshness === 'inconnue').length,
    oldestAgeDays: ages.length === 0 ? null : Math.max(...ages),
  }
}

export function buildVerificationReport(
  result: VerificationResult,
  options: VerificationReportOptions = {},
): VerificationReport {
  const usage =
    options.usage ??
    estimateUsage(options.calls ?? {}, {
      ...(options.alertEur === undefined ? {} : { alertEur: options.alertEur }),
      ...(options.stopEur === undefined ? {} : { stopEur: options.stopEur }),
      ...(options.costs === undefined ? {} : { costs: options.costs }),
    })

  return {
    ...result,
    usage,
    freshness: buildFreshnessReport(result.plan, options.now ?? new Date()),
  }
}
