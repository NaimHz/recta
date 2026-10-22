import { z } from 'zod'

export const CityConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    timezone: z.string().min(1),
    country: z.string().regex(/^[A-Z]{2}$/),
    holidayRegion: z.string().min(1),
    transitAreaIds: z.array(z.string().min(1)),
    locale: z.string().min(1),
    curatedFactsPath: z.string().min(1),
    evalCorpusPath: z.string().min(1),
    capabilities: z.object({
      transit: z.boolean(),
      curatedFacts: z.boolean(),
    }),
  })
  .refine(({ bbox }) => bbox[0] < bbox[2] && bbox[1] < bbox[3], {
    message: 'bbox doit être [ouest, sud, est, nord]',
    path: ['bbox'],
  })

export type CityConfig = z.infer<typeof CityConfigSchema>
