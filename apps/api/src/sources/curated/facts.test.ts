import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CityConfigSchema, type CityConfig } from '@recta/domain'
import { describe, expect, it } from 'vitest'
import { loadCuratedFacts, parseCuratedFactsFile } from './facts'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const reviewedAt = '2026-10-23'

const minimalYaml = `version: 1
city: paris
sites:
  - id: louvre
    name: "Musée du Louvre"
    placeId: "osm:relation/7515426"
    address: "Place du Carrousel, 75001 Paris"
    facts:
      - key: business_status
        value: operational
        source:
          url: "https://www.louvre.fr/en/visit"
          reviewedAt: "${reviewedAt}"
`

async function readCity(id: string): Promise<CityConfig> {
  const raw = await readFile(join(repoRoot, 'packages/data/cities', id, 'city.json'), 'utf8')

  return CityConfigSchema.parse(JSON.parse(raw))
}

describe('parseCuratedFactsFile', () => {
  it('lit une base YAML minimale', () => {
    const file = parseCuratedFactsFile(minimalYaml)

    expect(file.city).toBe('paris')
    expect(file.sites[0]?.facts[0]?.value).toBe('operational')
  })

  it('refuse un YAML invalide', () => {
    expect(() => parseCuratedFactsFile('sites: [')).toThrow(/YAML invalide/)
  })

  it('refuse un fait sans source', () => {
    const raw = minimalYaml.replace(
      '        source:\n          url: "https://www.louvre.fr/en/visit"\n          reviewedAt: "2026-10-23"\n',
      '',
    )

    expect(() => parseCuratedFactsFile(raw)).toThrow()
  })
})

describe.each(['paris', 'lyon'])('base curatée de %s', (cityId) => {
  it('contient 20 sites liés à OSM, chacun avec un fait sourcé et daté', async () => {
    const city = await readCity(cityId)
    const file = await loadCuratedFacts(city)

    expect(city.capabilities.curatedFacts).toBe(true)
    expect(file.city).toBe(city.id)
    expect(file.sites).toHaveLength(20)
    expect(new Set(file.sites.map((site) => site.id)).size).toBe(20)
    expect(new Set(file.sites.map((site) => site.placeId)).size).toBe(20)

    for (const site of file.sites) {
      expect(site.placeId).toMatch(/^osm:(node|way|relation)\/\d+$/)
      expect(site.address).not.toBeNull()
      expect(site.facts).toHaveLength(1)

      const [fact] = site.facts

      expect(fact?.key).toBe('business_status')
      expect(fact?.source.url).toMatch(/^https:\/\//)
      expect(fact?.source.reviewedAt).toBe(reviewedAt)
    }
  })
})

describe('base curatée de Paris', () => {
  it('signale la fermeture temporaire du Centre Pompidou', async () => {
    const city = await readCity('paris')
    const file = await loadCuratedFacts(city)
    const pompidou = file.sites.find((site) => site.id === 'centre-pompidou')

    expect(pompidou?.facts[0]?.value).toBe('closed_temporarily')
  })
})

describe('base curatée de Lyon', () => {
  it("signale la fermeture temporaire du musée de l'Imprimerie", async () => {
    const city = await readCity('lyon')
    const file = await loadCuratedFacts(city)
    const imprimerie = file.sites.find((site) => site.id === 'musee-imprimerie')

    expect(imprimerie?.facts[0]?.value).toBe('closed_temporarily')
  })
})
