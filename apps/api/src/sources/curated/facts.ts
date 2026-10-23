import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CuratedFactsFileSchema, type CityConfig, type CuratedFactsFile } from '@recta/domain'
import { parse as parseYaml } from 'yaml'

const defaultRepoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

export function parseCuratedFactsFile(raw: string): CuratedFactsFile {
  let data: unknown

  try {
    data = parseYaml(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`YAML invalide : ${detail}`, { cause: error })
  }

  return CuratedFactsFileSchema.parse(data)
}

export async function loadCuratedFacts(
  city: CityConfig,
  repoRoot = defaultRepoRoot,
): Promise<CuratedFactsFile> {
  if (!city.capabilities.curatedFacts) {
    throw new Error(`Les faits curatés ne sont pas activés pour ${city.id}.`)
  }

  const filePath = resolve(repoRoot, city.curatedFactsPath)
  const raw = await readFile(filePath, 'utf8')
  const file = parseCuratedFactsFile(raw)

  if (file.city !== city.id) {
    throw new Error(`La base curatée de ${filePath} ne correspond pas à ${city.id}.`)
  }

  return file
}
