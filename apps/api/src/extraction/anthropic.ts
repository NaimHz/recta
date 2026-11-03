import { ExtractedPlanSchema } from '@recta/domain'
import { z } from 'zod'
import { env } from '../env'
import type { ExtractionClient } from './client'
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompt'

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export const EXTRACTION_EFFORTS = ['low', 'medium', 'high'] as const
export type ExtractionEffort = (typeof EXTRACTION_EFFORTS)[number]

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
])

export type ExtractionUsage = {
  inputTokens: number
  outputTokens: number
}

export class ExtractionProviderError extends Error {
  constructor(
    message: string,
    readonly usage: ExtractionUsage | null = null,
  ) {
    super(message)
    this.name = 'ExtractionProviderError'
  }
}

export type AnthropicExtractionClientOptions = {
  apiKey: string
  model: string
  effort?: ExtractionEffort
  fetchImpl?: typeof fetch
  endpoint?: string
  maxTokens?: number
}

export type ExtractionMetrics = ExtractionUsage & {
  output: unknown
  stopReason: string | null
  latencyMs: number
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function providerDetail(payload: unknown): string | null {
  if (!isObject(payload)) return null
  if (!isObject(payload.error)) return null
  if (typeof payload.error.message !== 'string') return null

  return payload.error.message
}

function tokenCount(usage: unknown, key: string): number {
  if (!isObject(usage)) return 0

  const value = usage[key]

  return typeof value === 'number' ? value : 0
}

export function toOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toOutputSchema)
  if (!isObject(schema)) return schema

  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYS.has(key))
      .map(([key, value]) => [key, toOutputSchema(value)]),
  )
}

const EXTRACTION_OUTPUT_SCHEMA = toOutputSchema(z.toJSONSchema(ExtractedPlanSchema))

export class AnthropicExtractionClient implements ExtractionClient {
  private readonly fetchImpl: typeof fetch
  private readonly endpoint: string
  private readonly maxTokens: number

  constructor(private readonly options: AnthropicExtractionClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.endpoint = options.endpoint ?? ANTHROPIC_MESSAGES_URL
    this.maxTokens = options.maxTokens ?? 16_000
  }

  async extract(text: string): Promise<unknown> {
    return (await this.extractWithMetrics(text)).output
  }

  async extractWithMetrics(text: string): Promise<ExtractionMetrics> {
    const startedAt = performance.now()
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.options.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.maxTokens,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildExtractionPrompt(text),
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: EXTRACTION_OUTPUT_SCHEMA },
          ...(this.options.effort ? { effort: this.options.effort } : {}),
        },
      }),
    })
    const payload = (await response.json().catch(() => null)) as unknown
    const latencyMs = performance.now() - startedAt

    if (!response.ok) {
      const detail = providerDetail(payload)
      throw new ExtractionProviderError(
        `Anthropic a répondu ${response.status}${detail ? ` : ${detail}` : ''}.`,
      )
    }

    if (!isObject(payload) || !Array.isArray(payload.content)) {
      throw new ExtractionProviderError('Réponse Anthropic sans contenu exploitable.')
    }

    const stopReason = typeof payload.stop_reason === 'string' ? payload.stop_reason : null
    const usage: ExtractionUsage = {
      inputTokens: tokenCount(payload.usage, 'input_tokens'),
      outputTokens: tokenCount(payload.usage, 'output_tokens'),
    }

    if (stopReason === 'refusal' || stopReason === 'max_tokens') {
      throw new ExtractionProviderError(`Réponse Anthropic interrompue : ${stopReason}.`, usage)
    }

    const json = payload.content
      .filter(
        (block): block is JsonObject & { text: string } =>
          isObject(block) && block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('')

    if (json.trim() === '') {
      throw new ExtractionProviderError('Réponse Anthropic sans JSON.', usage)
    }

    let output: unknown

    try {
      output = JSON.parse(json)
    } catch {
      throw new ExtractionProviderError('Réponse Anthropic avec un JSON illisible.', usage)
    }

    return { output, ...usage, stopReason, latencyMs }
  }
}

export function createAnthropicExtractionClientFromEnv(): AnthropicExtractionClient {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ExtractionProviderError('ANTHROPIC_API_KEY manquante : le mode live est désactivé.')
  }

  if (!env.EXTRACTION_MODEL) {
    throw new ExtractionProviderError('EXTRACTION_MODEL manquante : le mode live est désactivé.')
  }

  return new AnthropicExtractionClient({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.EXTRACTION_MODEL,
    ...(env.EXTRACTION_EFFORT ? { effort: env.EXTRACTION_EFFORT } : {}),
  })
}
