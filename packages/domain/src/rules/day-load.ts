import type { Rule, RuleFinding } from './rule'
import {
  issueFinding,
  passFinding,
  planEvidence,
  stopBounds,
  toMinutes,
  undeterminedFinding,
} from './support'

export const OVERLOAD_AMPLITUDE_MINUTES = 13 * 60

export const dayLoad: Rule = {
  id: 'day-load',
  codes: ['overloaded_day'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []
    const code = 'overloaded_day'

    for (const day of plan.days) {
      const stopIds = day.stops.map((stop) => stop.id)
      const bounded = day.stops.flatMap((stop) => {
        const bounds = stopBounds(day.date, stop, facts.city.timezone)

        return bounds ? [{ stop, bounds }] : []
      })
      const first = [...bounded].sort(
        (left, right) => left.bounds.startMs - right.bounds.startMs,
      )[0]
      const last = [...bounded].sort((left, right) => right.bounds.endMs - left.bounds.endMs)[0]

      if (!first || !last) {
        if (stopIds.length > 0) findings.push(undeterminedFinding([code], stopIds, 'time_unknown'))
        continue
      }

      const amplitudeMinutes = toMinutes(last.bounds.endMs - first.bounds.startMs)

      if (amplitudeMinutes > OVERLOAD_AMPLITUDE_MINUTES) {
        const fields = {
          firstStart: first.stop.start,
          lastEnd: last.stop.end,
          amplitudeMinutes,
          thresholdMinutes: OVERLOAD_AMPLITUDE_MINUTES,
          stopCount: day.stops.length,
        }

        findings.push(
          issueFinding(
            code,
            'warning',
            `Journée de ${Math.floor(amplitudeMinutes / 60)} h ${String(amplitudeMinutes % 60).padStart(2, '0')}, de ${first.stop.start} à ${last.stop.end}, au-delà de ${OVERLOAD_AMPLITUDE_MINUTES / 60} h.`,
            stopIds,
            [planEvidence(first.stop, fields), planEvidence(last.stop, fields)],
          ),
        )
        continue
      }

      findings.push(
        bounded.length < day.stops.length
          ? undeterminedFinding([code], stopIds, 'time_unknown')
          : passFinding(code, stopIds),
      )
    }

    return findings
  },
}
