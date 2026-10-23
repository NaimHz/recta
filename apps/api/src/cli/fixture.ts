import {
  DAY_CODES,
  PlanSchema,
  SCHEMA_VERSION,
  type DayCode,
  type OpeningHours,
  type Plan,
  type Stop,
} from '@recta/domain'

const DAY_CODE_SET = new Set<string>(DAY_CODES)
const TIME_RANGE = /^((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)$/

export class FixtureParseError extends Error {
  constructor(
    readonly lineNumber: number,
    message: string,
  ) {
    super(lineNumber > 0 ? `Ligne ${lineNumber} : ${message}` : message)
    this.name = 'FixtureParseError'
  }
}

function parseTimeRange(value: string, lineNumber: number): { start: string; end: string } {
  const match = TIME_RANGE.exec(value)

  if (!match?.[1] || !match[2]) {
    throw new FixtureParseError(lineNumber, `plage horaire invalide « ${value} »`)
  }

  return { start: match[1], end: match[2] }
}

function parseClosedDays(value: string, lineNumber: number): DayCode[] {
  if (value === '-') return []

  return value.split(',').map((rawDay) => {
    const day = rawDay.trim()

    if (!DAY_CODE_SET.has(day)) {
      throw new FixtureParseError(lineNumber, `jour de fermeture inconnu « ${day} »`)
    }

    return day as DayCode
  })
}

function parseStopLine(line: string, lineNumber: number, index: number, sourceDate: string): Stop {
  const parts = line.split('|').map((part) => part.trim())

  if (parts.length !== 4) {
    throw new FixtureParseError(
      lineNumber,
      'un stop attendu sous la forme « début-fin | lieu | ouverture-fermeture | jours fermés »',
    )
  }

  const [range, name, hoursRange, closedRaw] = parts

  if (!range || !name || !hoursRange || !closedRaw) {
    throw new FixtureParseError(lineNumber, 'un champ du stop est vide')
  }

  const { start, end } = parseTimeRange(range, lineNumber)
  const closedOn = parseClosedDays(closedRaw, lineNumber)

  let openingHours: OpeningHours | null = null

  if (hoursRange !== '-') {
    const hours = parseTimeRange(hoursRange, lineNumber)

    openingHours = {
      opensAt: hours.start,
      closesAt: hours.end,
      closedOn,
      raw: closedRaw === '-' ? hoursRange : `${hoursRange}; fermé ${closedRaw}`,
    }
  }

  return {
    id: `stop-${index + 1}`,
    place: {
      id: `place-${index + 1}`,
      name,
      coordinates: null,
      address: null,
      category: null,
      openingHoursRaw: hoursRange === '-' ? null : hoursRange,
      openingHours,
      source: {
        provider: 'fixture',
        sourceDate,
        retrievedAt: null,
      },
    },
    start,
    end,
  }
}

/**
 * Format 1.7, volontairement pauvre : les données sont en dur, sans LLM ni OSM.
 * Les deux premières lignes donnent la date et le fuseau ; chaque ligne suivante est un stop.
 */
export function parseFixture(text: string): Plan {
  let date: string | null = null
  let timezone: string | null = null
  const rawStops: Array<{ line: string; lineNumber: number; index: number }> = []

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()

    if (!line || line.startsWith('#')) return

    const lineNumber = index + 1

    if (line.startsWith('day:')) {
      date = line.slice('day:'.length).trim()
      return
    }

    if (line.startsWith('timezone:')) {
      timezone = line.slice('timezone:'.length).trim()
      return
    }

    rawStops.push({ line, lineNumber, index: rawStops.length })
  })

  if (!date) throw new FixtureParseError(0, 'ligne « day: YYYY-MM-DD » manquante')
  if (!timezone) throw new FixtureParseError(0, 'ligne « timezone: … » manquante')

  const dayDate = date
  const stops = rawStops.map(({ line, lineNumber, index }) =>
    parseStopLine(line, lineNumber, index, dayDate),
  )

  if (stops.length !== 3) {
    throw new FixtureParseError(0, `3 stops attendus, ${stops.length} trouvés`)
  }

  return PlanSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    days: [{ date: dayDate, timezone, stops }],
  })
}
