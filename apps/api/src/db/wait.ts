import type postgres from 'postgres'

export type DatabaseClient = postgres.Sql

export async function waitForDatabase(
  client: DatabaseClient,
  attempts = 30,
  delayMs = 1000,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client`select 1`
      return
    } catch (error) {
      if (attempt === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
