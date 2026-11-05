import type { City, VerifyRequest, VerifyResponse } from './types'

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()

    if (typeof body === 'object' && body !== null && 'message' in body) {
      return String(body.message)
    }
  } catch {
    return `Erreur HTTP ${response.status}`
  }

  return `Erreur HTTP ${response.status}`
}

export async function fetchCities(): Promise<City[]> {
  const response = await fetch('/api/cities')

  if (!response.ok) throw new Error(await readError(response))

  return (await response.json()) as City[]
}

export async function verifyPlan(request: VerifyRequest): Promise<VerifyResponse> {
  const response = await fetch('/api/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) throw new Error(await readError(response))

  return (await response.json()) as VerifyResponse
}
