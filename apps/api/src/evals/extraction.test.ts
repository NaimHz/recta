import { describe, expect, it } from 'vitest'
import { runExtractionEval } from './extraction-eval'

describe('jeu de test extraction', () => {
  it('10 textes passent le schéma et le contrôle d’invention', async () => {
    const report = await runExtractionEval()

    expect(report.metrics.total).toBe(10)
    expect(report.metrics.schemaValid).toBeGreaterThanOrEqual(report.thresholds.schemaValid)
    expect(report.metrics.noInvention).toBeGreaterThanOrEqual(report.thresholds.noInvention)
    expect(report.errors).toHaveLength(0)
  })
})
