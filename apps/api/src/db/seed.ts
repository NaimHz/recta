import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CityConfigSchema } from '@recta/domain'
import postgres from 'postgres'
import { env } from '../env'
import { isMainModule } from './is-main'
import type { DatabaseClient } from './wait'

const citiesDirectory = fileURLToPath(new URL('../../../../packages/data/cities', import.meta.url))

export async function seedCities(client: DatabaseClient): Promise<number> {
  const entries = await readdir(citiesDirectory, { withFileTypes: true })
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  if (directories.length === 0) {
    throw new Error('Aucun pack ville trouvé.')
  }

  for (const directory of directories) {
    const file = join(citiesDirectory, directory.name, 'city.json')
    const city = CityConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')))

    if (city.id !== directory.name) {
      throw new Error(`Identifiant incohérent dans ${file}.`)
    }

    const [west, south, east, north] = city.bbox

    await client`
      INSERT INTO cities (
        id, name, bbox, timezone, country, holiday_region, transit_area_ids,
        locale, curated_facts_path, eval_corpus_path, capabilities
      )
      VALUES (
        ${city.id}, ${city.name},
        ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326),
        ${city.timezone}, ${city.country}, ${city.holidayRegion}, ${city.transitAreaIds},
        ${city.locale}, ${city.curatedFactsPath}, ${city.evalCorpusPath},
        ${JSON.stringify(city.capabilities)}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        bbox = EXCLUDED.bbox,
        timezone = EXCLUDED.timezone,
        country = EXCLUDED.country,
        holiday_region = EXCLUDED.holiday_region,
        transit_area_ids = EXCLUDED.transit_area_ids,
        locale = EXCLUDED.locale,
        curated_facts_path = EXCLUDED.curated_facts_path,
        eval_corpus_path = EXCLUDED.eval_corpus_path,
        capabilities = EXCLUDED.capabilities,
        updated_at = now()
    `
  }

  return directories.length
}

if (isMainModule(import.meta.url)) {
  const client = postgres(env.DATABASE_URL, { max: 1 })

  try {
    const count = await seedCities(client)
    console.log(`Villes seedées : ${count}.`)
  } finally {
    await client.end()
  }
}
