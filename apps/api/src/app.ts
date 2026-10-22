import { SCHEMA_VERSION } from '@recta/domain'
import Fastify, { type FastifyInstance } from 'fastify'

type BuildAppOptions = {
  logger?: boolean
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false })

  app.get('/health', async () => ({
    status: 'ok',
    service: 'recta-api',
    schemaVersion: SCHEMA_VERSION,
  }))

  return app
}
