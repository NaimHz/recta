import { describe, expect, it } from 'vitest'
import { VerificationReportSchema } from '@recta/domain'
import { runVerify } from './verify'

async function run(args: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await runVerify(args, {
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
  })

  return { code, stdout, stderr }
}

describe('runVerify', () => {
  it('produit le rapport Markdown de la fixture hors réseau en moins de 30 s', async () => {
    const startedAt = performance.now()
    const { code, stdout, stderr } = await run(['fixture.txt', '--offline'])

    expect(performance.now() - startedAt).toBeLessThan(30_000)
    expect(code).toBe(1)
    expect(stderr).toBe('')
    expect(stdout).toContain('**Verdict : violation.**')
    expect(stdout).toContain('`outside_opening_hours`')
    expect(stdout).toContain('> Hors réseau : trajets non vérifiés.')
  })

  it('sort un rapport JSON conforme au schéma', async () => {
    const { code, stdout } = await run(['fixture.txt', '--offline', '--json'])
    const report = VerificationReportSchema.parse(JSON.parse(stdout))

    expect(code).toBe(1)
    expect(report.summary.issues.error).toBe(1)
    expect(report.issues.map((issue) => issue.id)).toEqual(['outside_opening_hours:stop-3'])
  })

  it('rend 2 pour un fichier introuvable', async () => {
    const { code, stderr } = await run(['absent.txt', '--offline'])

    expect(code).toBe(2)
    expect(stderr).toMatch(/^Impossible de lire .*absent\.txt/)
  })

  it('rend 2 pour une option inconnue', async () => {
    const { code, stdout, stderr } = await run(['fixture.txt', '--html'])

    expect(code).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toMatch(/^Usage : pnpm verify/)
  })

  it.each([
    ['--text sans ville', ['texte.txt', '--text']],
    ['--text hors réseau', ['texte.txt', '--text', '--city', 'paris', '--offline']],
    ['--city sans --text', ['fixture.txt', '--city', 'paris']],
    ['date de départ invalide', ['texte.txt', '--text', '--city', 'paris', '--start', '24/10']],
    ['option sans valeur', ['texte.txt', '--text', '--city']],
  ])('rend 2 pour %s', async (_label, args) => {
    const { code, stdout, stderr } = await run(args)

    expect(code).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toMatch(/^Usage : pnpm verify/)
  })
})
