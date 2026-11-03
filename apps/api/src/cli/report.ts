import type {
  Evidence,
  Issue,
  IssueSeverity,
  Stop,
  UndeterminedReason,
  VerificationReport,
} from '@recta/domain'

export type ExitCode = 0 | 1 | 2

const RAW_EXCERPT_LENGTH = 120

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }

const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  error: 'Erreur',
  warning: 'Avertissement',
  info: 'Info',
}

const REASON_LABELS: Record<UndeterminedReason, string> = {
  unknown: 'cause inconnue',
  missing_hours: 'horaires absents',
  invalid_syntax: 'horaires illisibles',
  invalid_timezone: 'fuseau invalide',
  invalid_context: 'contexte d’horaires invalide',
  invalid_local_time: 'heure locale inexistante',
  place_unresolved: 'lieu non résolu',
  missing_coordinates: 'coordonnées absentes',
  time_unknown: 'heure absente',
  date_unknown: 'date absente',
  transit_unavailable: 'trajet non calculable',
  unknown_mode: 'mode de transport inconnu',
  rule_error: 'erreur interne de règle',
}

type StopEntry = { stop: Stop; dayIndex: number; stopIndex: number }

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

function stopLabel(stop: Stop): string {
  return stop.start && stop.end ? `${stop.name} (${stop.start}-${stop.end})` : stop.name
}

function excerpt(raw: string): string {
  const line = raw.replace(/\s+/g, ' ').trim()

  return line.length > RAW_EXCERPT_LENGTH ? `${line.slice(0, RAW_EXCERPT_LENGTH)}…` : line
}

function evidenceLine(evidence: Evidence): string {
  const parts = [
    evidence.sourceDate ? `${evidence.source}, ${evidence.sourceDate}` : evidence.source,
  ]
  const raw = excerpt(evidence.raw)

  if (evidence.url) parts.push(`<${evidence.url}>`)
  if (raw) parts.push(`« ${raw} »`)

  return `- Preuve : ${parts.join(' · ')}`
}

export function exitCodeFor(report: VerificationReport): ExitCode {
  if (report.undetermined.some((entry) => entry.reason === 'rule_error')) return 2

  return report.summary.issues.error > 0 ? 1 : 0
}

export function renderMarkdown(report: VerificationReport, options: { offline: boolean }): string {
  const stops = new Map<string, StopEntry>()

  report.plan.days.forEach((day, dayIndex) =>
    day.stops.forEach((stop, stopIndex) => stops.set(stop.id, { stop, dayIndex, stopIndex })),
  )

  const labelFor = (stopIds: string[]): string =>
    stopIds
      .map((id) => {
        const entry = stops.get(id)

        return entry ? stopLabel(entry.stop) : id
      })
      .join(' → ')
  const positionOf = (issue: Issue): StopEntry | undefined => stops.get(issue.stopIds[0] ?? '')
  const issueLines = (issue: Issue): string[] => [
    '',
    `### ${SEVERITY_LABELS[issue.severity]} — ${labelFor(issue.stopIds)}`,
    '',
    `\`${issue.code}\` · ${issue.message}`,
    ...issue.evidence.map(evidenceLine),
  ]

  const { issues, undetermined, coverage } = report.summary
  const lines = [
    `# Vérification — ${report.plan.cityId}`,
    '',
    `**Verdict : ${report.status}.** ${plural(issues.error, 'erreur')}, ${plural(issues.warning, 'avertissement')}, ${plural(issues.info, 'info')}, ${plural(undetermined, 'indéterminé')}.`,
    '',
    coverage.ratio === null
      ? '**Couverture :** aucun contrôle exécuté.'
      : `**Couverture :** ${coverage.decided} contrôles tranchés sur ${coverage.executed} (${Math.round(coverage.ratio * 100)} %).`,
  ]

  if (options.offline) lines.push('', '> Hors réseau : trajets non vérifiés.')

  report.plan.days.forEach((day, dayIndex) => {
    const dayIssues = report.issues
      .filter((issue) => positionOf(issue)?.dayIndex === dayIndex)
      .sort(
        (a, b) =>
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
          (positionOf(a)?.stopIndex ?? 0) - (positionOf(b)?.stopIndex ?? 0),
      )

    if (dayIssues.length === 0) return

    lines.push('', `## ${day.date ?? `Jour ${dayIndex + 1}`}`)

    for (const issue of dayIssues) {
      lines.push(...issueLines(issue))
    }
  })

  const orphanIssues = report.issues.filter((issue) => positionOf(issue) === undefined)

  if (orphanIssues.length > 0) {
    lines.push('', '## Hors plan')

    for (const issue of orphanIssues) {
      lines.push(...issueLines(issue))
    }
  }

  if (report.undetermined.length > 0) {
    lines.push('', '## Indéterminés', '')

    for (const entry of report.undetermined) {
      lines.push(
        `- ${entry.codes.map((code) => `\`${code}\``).join(', ')} — ${labelFor(entry.stopIds)} : ${REASON_LABELS[entry.reason]}`,
      )
    }
  }

  lines.push(
    '',
    '## Contrôles',
    '',
    '| Type | Exécutés | Indéterminés | Supprimés |',
    '|---|---|---|---|',
    ...report.checks.map(
      (check) =>
        `| \`${check.code}\` | ${check.executed} | ${check.undetermined} | ${check.suppressed} |`,
    ),
  )

  const flagged = report.freshness.entries.filter((entry) => entry.freshness !== 'fraîche')

  if (flagged.length > 0) {
    lines.push('', '## Fraîcheur des données', '')

    for (const entry of flagged) {
      lines.push(
        entry.freshness === 'ancienne'
          ? `- ${entry.placeName} : ${entry.warning}`
          : `- ${entry.placeName} : source sans date (${entry.provider}).`,
      )
    }
  }

  return `${lines.join('\n')}\n`
}
