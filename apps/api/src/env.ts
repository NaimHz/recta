import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))

if (existsSync(envFile)) {
  process.loadEnvFile(envFile)
}

const optionalNonEmpty = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
)

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4310),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1).default('postgres://recta:recta@localhost:5432/recta'),
  ANTHROPIC_API_KEY: optionalNonEmpty,
  EXTRACTION_MODEL: optionalNonEmpty,
})

export const env = EnvSchema.parse(process.env)
