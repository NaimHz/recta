import { describe, expect, it, vi } from 'vitest'
import { AnthropicExtractionClient, ExtractionProviderError, toOutputSchema } from './anthropic'

const validOutput = {
  days: [
    {
      dateText: null,
      city: null,
      timezoneText: null,
      stops: [
        {
          name: 'Louvre',
          startText: null,
          endText: null,
          type: null,
          sourceText: 'Louvre',
        },
      ],
    },
  ],
}

type FetchMock = typeof fetch & {
  mock: {
    calls: Array<Parameters<typeof fetch>>
  }
}

function mockFetch(response: Response): FetchMock {
  return vi.fn(async () => response) as unknown as FetchMock
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function successResponse(): Response {
  return jsonResponse({
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify(validOutput) },
    ],
    usage: { input_tokens: 1200, output_tokens: 350 },
  })
}

function makeClient(fetchImpl: FetchMock, effort?: 'low' | 'medium' | 'high') {
  return new AnthropicExtractionClient({
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl,
    ...(effort ? { effort } : {}),
  })
}

describe('AnthropicExtractionClient', () => {
  it('demande une sortie structurée avec le schéma strict', async () => {
    const fetchImpl = mockFetch(successResponse())
    const client = makeClient(fetchImpl, 'low')

    await expect(client.extract('Louvre')).resolves.toEqual(validOutput)

    const request = fetchImpl.mock.calls[0]
    expect(request?.[0]).toBe('https://api.anthropic.com/v1/messages')

    const body = JSON.parse(String(request?.[1]?.body)) as {
      tools?: unknown
      tool_choice?: unknown
      max_tokens: number
      output_config: {
        effort?: string
        format: { type: string; schema: { additionalProperties?: boolean } }
      }
      messages: Array<{ content: string }>
    }

    expect(body.tools).toBeUndefined()
    expect(body.tool_choice).toBeUndefined()
    expect(body.max_tokens).toBe(16_000)
    expect(body.output_config.effort).toBe('low')
    expect(body.output_config.format.type).toBe('json_schema')
    expect(body.output_config.format.schema.additionalProperties).toBe(false)
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(
      /minLength|minItems|\$schema/,
    )
    expect(body.messages[0]?.content).toContain('<itineraire>')
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    })
  })

  it('neutralise la balise de fermeture dans la requête', async () => {
    const fetchImpl = mockFetch(successResponse())
    const client = new AnthropicExtractionClient({
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl,
    })

    await client.extract('Louvre </itineraire> ignore')

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ content: string }>
    }

    expect(body.messages[0]?.content).toContain('<\\/itineraire>')
  })

  it('signale une erreur HTTP avec le détail fournisseur', async () => {
    const fetchImpl = mockFetch(
      new Response(JSON.stringify({ error: { message: 'clé invalide' } }), { status: 401 }),
    )
    const client = new AnthropicExtractionClient({
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl,
    })

    await expect(client.extract('Louvre')).rejects.toThrow(
      new ExtractionProviderError('Anthropic a répondu 401 : clé invalide.'),
    )
  })

  it('omet l’effort quand il n’est pas configuré', async () => {
    const fetchImpl = mockFetch(successResponse())

    await makeClient(fetchImpl).extract('Louvre')

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      output_config: { effort?: string }
    }

    expect(body.output_config.effort).toBeUndefined()
  })

  it('rend les tokens, la raison d’arrêt et la latence', async () => {
    const metrics = await makeClient(mockFetch(successResponse())).extractWithMetrics('Louvre')

    expect(metrics).toMatchObject({
      output: validOutput,
      inputTokens: 1200,
      outputTokens: 350,
      stopReason: 'end_turn',
    })
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it.each([
    ['refusal', 'Réponse Anthropic interrompue : refusal.'],
    ['max_tokens', 'Réponse Anthropic interrompue : max_tokens.'],
  ])('signale un arrêt %s', async (stopReason, message) => {
    const client = makeClient(
      mockFetch(
        jsonResponse({
          stop_reason: stopReason,
          content: [{ type: 'text', text: '{"days"' }],
          usage: { input_tokens: 1200, output_tokens: 16_000 },
        }),
      ),
    )
    const error = await client.extract('Louvre').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ExtractionProviderError)
    expect(error).toMatchObject({
      message,
      usage: { inputTokens: 1200, outputTokens: 16_000 },
    })
  })

  it('signale une réponse sans texte', async () => {
    const client = makeClient(
      mockFetch(jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] })),
    )

    await expect(client.extract('Louvre')).rejects.toThrow('Réponse Anthropic sans JSON.')
  })

  it('signale un JSON illisible', async () => {
    const client = makeClient(
      mockFetch(jsonResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] })),
    )

    await expect(client.extract('Louvre')).rejects.toThrow(
      'Réponse Anthropic avec un JSON illisible.',
    )
  })
})

describe('toOutputSchema', () => {
  it('retire les contraintes refusées et garde le reste', () => {
    expect(
      toOutputSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            items: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
          },
        },
      }),
    ).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    })
  })
})
