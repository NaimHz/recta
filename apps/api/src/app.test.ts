import { describe, expect, it } from 'vitest'
import { buildApp } from './app'

describe('GET /health', () => {
  it('returns the service status and the schema version', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'recta-api',
      schemaVersion: 1,
    })

    await app.close()
  })
})
