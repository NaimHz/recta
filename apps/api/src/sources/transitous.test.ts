import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { NonRetryableError, type FetchLike } from './http'
import { TransitousClient } from './transitous'

const fixtureUrl = new URL('./__fixtures__/transitous-plan.json', import.meta.url)
const request = {
  from: { lat: 48.8809, lon: 2.3553 },
  to: { lat: 48.8606, lon: 2.3364 },
  time: '2026-11-10T07:00:00.000Z',
}

function client(fetchMock: FetchLike, attempts = 1): TransitousClient {
  return new TransitousClient({
    baseUrl: 'https://transitous.test',
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

describe('TransitousClient', () => {
  it('envoie la requête de 1.4 et résume les itinéraires', async () => {
    const body = await readFile(fixtureUrl, 'utf8')
    let receivedUrl: URL | undefined

    const plan = await client(async (input) => {
      receivedUrl = new URL(String(input))
      return jsonResponse(body)
    }).plan(request)

    expect(receivedUrl?.pathname).toBe('/api/v6/plan')
    expect(receivedUrl?.searchParams.get('fromPlace')).toBe('48.8809,2.3553')
    expect(receivedUrl?.searchParams.get('toPlace')).toBe('48.8606,2.3364')
    expect(receivedUrl?.searchParams.get('time')).toBe('2026-11-10T07:00:00.000Z')
    expect(receivedUrl?.searchParams.get('directModes')).toBe('WALK')
    expect(receivedUrl?.searchParams.get('transitModes')).toBe('TRANSIT')
    expect(receivedUrl?.searchParams.has('arriveBy')).toBe(false)
    expect(plan.itineraries).toHaveLength(3)
    expect(plan.itineraries[0]).toMatchObject({
      startTime: '2026-11-10T07:00:00Z',
      endTime: '2026-11-10T07:23:00Z',
      durationSeconds: 1380,
      transfers: 0,
    })
    expect(plan.itineraries[0]?.legs.map((entry) => entry.mode)).toEqual(['WALK', 'SUBWAY', 'WALK'])
  })

  it('demande une arrivée au plus tard', async () => {
    let receivedUrl: URL | undefined

    await client(async (input) => {
      receivedUrl = new URL(String(input))
      return jsonResponse('{"itineraries":[]}')
    }).plan({ ...request, arriveBy: true, transitModes: 'RAIL' })

    expect(receivedUrl?.searchParams.get('arriveBy')).toBe('true')
    expect(receivedUrl?.searchParams.get('transitModes')).toBe('RAIL')
  })

  it('relance une erreur serveur et pas une erreur client', async () => {
    let calls = 0
    const plan = await client(async () => {
      calls += 1
      return calls === 1 ? jsonResponse('{}', 502) : jsonResponse('{"itineraries":[]}')
    }, 2).plan(request)

    expect(calls).toBe(2)
    expect(plan.itineraries).toEqual([])
    await expect(
      client(async () => jsonResponse('{}', 404), 3).plan(request),
    ).rejects.toBeInstanceOf(NonRetryableError)
  })

  it('refuse une réponse sans itinéraires', async () => {
    await expect(client(async () => jsonResponse('{}')).plan(request)).rejects.toThrow(
      /itinéraires absents/,
    )
  })
})
