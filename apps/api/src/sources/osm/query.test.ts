import { describe, expect, it } from 'vitest'
import { buildPoiQuery } from './query'

describe('buildPoiQuery', () => {
  it('builds a bbox-scoped Overpass query with a hard limit', () => {
    const query = buildPoiQuery([2.2241, 48.8156, 2.4699, 48.9022], 80)

    expect(query).toContain('[out:json][timeout:90];')
    expect(query).toContain('nwr(48.8156,2.2241,48.9022,2.4699)["name"]["tourism"')
    expect(query).toContain('nwr(48.8156,2.2241,48.9022,2.4699)["name"]["amenity"')
    expect(query).toContain('out tags center 80;')
  })

  it('rejects an invalid limit', () => {
    expect(() => buildPoiQuery([2.2241, 48.8156, 2.4699, 48.9022], 0)).toThrow(/limite Overpass/)
  })
})
