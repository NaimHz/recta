import { ExtractedPlanSchema } from '@recta/domain'
import { z } from 'zod'
import { env } from '../env'
import type { ExtractionClient } from './client'
import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_TOOL_NAME, buildExtractionPrompt } from './prompt'

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export class ExtractionProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionProviderError'
  }
}

export type AnthropicExtractionClientOptions = {
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
  endpoint?: string
  maxTokens?: number
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

export class AnthropicExtractionClient implements ExtractionClient {
  private readonly fetchImpl: typeof fetch
  private readonly endpoint: string
  private readonly maxTokens: number

  constructor(private readonly options: AnthropicExtractionClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.endpoint = options.endpoint ?? ANTHROPIC_MESSAGES_URL
    this.maxTokens = options.maxTokens ?? 4096
  }

  async extract(text: string): Promise<unknown> {
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
        tools: [
          {
            name: EXTRACTION_TOOL_NAME,
            description: "Émet l'itinéraire extrait, sans aucune valeur inventée.",
            input_schema: z.toJSONSchema(ExtractedPlanSchema),
          },
        ],
        tool_choice: {
          type: 'tool',
          name: EXTRACTION_TOOL_NAME,
        },
      }),
    })
    const payload = (await response.json().catch(() => null)) as unknown

    if (!response.ok) {
      const detail = providerDetail(payload)
      throw new ExtractionProviderError(
        `Anthropic a répondu ${response.status}${detail ? ` : ${detail}` : ''}.`,
      )
    }

    if (!isObject(payload) || !Array.isArray(payload.content)) {
      throw new ExtractionProviderError('Réponse Anthropic sans contenu exploitable.')
    }

    const toolUse = payload.content.find(
      (block): block is JsonObject & { input: unknown } =>
        isObject(block) && block.type === 'tool_use' && block.name === EXTRACTION_TOOL_NAME,
    )

    if (!toolUse) {
      throw new ExtractionProviderError("Réponse Anthropic sans appel d'outil emit_plan.")
    }

    return toolUse.input
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
  })
}
