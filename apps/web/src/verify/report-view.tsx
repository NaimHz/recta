import type { Evidence, Issue, Stop, Undetermined } from '@recta/domain'
import {
  CODE_LABELS,
  REASON_LABELS,
  RESOLUTION_LABELS,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  STATUS_LABELS,
} from './labels'
import type { ResolutionSummary, VerifyResponse } from './types'

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count > 1 ? 's' : ''}`
}

function windowLabel(stop: Stop): string {
  if (stop.start === null || stop.end === null) return 'heure inconnue'

  return stop.windowSource === 'explicit'
    ? `${stop.start}–${stop.end}`
    : `${stop.start}–${stop.end} (estimé)`
}

function stopNames(stopIds: string[], stops: Map<string, Stop>): string {
  return stopIds.map((id) => stops.get(id)?.name ?? id).join(' → ')
}

function EvidenceItem({ evidence }: { evidence: Evidence }) {
  return (
    <li className="evidence">
      <span className="evidence-source">
        {evidence.source}
        {evidence.sourceDate ? `, ${evidence.sourceDate}` : ''}
      </span>
      {evidence.url ? (
        <a href={evidence.url} target="_blank" rel="noreferrer">
          source
        </a>
      ) : null}
      <code>{evidence.raw}</code>
    </li>
  )
}

function IssueItem({ issue, stops }: { issue: Issue; stops: Map<string, Stop> }) {
  return (
    <li className="issue" data-severity={issue.severity}>
      <div className="issue-head">
        <span className="badge" data-severity={issue.severity}>
          {SEVERITY_LABELS[issue.severity]}
        </span>
        <strong>{CODE_LABELS[issue.code]}</strong>
        <span className="muted">{stopNames(issue.stopIds, stops)}</span>
      </div>
      <p>{issue.message}</p>
      <details>
        <summary>Preuves ({issue.evidence.length})</summary>
        <ul className="evidence-list">
          {issue.evidence.map((evidence, index) => (
            <EvidenceItem key={index} evidence={evidence} />
          ))}
        </ul>
      </details>
    </li>
  )
}

function StopItem({
  stop,
  issues,
  resolution,
}: {
  stop: Stop
  issues: Issue[]
  resolution: ResolutionSummary | undefined
}) {
  return (
    <li className="stop">
      <span className="stop-time">{windowLabel(stop)}</span>
      <div className="stop-body">
        <div className="stop-name">
          {stop.name}
          {issues.map((issue) => (
            <span key={issue.id} className="badge" data-severity={issue.severity}>
              {CODE_LABELS[issue.code]}
            </span>
          ))}
        </div>
        <div className="muted">
          {stop.place
            ? `${stop.place.name}${stop.place.address ? ` · ${stop.place.address}` : ''}`
            : `Lieu ${RESOLUTION_LABELS[stop.resolution]}`}
        </div>
        {resolution?.question ? (
          <div className="question">
            {resolution.question}
            {resolution.options.length > 0 ? (
              <ul>
                {resolution.options.map((option) => (
                  <li key={option.id}>
                    {option.name}
                    {option.address ? ` · ${option.address}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

function UndeterminedItem({ entry, stops }: { entry: Undetermined; stops: Map<string, Stop> }) {
  return (
    <li>
      <strong>{REASON_LABELS[entry.reason]}</strong>{' '}
      <span className="muted">
        {stopNames(entry.stopIds, stops)} :{' '}
        {entry.codes.map((code) => CODE_LABELS[code]).join(', ')}
      </span>
    </li>
  )
}

export function ReportView({ result }: { result: VerifyResponse }) {
  const { report, resolutions } = result
  const stops = new Map(
    report.plan.days.flatMap((day) => day.stops.map((stop) => [stop.id, stop] as const)),
  )
  const issues = [...report.issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const resolutionByStop = new Map(resolutions.map((entry) => [entry.stopId, entry]))
  const resolved = [...stops.values()].filter((stop) => stop.place !== null).length

  return (
    <section className="report">
      <div className="summary" data-status={report.status}>
        <strong>{STATUS_LABELS[report.status]}</strong>
        <span>
          {plural(report.summary.issues.error, 'erreur')} ·{' '}
          {plural(report.summary.issues.warning, 'avertissement')} ·{' '}
          {plural(report.summary.undetermined, 'indéterminé')} · {resolved}/{stops.size} lieux
          résolus
        </span>
      </div>

      <h2>Plan</h2>
      {report.plan.days.map((day, index) => (
        <div key={day.id} className="day">
          <h3>
            Jour {index + 1}
            {day.date ? ` · ${day.date}` : ' · date inconnue'}
          </h3>
          <ol className="stops">
            {day.stops.map((stop) => (
              <StopItem
                key={stop.id}
                stop={stop}
                issues={issues.filter((issue) => issue.stopIds.includes(stop.id))}
                resolution={resolutionByStop.get(stop.id)}
              />
            ))}
          </ol>
        </div>
      ))}

      <h2>Problèmes ({issues.length})</h2>
      {issues.length === 0 ? (
        <p className="muted">Aucun problème détecté sur ce qui a pu être vérifié.</p>
      ) : (
        <ul className="issues">
          {issues.map((issue) => (
            <IssueItem key={issue.id} issue={issue} stops={stops} />
          ))}
        </ul>
      )}

      <h2>Indéterminés ({report.undetermined.length})</h2>
      {report.undetermined.length === 0 ? (
        <p className="muted">Tous les contrôles ont pu être tranchés.</p>
      ) : (
        <ul className="undetermined">
          {report.undetermined.map((entry, index) => (
            <UndeterminedItem key={index} entry={entry} stops={stops} />
          ))}
        </ul>
      )}
    </section>
  )
}
