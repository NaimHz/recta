const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]
const userAgent = 'Recta/0.1 (https://github.com/NaimHz/recta)'

export { userAgent }

export type OverpassElementType = 'node' | 'way' | 'relation'

export type OverpassElement = {
  type: OverpassElementType
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  center?: {
    lat: number
    lon: number
  }
}

type OverpassResponse = {
  elements?: OverpassElement[]
  remark?: string
  osm3s?: {
    timestamp_osm_base?: string
  }
}

export type OverpassResult = {
  elements: OverpassElement[]
  endpoint: string
  osmBaseTimestamp: string | null
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function queryOverpass(query: string, attempts = 3): Promise<OverpassResult> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const endpoint of overpassEndpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': userAgent,
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(180_000),
        })

        if (!response.ok) {
          throw new Error(`Overpass HTTP ${response.status}`)
        }

        const payload = (await response.json()) as OverpassResponse

        if (payload.remark && /error|timed out|out of memory/i.test(payload.remark)) {
          throw new Error(`Overpass: ${payload.remark}`)
        }

        return {
          elements: payload.elements ?? [],
          endpoint,
          osmBaseTimestamp: payload.osm3s?.timestamp_osm_base ?? null,
        }
      } catch (error) {
        lastError = error
      }
    }

    if (attempt < attempts) {
      await sleep(attempt * 3_000)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Overpass indisponible')
}
