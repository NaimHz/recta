import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { RULES } from '@recta/domain'
import { describe, expect, it } from 'vitest'

const rulesDirectory = fileURLToPath(
  new URL('../../../packages/domain/src/rules/', import.meta.url),
)
const infrastructure = new Set(['engine.ts', 'registry.ts', 'rule.ts'])

describe('rule registry', () => {
  it('registers every rule file of the domain', async () => {
    const ruleFiles = (await readdir(rulesDirectory)).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !infrastructure.has(file),
    )

    expect(ruleFiles.length).toBeGreaterThan(0)

    for (const file of ruleFiles) {
      const exported: unknown[] = Object.values(await import(`${rulesDirectory}${file}`))

      expect(
        exported.some((value) => RULES.some((rule) => rule === value)),
        `${file} is not in RULES`,
      ).toBe(true)
    }
  })
})
