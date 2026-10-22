import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { env } from '../env'
import { isMainModule } from './is-main'
import type { DatabaseClient } from './wait'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export async function runMigrations(client: DatabaseClient): Promise<void> {
  const db = drizzle(client)
  await migrate(db, { migrationsFolder })
}

if (isMainModule(import.meta.url)) {
  const client = postgres(env.DATABASE_URL, { max: 1 })

  try {
    await runMigrations(client)
    console.log('Migrations appliquées.')
  } finally {
    await client.end()
  }
}
