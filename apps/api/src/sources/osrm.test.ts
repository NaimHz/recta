import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { FetchLike } from './http'
import { NonRetryableError } from './http'
import { OsrmClient } from './osrm'

const fixtureUrl = new URL('./__fixtures__/osrm-table.json', import.meta.url)
const points = [
  { lat: 48.8809, lon: 2.3553 },
  { lat: 48.8606, lon: 2.3364 },
  { lat: 48.8616428, lon: 2.3359304 },
]

function client(fetchMock: FetchLike, attempts = 1): OsrmClient {
  return new OsrmClient({
    baseUrl: 'https://osrm.test/routed-foot',
    userAgent: 'Recta test',
    fetch: fetchMock,
    attempts,
    minIntervalMs: 0,
    sleep: async () => undefined,
  })
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
}

describe('OsrmClient', () => {
  it('demande une matrice à pied et la normalise', async () => {
    const body = await readFile(fixtureUrl, 'utf8')
    let receivedUrl: URL | undefined
    let receivedInit: RequestInit | undefined

    const table = await client(async (input, init) => {
      receivedUrl = new URL(String(input))
      receivedInit = init
      return jsonResponse(body)
    }).table(points)

    expect(receivedUrl?.pathname).toBe(
      '/routed-foot/table/v1/foot/2.3553,48.8809;2.3364,48.8606;2.3359304,48.8616428',
    )
    expect(receivedUrl?.searchParams.get('annotations')).toBe('duration,distance')
    expect(new Headers(receivedInit?.headers ?? {}).get('User-Agent')).toBe('Recta test')
    expect(table.durationsSeconds[0]?.[1]).toBe(2457.3)
    expect(table.distancesMeters[1]?.[2]).toBe(111)
    expect(table.url).toBe(receivedUrl?.toString())
  })

  it('relance une erreur serveur', async () => {
    const body = await readFile(fixtureUrl, 'utf8')
    let calls = 0

    const table = await client(async () => {
      calls += 1
      return calls === 1 ? jsonResponse('{}', 503) : jsonResponse(body)
    }, 2).table(points)

    expect(calls).toBe(2)
    expect(table.durationsSeconds).toHaveLength(3)
  })

  it('ne relance pas une erreur client', async () => {
    let calls = 0

    await expect(
      client(async () => {
        calls += 1
        return jsonResponse('{}', 400)
      }, 3).table(points),
    ).rejects.toBeInstanceOf(NonRetryableError)
    expect(calls).toBe(1)
  })

  it('refuse un code OSRM en erreur et une requête à un seul point', async () => {
    await expect(
      client(async () => jsonResponse('{"code":"NoTable"}')).table(points),
    ).rejects.toThrow('OSRM NoTable')
    await expect(client(async () => jsonResponse('{}')).table([points[0]!])).rejects.toThrow(
      /deux points/,
    )
  })
})
