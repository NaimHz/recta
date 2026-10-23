import { z } from 'zod'
import { SCHEMA_VERSION } from './version'

/**
 * Sous-ensemble du modèle de domaine nécessaire au parcours 1.7.
 * 0.3 étendra ce modèle avec RepairProposal, Constraint et le reste.
 */

export const DAY_CODES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export type DayCode = (typeof DAY_CODES)[number]

export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure locale attendue au format HH:MM')

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const date = new Date(`${value}T00:00:00.000Z`)

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const IsoDateSchema = z
  .string()
  .refine(isIsoDate, { message: 'Date attendue au format YYYY-MM-DD' })

export const OpeningHoursSchema = z
  .object({
    opensAt: LocalTimeSchema,
    closesAt: LocalTimeSchema,
    closedOn: z.array(z.enum(DAY_CODES)),
    raw: z.string().min(1),
  })
  .refine(({ opensAt, closesAt }) => opensAt < closesAt, {
    message: "Une fenêtre nocturne n'est pas gérée en 1.7",
    path: ['closesAt'],
  })

export type OpeningHours = z.infer<typeof OpeningHoursSchema>

export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

export type Coordinates = z.infer<typeof CoordinatesSchema>

export const PlaceSourceSchema = z.object({
  provider: z.enum(['osm', 'google', 'fixture', 'curated']),
  sourceDate: IsoDateSchema.nullable(),
  retrievedAt: z.string().nullable(),
})

export type PlaceSource = z.infer<typeof PlaceSourceSchema>

export const PlaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  coordinates: CoordinatesSchema.nullable(),
  address: z.string().nullable(),
  category: z.string().nullable(),
  openingHoursRaw: z.string().nullable(),
  openingHours: OpeningHoursSchema.nullable(),
  source: PlaceSourceSchema,
})

export type Place = z.infer<typeof PlaceSchema>

export const StopSchema = z
  .object({
    id: z.string().min(1),
    place: PlaceSchema,
    start: LocalTimeSchema,
    end: LocalTimeSchema,
  })
  .refine(({ start, end }) => start < end, {
    message: 'Un stop doit finir après son début',
    path: ['end'],
  })

export type Stop = z.infer<typeof StopSchema>

export const DaySchema = z.object({
  date: IsoDateSchema,
  timezone: z.string().min(1),
  stops: z.array(StopSchema).min(1),
})

export type Day = z.infer<typeof DaySchema>

export const PlanSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  days: z.array(DaySchema).min(1),
})

export type Plan = z.infer<typeof PlanSchema>

export const EvidenceSchema = z.object({
  source: z.string().min(1),
  sourceDate: IsoDateSchema.nullable(),
  retrievedAt: z.string().nullable(),
  raw: z.string(),
  fields: z.record(z.string(), z.unknown()),
})

export type Evidence = z.infer<typeof EvidenceSchema>

export const IssueSeveritySchema = z.enum(['error', 'warning', 'info'])
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>

export const IssueSchema = z.object({
  code: z.string().min(1),
  severity: IssueSeveritySchema,
  message: z.string().min(1),
  stopId: z.string().min(1),
  evidence: EvidenceSchema,
})

export type Issue = z.infer<typeof IssueSchema>

export const VerificationStatusSchema = z.enum(['conforme', 'violation', 'indéterminé'])
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>

export const VerificationResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: VerificationStatusSchema,
  plan: PlanSchema,
  issues: z.array(IssueSchema),
})

export type VerificationResult = z.infer<typeof VerificationResultSchema>
