import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { FetchLike } from './http'
import { NominatimClient } from './nominatim'

const fixtureUrl = new URL('./__fixtures__/nominatim-search.json', import.meta.url)

async function fixture(): Promise<string> {
  return readFile(fixtureUrl, 'utf8')
}

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('NominatimClient', () => {
  it('sends the expected query and normalizes the response', async () => {
    const body = await fixture()
    let receivedUrl: URL | undefined
    let receivedInit: RequestInit | undefined
    const fetchMock: FetchLike = async (input, init) => {
      receivedUrl = new URL(String(input))
      receivedInit = init
      return jsonResponse(body)
    }
    const client = new NominatimClient({
      baseUrl: 'https://nominatim.test',
      userAgent: 'Recta test',
      fetch: fetchMock,
      attempts: 1,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    const results = await client.search({ query: 'Ville Exemple', countryCode: 'FR', limit: 1 })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      placeId: 123456,
      osmType: 'relation',
      osmId: 7444,
      displayName: 'Ville Exemple, Région Exemple, France',
      lat: 48.8566,
      lon: 2.3522,
      category: 'boundary',
      type: 'administrative',
    })
    expect(receivedUrl?.pathname).toBe('/search')
    expect(receivedUrl?.searchParams.get('format')).toBe('jsonv2')
    expect(receivedUrl?.searchParams.get('q')).toBe('Ville Exemple')
    expect(receivedUrl?.searchParams.get('countrycodes')).toBe('fr')
    expect(receivedUrl?.searchParams.get('limit')).toBe('1')
    expect(new Headers(receivedInit?.headers ?? {}).get('User-Agent')).toBe('Recta test')
    expect(new Headers(receivedInit?.headers ?? {}).get('Accept-Language')).toBe('fr')
  })

  it('retries a server error before succeeding', async () => {
    const body = await fixture()
    let calls = 0
    const fetchMock: FetchLike = async () => {
      calls += 1

      return calls === 1 ? new Response('indisponible', { status: 503 }) : jsonResponse(body)
    }
    const client = new NominatimClient({
      baseUrl: 'https://nominatim.test',
      fetch: fetchMock,
      attempts: 2,
      retryDelayMs: 0,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    const results = await client.search({ query: 'Ville Exemple' })

    expect(calls).toBe(2)
    expect(results).toHaveLength(1)
  })

  it('rejects invalid coordinates', async () => {
    const fetchMock: FetchLike = async () =>
      jsonResponse(JSON.stringify([{ display_name: 'Invalide', lat: 'nord', lon: '2' }]))
    const client = new NominatimClient({
      baseUrl: 'https://nominatim.test',
      fetch: fetchMock,
      attempts: 1,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    await expect(client.search({ query: 'Invalide' })).rejects.toThrow(/coordonnées invalides/)
  })

  it('does not retry a client error', async () => {
    let calls = 0
    const fetchMock: FetchLike = async () => {
      calls += 1
      return new Response('requête invalide', { status: 400 })
    }
    const client = new NominatimClient({
      baseUrl: 'https://nominatim.test',
      fetch: fetchMock,
      attempts: 3,
      minIntervalMs: 0,
      sleep: async () => undefined,
    })

    await expect(client.search({ query: 'Invalide' })).rejects.toThrow(/HTTP 400/)
    expect(calls).toBe(1)
  })
})
