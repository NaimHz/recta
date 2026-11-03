import type { Rule, RuleFinding } from './rule'
import { issueFinding, passFinding, stopBounds, undeterminedFinding } from './support'

export const FRAGMENT_WINDOW_MINUTES = 240
export const FRAGMENT_OUT_METERS = 2_000
export const FRAGMENT_BACK_METERS = 500

export const fragmentedHalfDay: Rule = {
  id: 'fragmented-half-day',
  codes: ['fragmented_half_day'],
  run({ plan, facts }) {
    const findings: RuleFinding[] = []
    const code = 'fragmented_half_day'

    for (const day of plan.days) {
      const located = day.stops.filter((stop) => stop.place?.coordinates)

      if (located.length < 3) continue

      const matrix = facts.travel.walk.find((entry) => entry.dayId === day.id)

      if (!matrix) {
        findings.push(
          undeterminedFinding(
            [code],
            located.map((stop) => stop.id),
            'transit_unavailable',
          ),
        )
        continue
      }

      const distance = (fromId: string, toId: string): number | null =>
        matrix.distancesMeters[matrix.stopIds.indexOf(fromId)]?.[matrix.stopIds.indexOf(toId)] ??
        null

      for (let first = 0; first < located.length; first += 1) {
        for (let last = first + 2; last < located.length; last += 1) {
          const start = located[first]
          const end = located[last]

          if (!start || !end) continue

          const startBounds = stopBounds(day.date, start, facts.city.timezone)
          const endBounds = stopBounds(day.date, end, facts.city.timezone)

          if (!startBounds || !endBounds) continue
          if (endBounds.startMs - startBounds.endMs > FRAGMENT_WINDOW_MINUTES * 60_000) continue

          const back = distance(start.id, end.id)

          if (back === null) continue

          const detour = located
            .slice(first + 1, last)
            .map((middle) => ({ middle, out: distance(start.id, middle.id) }))
            .filter((entry): entry is { middle: typeof start; out: number } => entry.out !== null)
            .sort((left, right) => right.out - left.out)[0]

          if (!detour || back > FRAGMENT_BACK_METERS || detour.out < FRAGMENT_OUT_METERS) {
            findings.push(passFinding(code, [start.id, end.id]))
            continue
          }

          findings.push(
            issueFinding(
              code,
              'warning',
              `${start.name} → ${detour.middle.name} → ${end.name} : ${Math.round(detour.out)} m à l'aller, puis retour à ${Math.round(back)} m du point de départ en moins de ${FRAGMENT_WINDOW_MINUTES / 60} h.`,
              [start.id, detour.middle.id, end.id],
              [
                {
                  ...matrix.evidence,
                  fields: {
                    ...matrix.evidence.fields,
                    distanceOutMeters: detour.out,
                    distanceBackMeters: back,
                    thresholds: {
                      windowMinutes: FRAGMENT_WINDOW_MINUTES,
                      outMeters: FRAGMENT_OUT_METERS,
                      backMeters: FRAGMENT_BACK_METERS,
                    },
                  },
                },
              ],
            ),
          )
        }
      }
    }

    return findings
  },
}
