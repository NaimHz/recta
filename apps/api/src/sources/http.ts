export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type Sleep = (milliseconds: number) => Promise<void>

export const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

export type JsonRequestOptions = {
  service: string
  url: URL
  headers: Record<string, string>
  fetch: FetchLike
  run: <T>(task: () => Promise<T>) => Promise<T>
  sleep: Sleep
  attempts: number
  retryDelayMs: number
  timeoutMs: number
}

export async function requestJson(options: JsonRequestOptions): Promise<unknown> {
  let lastError: unknown

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await options.run(() =>
        options.fetch(options.url, {
          headers: options.headers,
          signal: AbortSignal.timeout(options.timeoutMs),
        }),
      )

      if (!response.ok) {
        const message = `${options.service} HTTP ${response.status}`

        if (response.status === 429 || response.status >= 500) throw new Error(message)

        throw new NonRetryableError(message)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof NonRetryableError) throw error

      lastError = error

      if (attempt < options.attempts) await options.sleep(attempt * options.retryDelayMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${options.service} indisponible`)
}
