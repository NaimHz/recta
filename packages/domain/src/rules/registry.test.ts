import { describe, expect, it } from 'vitest'
import { SUPERSEDES } from './engine'
import { RULES } from './registry'

describe('RULES', () => {
  it('a des identifiants uniques', () => {
    const ids = RULES.map((rule) => rule.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('place chaque code bloquant avant les codes qu’il domine', () => {
    RULES.forEach((rule, index) => {
      const dominated = rule.codes.flatMap((code) => SUPERSEDES[code] ?? [])
      const earlier = RULES.slice(0, index).flatMap((previous) => previous.codes)

      for (const code of dominated) {
        expect(earlier, `${rule.id} domine ${code}, produit plus tôt`).not.toContain(code)
      }
    })
  })
})
