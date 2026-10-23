import { z } from 'zod'

/**
 * Sortie d'extraction, avant normalisation.
 * Les champs absents sont explicitement `null` : aucune valeur n'est devinée.
 * `sourceText` est la citation exacte qui justifie le stop.
 */
export const ExtractedStopSchema = z.strictObject({
  name: z.string().min(1).describe("Nom du lieu exactement tel qu'il est écrit"),
  startText: z
    .string()
    .min(1)
    .nullable()
    .describe("Expression de début exacte, ou null si elle n'est pas écrite"),
  endText: z
    .string()
    .min(1)
    .nullable()
    .describe("Expression de fin exacte, ou null si elle n'est pas écrite"),
  type: z
    .string()
    .min(1)
    .nullable()
    .describe("Type explicite tel qu'il est écrit, ou null s'il n'est pas nommé"),
  sourceText: z.string().min(1).describe('Citation exacte du texte qui contient ce stop'),
})

export type ExtractedStop = z.infer<typeof ExtractedStopSchema>

export const ExtractedDaySchema = z.strictObject({
  dateText: z
    .string()
    .min(1)
    .nullable()
    .describe("Date telle qu'elle est écrite, ou null si elle est absente"),
  city: z
    .string()
    .min(1)
    .nullable()
    .describe("Ville telle qu'elle est écrite, ou null si elle est absente"),
  timezoneText: z
    .string()
    .min(1)
    .nullable()
    .describe("Fuseau horaire tel qu'il est écrit, ou null s'il est absent"),
  stops: z.array(ExtractedStopSchema).min(1),
})

export type ExtractedDay = z.infer<typeof ExtractedDaySchema>

export const ExtractedPlanSchema = z.strictObject({
  days: z.array(ExtractedDaySchema).min(1),
})

export type ExtractedPlan = z.infer<typeof ExtractedPlanSchema>
