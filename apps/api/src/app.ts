import { IsoDateSchema, SCHEMA_VERSION } from '@recta/domain'
import Fastify, { type FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ExtractionInventionError, ExtractionSchemaError } from './extraction/client'
import { verifyText as defaultVerifyText, type VerifyText } from './pipeline/verify-text'
import { listCities } from './verification/facts'

type BuildAppOptions = {
  logger?: boolean
  verifyText?: VerifyText
}

const MAX_TEXT_LENGTH = 20_000

const VerifyBodySchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  cityId: z.string().min(1),
  start: IsoDateSchema.nullable(),
})

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 })
  const verifyText = options.verifyText ?? defaultVerifyText

  app.get('/health', async () => ({
    status: 'ok',
    service: 'recta-api',
    schemaVersion: SCHEMA_VERSION,
  }))

  app.get('/cities', async () =>
    (await listCities()).map((city) => ({ id: city.id, name: city.name })),
  )

  app.post('/verify', async (request, reply) => {
    const body = VerifyBodySchema.safeParse(request.body)

    if (!body.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'Texte, ville et date de départ (AAAA-MM-JJ ou null) sont attendus.',
      })
    }

    const cities = await listCities()

    if (!cities.some((city) => city.id === body.data.cityId)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: `Ville inconnue : ${body.data.cityId}.`,
      })
    }

    try {
      return await verifyText(body.data)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      if (error instanceof ExtractionInventionError || error instanceof ExtractionSchemaError) {
        return reply.code(422).send({
          error: 'extraction_rejected',
          message: `${message} Relancer la vérification peut suffire.`,
        })
      }

      request.log.error(error)

      return reply.code(502).send({ error: 'upstream', message })
    }
  })

  return app
}
