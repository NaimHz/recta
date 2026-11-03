import { describe, expect, it } from 'vitest'
import {
  NO_TRAVEL,
  buildVerificationReport,
  verifyPlan,
  type Issue,
  type VerificationReport,
} from '@recta/domain'
import { loadVerificationFacts } from '../verification/facts'
import { parseFixture } from './fixture'
import { exitCodeFor, renderMarkdown, renderResolutions } from './report'

const NOW = new Date('2026-11-03T12:00:00.000Z')

const fixture = [
  'city: paris',
  'day: 2026-10-24',
  'timezone: Europe/Paris',
  '09:00-11:00 | Louvre | 09:00-18:00 | -',
  '12:00-13:30 | Le Comptoir | 12:00-14:30 | Sun,Mon',
  "17:30-19:00 | Musée d'Orsay | 09:30-18:00 | Mon",
].join('\n')

async function fixtureReport(): Promise<VerificationReport> {
  const facts = await loadVerificationFacts('paris')
  const result = verifyPlan(parseFixture(fixture), { ...facts, travel: NO_TRAVEL })

  return buildVerificationReport(result, { now: NOW })
}

function withIssues(report: VerificationReport, issues: Issue[]): VerificationReport {
  return buildVerificationReport({ ...report, issues }, { now: NOW })
}

const warning: Issue = {
  id: 'insufficient_buffer:stop-1,stop-2',
  code: 'insufficient_buffer',
  severity: 'warning',
  message: 'Marge de 5 min entre Louvre et Le Comptoir.',
  stopIds: ['stop-1', 'stop-2'],
  evidence: [
    {
      source: 'osrm',
      sourceDate: '2026-11-03',
      retrievedAt: '2026-11-03T12:00:00.000Z',
      url: 'https://routing.openstreetmap.de/routed-foot/table/v1/foot/2.33,48.86;2.34,48.85',
      attribution: '© OpenStreetMap contributors',
      raw: `{"durations":[[0,${'1'.repeat(200)}]]}`,
      fields: {},
    },
  ],
}

describe('renderMarkdown', () => {
  it('rend le verdict, la couverture, les issues par jour et les indéterminés', async () => {
    const markdown = renderMarkdown(await fixtureReport(), { offline: false })

    expect(markdown.split('\n').slice(0, 15)).toEqual([
      '# Vérification — paris',
      '',
      '**Verdict : violation.** 1 erreur, 0 avertissement, 0 info, 2 indéterminés.',
      '',
      '**Couverture :** 13 contrôles tranchés sur 17 (77 %).',
      '',
      '## 2026-10-24',
      '',
      "### Erreur — Musée d'Orsay (17:30-19:00)",
      '',
      '`outside_opening_hours` · Le stop finit à 19:00, après la fermeture de 18:00.',
      '- Preuve : fixture, 2026-10-24 · « 09:30-18:00; Mo off »',
      '',
      '## Indéterminés',
      '',
    ])
    expect(markdown).toContain(
      '- `travel_time_infeasible`, `insufficient_buffer` — Louvre (09:00-11:00) → Le Comptoir (12:00-13:30) : coordonnées absentes',
    )
    expect(markdown).toContain('| `outside_opening_hours` | 3 | 0 | 0 |')
    expect(markdown).not.toContain('Hors réseau')
    expect(markdown).not.toContain('## Fraîcheur des données')
  })

  it('classe les erreurs avant les avertissements et tronque une preuve longue', async () => {
    const report = await fixtureReport()
    const markdown = renderMarkdown(withIssues(report, [warning, ...report.issues]), {
      offline: false,
    })

    expect(markdown.indexOf('### Erreur')).toBeLessThan(markdown.indexOf('### Avertissement'))
    expect(markdown).toContain(
      '### Avertissement — Louvre (09:00-11:00) → Le Comptoir (12:00-13:30)',
    )
    expect(markdown).toContain(
      `- Preuve : osrm, 2026-11-03 · <${warning.evidence[0]?.url}> · « {"durations":[[0,${'1'.repeat(103)}… »`,
    )
    expect(markdown).toContain('1 erreur, 1 avertissement, 0 info')
  })

  it('signale le mode hors réseau', async () => {
    expect(renderMarkdown(await fixtureReport(), { offline: true })).toContain(
      '> Hors réseau : trajets non vérifiés.',
    )
  })

  it('liste les lieux dont la source est ancienne ou sans date', async () => {
    const report = await fixtureReport()
    const [first, ...rest] = report.freshness.entries
    const markdown = renderMarkdown(
      {
        ...report,
        freshness: {
          ...report.freshness,
          entries: [
            {
              ...first!,
              freshness: 'ancienne',
              ageDays: 400,
              warning: 'Donnée source vieille de 400 jours (seuil : 365).',
            },
            ...rest.map((entry) => ({ ...entry, freshness: 'inconnue' as const })),
          ],
        },
      },
      { offline: false },
    )

    expect(markdown).toContain('## Fraîcheur des données')
    expect(markdown).toContain('- Louvre : Donnée source vieille de 400 jours (seuil : 365).')
    expect(markdown).toContain('- Le Comptoir : source sans date (fixture).')
  })
})

describe('exitCodeFor', () => {
  it('rend 1 avec au moins une erreur', async () => {
    expect(exitCodeFor(await fixtureReport())).toBe(1)
  })

  it('rend 0 avec des avertissements seuls ou des indéterminés', async () => {
    expect(exitCodeFor(withIssues(await fixtureReport(), [warning]))).toBe(0)
    expect(exitCodeFor(withIssues(await fixtureReport(), []))).toBe(0)
  })

  it('rend 2 quand une règle a planté', async () => {
    const report = await fixtureReport()

    expect(
      exitCodeFor({
        ...report,
        undetermined: [{ codes: ['stop_overlap'], stopIds: ['stop-1'], reason: 'rule_error' }],
      }),
    ).toBe(2)
  })
})

describe('renderResolutions', () => {
  it('liste les lieux ambigus et introuvables avec la question et les options', () => {
    expect(
      renderResolutions([
        { stopId: 'stop-1', name: 'Louvre', status: 'resolved', question: null, options: [] },
        {
          stopId: 'stop-2',
          name: 'Café Lumière',
          status: 'ambiguous',
          question: 'Quel Café Lumière ?',
          options: [
            {
              id: 'osm:node/1',
              name: 'Café Lumière',
              address: '1 rue A, Paris',
              category: null,
              score: 0.9,
            },
          ],
        },
        {
          stopId: 'stop-3',
          name: 'Bar Inconnu',
          status: 'not_found',
          question: 'Où est Bar Inconnu ?',
          options: [],
        },
      ]),
    ).toBe(
      [
        '',
        '## Lieux à préciser',
        '',
        '### Café Lumière (ambigu)',
        '',
        'Quel Café Lumière ?',
        '',
        '- Café Lumière — 1 rue A, Paris (`osm:node/1`)',
        '',
        '### Bar Inconnu (introuvable)',
        '',
        'Où est Bar Inconnu ?',
        '',
      ].join('\n'),
    )
  })

  it('ne rend rien quand tout est résolu', () => {
    expect(
      renderResolutions([
        { stopId: 'stop-1', name: 'Louvre', status: 'resolved', question: null, options: [] },
      ]),
    ).toBe('')
  })
})
