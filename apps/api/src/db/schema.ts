import { sql } from 'drizzle-orm'
import { customType, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

const polygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Polygon, 4326)'
  },
})

export type CityCapabilities = {
  transit: boolean
  curatedFacts: boolean
}

export const cities = pgTable('cities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  bbox: polygon('bbox').notNull(),
  timezone: text('timezone').notNull(),
  country: text('country').notNull(),
  holidayRegion: text('holiday_region').notNull(),
  transitAreaIds: text('transit_area_ids')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  locale: text('locale').notNull(),
  curatedFactsPath: text('curated_facts_path').notNull(),
  evalCorpusPath: text('eval_corpus_path').notNull(),
  capabilities: jsonb('capabilities').$type<CityCapabilities>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
