export type OSMbbox = readonly [west: number, south: number, east: number, north: number]

const poiFilters = [
  '["name"]["tourism"~"museum|attraction|gallery"]',
  '["name"]["amenity"~"restaurant|cafe|marketplace"]',
  '["name"]["shop"~"bakery|books|clothes|gift|department_store|mall"]',
  '["name"]["historic"]',
  '["name"]["leisure"~"park|garden"]',
]

export function buildPoiQuery(bbox: OSMbbox, limit: number): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error('La limite Overpass doit être un entier entre 1 et 500.')
  }

  const [west, south, east, north] = bbox
  const scope = `(${south},${west},${north},${east})`
  const statements = poiFilters.map((filter) => `nwr${scope}${filter};`)

  return `[out:json][timeout:90];\n(\n${statements.join('\n')}\n);\nout tags center ${limit};`
}
