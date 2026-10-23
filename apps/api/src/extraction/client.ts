import { ExtractedPlanSchema, type ExtractedPlan } from '@recta/domain'
import type { ZodIssue } from 'zod'
import { findInventions, type ExtractionInvention } from './validate'

export interface ExtractionClient {
  extract(text: string): Promise<unknown>
}

export class ExtractionSchemaError extends Error {
  constructor(readonly issues: ZodIssue[]) {
    super(`Sortie d'extraction invalide : ${issues.length} problème(s) de schéma.`)
    this.name = 'ExtractionSchemaError'
  }
}

export class ExtractionInventionError extends Error {
  constructor(readonly inventions: ExtractionInvention[]) {
    super(`Sortie d'extraction inventée : ${inventions.length} champ(s) sans preuve.`)
    this.name = 'ExtractionInventionError'
  }
}

export type ExtractionValidation =
  | {
      ok: true
      plan: ExtractedPlan
    }
  | {
      ok: false
      stage: 'schema'
      issues: ZodIssue[]
    }
  | {
      ok: false
      stage: 'invention'
      plan: ExtractedPlan
      inventions: ExtractionInvention[]
    }

export function validateExtraction(text: string, raw: unknown): ExtractionValidation {
  const parsed = ExtractedPlanSchema.safeParse(raw)

  if (!parsed.success) {
    return { ok: false, stage: 'schema', issues: parsed.error.issues }
  }

  const inventions = findInventions(text, parsed.data)

  if (inventions.length > 0) {
    return { ok: false, stage: 'invention', plan: parsed.data, inventions }
  }

  return { ok: true, plan: parsed.data }
}

export async function extractPlan(text: string, client: ExtractionClient): Promise<ExtractedPlan> {
  const validation = validateExtraction(text, await client.extract(text))

  if (!validation.ok) {
    if (validation.stage === 'schema') {
      throw new ExtractionSchemaError(validation.issues)
    }

    throw new ExtractionInventionError(validation.inventions)
  }

  return validation.plan
}
