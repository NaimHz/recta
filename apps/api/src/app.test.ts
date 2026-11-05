import { describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { ExtractionInventionError } from './extraction/client'
import type { VerifyText, VerifyTextResult } from './pipeline/verify-text'

const RESULT = { report: { status: 'ok' }, resolutions: [] } as unknown as VerifyTextResult

function appWith(verifyText: VerifyText = async () => RESULT) {
  return buildApp({ verifyText })
}

function postVerify(app: ReturnType<typeof buildApp>, payload: unknown) {
  return app.inject({ method: 'POST', url: '/verify', payload: payload as object })
}

describe('GET /health', () => {
  it('returns the service status and the schema version', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'recta-api',
      schemaVersion: 2,
    })

    await app.close()
  })
})

describe('GET /cities', () => {
  it('lists the configured cities', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/cities' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { id: 'lyon', name: 'Lyon' },
      { id: 'paris', name: 'Paris' },
    ])

    await app.close()
  })
})

describe('POST /verify', () => {
  const body = { text: '10h-12h Louvre', cityId: 'paris', start: '2026-11-16' }

  it('returns the report and the resolutions', async () => {
    const calls: unknown[] = []
    const app = appWith(async (input) => {
      calls.push(input)
      return RESULT
    })
    const response = await postVerify(app, body)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(RESULT)
    expect(calls).toEqual([body])

    await app.close()
  })

  it.each([
    ['an empty text', { ...body, text: '  ' }],
    ['a malformed date', { ...body, start: '16/11/2026' }],
    ['an unknown field', { ...body, extra: true }],
    ['an unknown city', { ...body, cityId: 'nantes' }],
  ])('rejects %s with 400', async (_, payload) => {
    const app = appWith()
    const response = await postVerify(app, payload)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: 'invalid_request' })

    await app.close()
  })

  it('maps a rejected extraction to 422', async () => {
    const app = appWith(async () => {
      throw new ExtractionInventionError([{ path: 'days[0].stops[0].sourceText', value: 'x' }])
    })
    const response = await postVerify(app, body)

    expect(response.statusCode).toBe(422)
    expect(response.json()).toMatchObject({ error: 'extraction_rejected' })

    await app.close()
  })

  it('maps any other failure to 502', async () => {
    const app = appWith(async () => {
      throw new Error('Overpass 502')
    })
    const response = await postVerify(app, body)

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'upstream', message: 'Overpass 502' })

    await app.close()
  })
})
