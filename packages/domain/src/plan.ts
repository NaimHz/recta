import { z } from 'zod'
import { SCHEMA_VERSION } from './version'

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

export const STOP_WINDOW_SOURCES = ['explicit', 'period', 'default_duration', 'unknown'] as const
export type StopWindowSource = (typeof STOP_WINDOW_SOURCES)[number]

export const STOP_RESOLUTIONS = ['resolved', 'ambiguous', 'not_found'] as const
export type StopResolution = (typeof STOP_RESOLUTIONS)[number]

const IdSchema = z.string().min(1)

export const StopSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    sourceText: z.string().min(1).nullable(),
    type: z.string().min(1).nullable(),
    resolution: z.enum(STOP_RESOLUTIONS),
    place: PlaceSchema.nullable(),
    start: LocalTimeSchema.nullable(),
    end: LocalTimeSchema.nullable(),
    windowSource: z.enum(STOP_WINDOW_SOURCES),
  })
  .refine(({ resolution, place }) => (resolution === 'resolved') === (place !== null), {
    message: 'Un lieu est attendu si et seulement si le stop est résolu',
    path: ['place'],
  })
  .refine(
    ({ windowSource, start, end }) =>
      windowSource === 'unknown' ? start === null && end === null : start !== null && end !== null,
    {
      message: "Une fenêtre connue a un début et une fin ; une fenêtre inconnue n'en a pas",
      path: ['windowSource'],
    },
  )
  .refine(({ start, end }) => start === null || start !== end, {
    message: 'Un stop doit finir après son début',
    path: ['end'],
  })

export type Stop = z.infer<typeof StopSchema>

export const DaySchema = z.object({
  id: IdSchema,
  date: IsoDateSchema.nullable(),
  timezone: z.string().min(1),
  stops: z.array(StopSchema).min(1),
})

export type Day = z.infer<typeof DaySchema>

const ConstraintOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user_text'), quote: z.string().min(1) }),
  z.object({ kind: z.literal('default') }),
  z.object({ kind: z.literal('system') }),
])

const constraintBase = {
  id: IdSchema,
  hard: z.boolean(),
  priority: z.number().int().nonnegative(),
  origin: ConstraintOriginSchema,
}

export const ConstraintSchema = z.discriminatedUnion('kind', [
  z.object({
    ...constraintBase,
    kind: z.literal('stop_window'),
    stopId: IdSchema,
    start: LocalTimeSchema,
    end: LocalTimeSchema,
  }),
  z.object({ ...constraintBase, kind: z.literal('must_visit'), stopId: IdSchema }),
  z.object({
    ...constraintBase,
    kind: z.literal('day_bounds'),
    dayId: IdSchema,
    start: LocalTimeSchema,
    end: LocalTimeSchema,
  }),
  z.object({
    ...constraintBase,
    kind: z.literal('meal'),
    dayId: IdSchema,
    start: LocalTimeSchema,
    end: LocalTimeSchema,
    minDurationMinutes: z.number().int().positive(),
  }),
  z.object({
    ...constraintBase,
    kind: z.literal('max_travel_minutes'),
    dayId: IdSchema.nullable(),
    maxMinutes: z.number().int().positive(),
  }),
  z.object({
    ...constraintBase,
    kind: z.literal('order'),
    beforeStopId: IdSchema,
    afterStopId: IdSchema,
  }),
])

export type Constraint = z.infer<typeof ConstraintSchema>

export const PlanSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  cityId: z.string().regex(/^[a-z0-9-]+$/),
  days: z.array(DaySchema).min(1),
  constraints: z.array(ConstraintSchema),
})

export type Plan = z.infer<typeof PlanSchema>

export const ISSUE_CODES = [
  'place_closed_day',
  'place_not_operating',
  'holiday_closure',
  'outside_opening_hours',
  'after_last_entry',
  'travel_time_infeasible',
  'stop_overlap',
  'insufficient_buffer',
  'fragmented_half_day',
  'overloaded_day',
  'last_departure_missed',
  'connection_too_short',
] as const

export const IssueCodeSchema = z.enum(ISSUE_CODES)
export type IssueCode = z.infer<typeof IssueCodeSchema>

export const EVIDENCE_SOURCES = [
  'osm',
  'curated',
  'transitous',
  'osrm',
  'google',
  'plan',
  'calendar',
  'fixture',
] as const

export const EvidenceSourceSchema = z.enum(EVIDENCE_SOURCES)
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>

export const EvidenceSchema = z.object({
  source: EvidenceSourceSchema,
  sourceDate: IsoDateSchema.nullable(),
  retrievedAt: z.string().nullable(),
  url: z.url().nullable(),
  attribution: z.string().min(1).nullable(),
  raw: z.string(),
  fields: z.record(z.string(), z.unknown()),
})

export type Evidence = z.infer<typeof EvidenceSchema>

export const IssueSeveritySchema = z.enum(['error', 'warning', 'info'])
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>

export const IssueSchema = z.object({
  id: IdSchema,
  code: IssueCodeSchema,
  severity: IssueSeveritySchema,
  message: z.string().min(1),
  stopIds: z.array(IdSchema).min(1),
  evidence: z.array(EvidenceSchema).min(1),
})

export type Issue = z.infer<typeof IssueSchema>

export const UNDETERMINED_REASONS = [
  'unknown',
  'missing_hours',
  'invalid_syntax',
  'invalid_timezone',
  'invalid_context',
  'invalid_local_time',
  'place_unresolved',
  'time_unknown',
  'date_unknown',
  'transit_unavailable',
  'unknown_mode',
] as const

export const UndeterminedReasonSchema = z.enum(UNDETERMINED_REASONS)
export type UndeterminedReason = z.infer<typeof UndeterminedReasonSchema>

export const UndeterminedSchema = z.object({
  codes: z.array(IssueCodeSchema).min(1),
  stopIds: z.array(IdSchema).min(1),
  reason: UndeterminedReasonSchema,
})

export type Undetermined = z.infer<typeof UndeterminedSchema>

export const RepairOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move_stop'),
    stopId: IdSchema,
    start: LocalTimeSchema,
    end: LocalTimeSchema,
  }),
  z.object({ kind: z.literal('replace_place'), stopId: IdSchema, place: PlaceSchema }),
  z.object({ kind: z.literal('remove_stop'), stopId: IdSchema }),
  z.object({ kind: z.literal('reorder'), dayId: IdSchema, stopIds: z.array(IdSchema).min(2) }),
])

export type RepairOperation = z.infer<typeof RepairOperationSchema>

export const RepairProposalSchema = z
  .object({
    id: IdSchema,
    issueIds: z.array(IdSchema).min(1),
    operations: z.array(RepairOperationSchema).min(1),
    relaxedConstraintIds: z.array(IdSchema),
    status: z.enum(['complete', 'partial']),
    reason: z.string().min(1).nullable(),
  })
  .refine(({ status, reason }) => status === 'complete' || reason !== null, {
    message: 'Une réparation partielle doit donner sa raison',
    path: ['reason'],
  })

export type RepairProposal = z.infer<typeof RepairProposalSchema>

export const VerificationStatusSchema = z.enum(['conforme', 'violation', 'indéterminé'])
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>

export const VerificationResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  status: VerificationStatusSchema,
  plan: PlanSchema,
  issues: z.array(IssueSchema),
  undetermined: z.array(UndeterminedSchema),
})

export type VerificationResult = z.infer<typeof VerificationResultSchema>
