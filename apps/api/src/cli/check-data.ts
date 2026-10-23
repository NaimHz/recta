import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CityConfigSchema } from '@recta/domain'
import { loadCuratedFacts } from '../sources/curated/facts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const citiesDirectory = join(repoRoot, 'packages/data/cities')

async function main(): Promise<void> {
  const entries = await readdir(citiesDirectory, { withFileTypes: true })
  const cities = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  let totalSites = 0
  let totalFacts = 0

  for (const cityEntry of cities) {
    const cityFile = join(citiesDirectory, cityEntry.name, 'city.json')
    const city = CityConfigSchema.parse(JSON.parse(await readFile(cityFile, 'utf8')))

    if (city.id !== cityEntry.name) {
      throw new Error(`Identifiant incohérent dans ${cityFile}.`)
    }

    if (!city.capabilities.curatedFacts) {
      console.log(`${city.id} : faits curatés non activés`)
      continue
    }

    const file = await loadCuratedFacts(city, repoRoot)

    if (file.sites.length !== 20) {
      throw new Error(`${city.id} : 20 sites attendus, ${file.sites.length} trouvés.`)
    }

    const facts = file.sites.reduce((count, site) => count + site.facts.length, 0)

    totalSites += file.sites.length
    totalFacts += facts
    console.log(`${city.id} : ${file.sites.length} sites, ${facts} faits sourcés et datés`)
  }

  console.log(`Total : ${totalSites} sites, ${totalFacts} faits.`)
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  console.error(`Base curatée invalide : ${detail}`)
  process.exitCode = 1
})
