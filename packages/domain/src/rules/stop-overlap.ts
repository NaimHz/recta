import type { Rule, RuleFinding } from './rule'
import {
  issueFinding,
  passFinding,
  planEvidence,
  stopBounds,
  toMinutes,
  undeterminedFinding,
  writtenSeverity,
} from './support'

export const stopOverlap: Rule = {
  id: 'stop-overlap',
  codes: ['stop_overlap'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []
    const code = 'stop_overlap'

    for (const day of plan.days) {
      if (day.stops.length < 2) continue

      const bounded = day.stops.map((stop) => ({
        stop,
        bounds: stopBounds(day.date, stop, facts.city.timezone),
      }))

      for (const { stop, bounds } of bounded) {
        if (!bounds) findings.push(undeterminedFinding([code], [stop.id], 'time_unknown'))
      }

      for (let left = 0; left < bounded.length; left += 1) {
        for (let right = left + 1; right < bounded.length; right += 1) {
          const first = bounded[left]
          const second = bounded[right]

          if (!first?.bounds || !second?.bounds) continue

          const stopIds = [first.stop.id, second.stop.id]
          const overlapMs =
            Math.min(first.bounds.endMs, second.bounds.endMs) -
            Math.max(first.bounds.startMs, second.bounds.startMs)

          if (overlapMs <= 0) {
            findings.push(passFinding(code, stopIds))
            continue
          }

          const overlapMinutes = toMinutes(overlapMs)

          findings.push(
            issueFinding(
              code,
              writtenSeverity([first.stop, second.stop]),
              `${first.stop.name} (${first.stop.start}-${first.stop.end}) et ${second.stop.name} (${second.stop.start}-${second.stop.end}) se chevauchent de ${overlapMinutes} min.`,
              stopIds,
              [
                planEvidence(first.stop, { overlapMinutes }),
                planEvidence(second.stop, { overlapMinutes }),
              ],
            ),
          )
        }
      }
    }

    return findings
  },
}
