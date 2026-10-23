import { describe, expect, it } from 'vitest'
import { runOpeningHoursEval } from './opening-hours-eval'
import { runResolutionEval } from './resolution-eval'

describe('jeu de test vérification', () => {
  it('résolution : 30 cas et seuils tenus', async () => {
    const report = await runResolutionEval()

    expect(report.metrics.total).toBe(30)
    expect(report.metrics.top1).toBeGreaterThanOrEqual(report.thresholds.top1)
    expect(report.metrics.top3).toBeGreaterThanOrEqual(report.thresholds.top3)
    expect(report.errors).toHaveLength(0)
  })

  it('horaires : 40 cas et seuil tenu', async () => {
    const report = await runOpeningHoursEval()

    expect(report.metrics.total).toBe(40)
    expect(report.metrics.correctRate).toBeGreaterThanOrEqual(report.thresholds.exact)
    expect(report.errors).toHaveLength(0)
  })
})
