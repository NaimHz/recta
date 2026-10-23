import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { FetchLike } from './http'
import { OverpassClient } from './overpass'

const fixtureUrl = new URL('./__fixtures__/overpass-search.json', import.meta.url)

async function fixture(): Promise<string> {
  return readFile(fixtureUrl, 'utf8')
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OverpassClient', () => {
  it('posts the query and maps the response metadata', async () => {
    const body = await fixture()
    let received: { input: string | URL; init: RequestInit | undefined } | undefined
    const fetchMock: FetchLike = async (input, init) => {
      received = { input, init }
      return jsonResponse(body)
    }
    const client = new OverpassClient({
      endpoints: ['https://overpass.test/interpreter'],
      userAgent: 'Recta test',
      fetch: fetchMock,
      attempts: 1,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    const result = await client.query('[out:json];')

    expect(result.elements).toHaveLength(2)
    expect(result.endpoint).toBe('https://overpass.test/interpreter')
    expect(result.osmBaseTimestamp).toBe('2026-10-22T00:00:00Z')
    expect(received?.input).toBe('https://overpass.test/interpreter')
    expect(new Headers(received?.init?.headers ?? {}).get('User-Agent')).toBe('Recta test')
    expect(received?.init?.body).toBeInstanceOf(URLSearchParams)
    expect((received?.init?.body as URLSearchParams).get('data')).toBe('[out:json];')
  })

  it('retries a server error before succeeding', async () => {
    const body = await fixture()
    let calls = 0
    const fetchMock: FetchLike = async () => {
      calls += 1

      return calls === 1 ? new Response('indisponible', { status: 503 }) : jsonResponse(body)
    }
    const client = new OverpassClient({
      endpoints: ['https://overpass.test/interpreter'],
      fetch: fetchMock,
      attempts: 2,
      retryDelayMs: 0,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    const result = await client.query('[out:json];')

    expect(calls).toBe(2)
    expect(result.elements).toHaveLength(2)
  })

  it('tries the next endpoint when the first one fails', async () => {
    const body = await fixture()
    const calls: string[] = []
    const fetchMock: FetchLike = async (input) => {
      const endpoint = String(input)
      calls.push(endpoint)

      return endpoint.includes('first')
        ? new Response('indisponible', { status: 503 })
        : jsonResponse(body)
    }
    const client = new OverpassClient({
      endpoints: ['https://first.test/interpreter', 'https://second.test/interpreter'],
      fetch: fetchMock,
      attempts: 1,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    const result = await client.query('[out:json];')

    expect(calls).toEqual(['https://first.test/interpreter', 'https://second.test/interpreter'])
    expect(result.endpoint).toBe('https://second.test/interpreter')
  })

  it('fails when Overpass reports an execution error', async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse(JSON.stringify({ remark: 'runtime error: query timed out' }))
    const client = new OverpassClient({
      endpoints: ['https://overpass.test/interpreter'],
      fetch: fetchMock,
      attempts: 1,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    await expect(client.query('[out:json];')).rejects.toThrow(/query timed out/)
  })

  it('does not retry a client error', async () => {
    let calls = 0
    const fetchMock: FetchLike = async () => {
      calls += 1
      return new Response('requête invalide', { status: 400 })
    }
    const client = new OverpassClient({
      endpoints: ['https://first.test/interpreter', 'https://second.test/interpreter'],
      fetch: fetchMock,
      attempts: 3,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    await expect(client.query('[out:json];')).rejects.toThrow(/HTTP 400/)
    expect(calls).toBe(1)
  })
})
