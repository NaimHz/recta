import postgres from 'postgres'
import { env } from '../env'
import { waitForDatabase } from './wait'

const client = postgres(env.DATABASE_URL, { max: 1 })

try {
  await waitForDatabase(client)
  const [postgis] = await client<{ version: string }[]>`select postgis_version() as version`
  const [stats] = await client<{ count: number }[]>`select count(*)::int as count from cities`

  if (!postgis?.version) {
    throw new Error('PostGIS est indisponible.')
  }

  if (!stats || stats.count === 0) {
    throw new Error('Aucune ville en base.')
  }

  console.log(`PostGIS ${postgis.version} — ${stats.count} ville(s).`)
} finally {
  await client.end()
}
