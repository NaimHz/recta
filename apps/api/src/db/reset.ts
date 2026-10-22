import postgres from 'postgres'
import { env } from '../env'
import { runMigrations } from './migrate'
import { seedCities } from './seed'
import { waitForDatabase } from './wait'

const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => undefined })

try {
  await waitForDatabase(client)
  await client`drop extension if exists postgis cascade`
  await client`drop schema if exists public cascade`
  await client`drop schema if exists drizzle cascade`
  await client`create schema public`
  await client`create extension if not exists postgis`
  await runMigrations(client)
  const count = await seedCities(client)
  console.log(`Base réinitialisée : ${count} ville(s).`)
} finally {
  await client.end()
}
