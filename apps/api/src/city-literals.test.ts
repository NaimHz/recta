import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const codeRoots = ['apps/api/src', 'apps/web/src', 'packages/domain/src', 'services/solver/app']
const forbidden = /\b(paris|lyon|barcelone|barcelona)\b/i
const ignoredDirectories = new Set(['node_modules', 'dist', 'coverage', '.git'])

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) return []
        return collectFiles(path)
      }

      if (!entry.isFile()) return []
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) return []

      return [path]
    }),
  )

  return files.flat()
}

async function findCityLiterals(): Promise<string[]> {
  const violations: string[] = []

  for (const root of codeRoots) {
    const directory = join(repoRoot, root)

    try {
      const files = await collectFiles(directory)

      for (const file of files) {
        const content = await readFile(file, 'utf8')

        content.split('\n').forEach((line, index) => {
          if (forbidden.test(line)) {
            violations.push(`${relative(repoRoot, file)}:${index + 1}: ${line.trim()}`)
          }
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  return violations
}

describe('city literals', () => {
  it('keeps city names out of the application code', async () => {
    await expect(findCityLiterals()).resolves.toEqual([])
  })
})
