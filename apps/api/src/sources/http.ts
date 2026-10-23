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
