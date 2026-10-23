import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAnthropicExtractionClientFromEnv } from '../extraction/anthropic'
import { extractPlan } from '../extraction/client'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

function resolveInputPath(input: string): string {
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd()
  const direct = resolve(invocationDirectory, input)

  if (existsSync(direct)) return direct

  const fromRepoRoot = resolve(repoRoot, input)

  return existsSync(fromRepoRoot) ? fromRepoRoot : direct
}

async function main(): Promise<void> {
  const input = process.argv[2]

  if (!input) {
    console.error('Usage : pnpm extract <fichier.txt>')
    process.exitCode = 1
    return
  }

  const filePath = resolveInputPath(input)
  let text: string

  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`Impossible de lire ${filePath} : ${detail}`)
    process.exitCode = 1
    return
  }

  try {
    const client = createAnthropicExtractionClientFromEnv()
    const plan = await extractPlan(text, client)

    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`Extraction impossible : ${detail}`)
    process.exitCode = 1
  }
}

void main()
