import { z } from 'zod'
import { IsoDateSchema } from './plan'

export const BUSINESS_STATUSES = [
  'operational',
  'closed_temporarily',
  'closed_permanently',
  'unknown',
] as const

export const BusinessStatusSchema = z.enum(BUSINESS_STATUSES)
export type BusinessStatus = z.infer<typeof BusinessStatusSchema>

export const CuratedFactSourceSchema = z.object({
  url: z.url({ error: 'URL de source attendue' }).refine((value) => value.startsWith('https://'), {
    message: 'La source doit être en HTTPS',
  }),
  reviewedAt: IsoDateSchema,
})
export type CuratedFactSource = z.infer<typeof CuratedFactSourceSchema>

export const CuratedFactSchema = z.object({
  key: z.literal('business_status'),
  value: BusinessStatusSchema,
  source: CuratedFactSourceSchema,
})
export type CuratedFact = z.infer<typeof CuratedFactSchema>

export const CuratedSiteSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identifiant de site invalide'),
  name: z.string().min(1),
  placeId: z
    .string()
    .regex(/^osm:(node|way|relation)\/\d+$/, 'Identifiant OSM attendu')
    .nullable(),
  address: z.string().min(1).nullable(),
  facts: z.array(CuratedFactSchema).min(1),
})
export type CuratedSite = z.infer<typeof CuratedSiteSchema>

export const CuratedFactsFileSchema = z
  .object({
    version: z.literal(1),
    city: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identifiant de ville invalide'),
    sites: z.array(CuratedSiteSchema).min(1),
  })
  .superRefine(({ sites }, ctx) => {
    const siteIds = new Set<string>()
    const placeIds = new Set<string>()

    for (const [siteIndex, site] of sites.entries()) {
      if (siteIds.has(site.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Identifiant de site dupliqué : ${site.id}`,
          path: ['sites', siteIndex, 'id'],
        })
      }
      siteIds.add(site.id)

      if (site.placeId !== null) {
        if (placeIds.has(site.placeId)) {
          ctx.addIssue({
            code: 'custom',
            message: `Identifiant OSM dupliqué : ${site.placeId}`,
            path: ['sites', siteIndex, 'placeId'],
          })
        }
        placeIds.add(site.placeId)
      }

      const factKeys = new Set<string>()

      for (const [factIndex, fact] of site.facts.entries()) {
        if (factKeys.has(fact.key)) {
          ctx.addIssue({
            code: 'custom',
            message: `Fait dupliqué : ${fact.key}`,
            path: ['sites', siteIndex, 'facts', factIndex, 'key'],
          })
        }
        factKeys.add(fact.key)
      }
    }
  })

export type CuratedFactsFile = z.infer<typeof CuratedFactsFileSchema>
