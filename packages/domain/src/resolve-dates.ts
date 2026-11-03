import { IsoDateSchema } from './plan'
import { addDays } from './rules/support'

export type ResolveDayDatesOptions = {
  reference: string
  start: string | null
}

type ParsedDate = {
  weekday: number | null
  day: number | null
  month: number | null
  year: number | null
  dayNumber: number | null
}

const WEEKDAYS = new Map<string, number>([
  ['dimanche', 0],
  ['dim', 0],
  ['sunday', 0],
  ['sun', 0],
  ['lundi', 1],
  ['lun', 1],
  ['monday', 1],
  ['mon', 1],
  ['mardi', 2],
  ['mar', 2],
  ['tuesday', 2],
  ['tue', 2],
  ['mercredi', 3],
  ['mer', 3],
  ['wednesday', 3],
  ['wed', 3],
  ['jeudi', 4],
  ['jeu', 4],
  ['thursday', 4],
  ['thu', 4],
  ['vendredi', 5],
  ['ven', 5],
  ['friday', 5],
  ['fri', 5],
  ['samedi', 6],
  ['sam', 6],
  ['saturday', 6],
  ['sat', 6],
])

const MONTHS = new Map<string, number>([
  ['janvier', 1],
  ['january', 1],
  ['fevrier', 2],
  ['february', 2],
  ['mars', 3],
  ['march', 3],
  ['avril', 4],
  ['april', 4],
  ['mai', 5],
  ['may', 5],
  ['juin', 6],
  ['june', 6],
  ['juillet', 7],
  ['july', 7],
  ['aout', 8],
  ['august', 8],
  ['septembre', 9],
  ['september', 9],
  ['octobre', 10],
  ['october', 10],
  ['novembre', 11],
  ['november', 11],
  ['decembre', 12],
  ['december', 12],
])

const FILLERS = new Set(['le', 'la', 'on', 'the', 'of'])
const DAY_NUMBER_WORDS = new Set(['jour', 'day'])

function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !FILLERS.has(token))
}

function parseDateText(text: string): ParsedDate | null {
  const parsed: ParsedDate = { weekday: null, day: null, month: null, year: null, dayNumber: null }
  const tokens = tokenize(text)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    const weekday = WEEKDAYS.get(token)
    const month = MONTHS.get(token)
    const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(token)
    const ordinal = /^(\d{1,2})(?:er|st|nd|rd|th)?$/.exec(token)

    if (weekday !== undefined && parsed.weekday === null) {
      parsed.weekday = weekday
    } else if (month !== undefined && parsed.month === null) {
      parsed.month = month
    } else if (numeric && parsed.day === null && parsed.month === null) {
      parsed.day = Number(numeric[1])
      parsed.month = Number(numeric[2])
      parsed.year = numeric[3] ? Number(numeric[3]) : null
    } else if (DAY_NUMBER_WORDS.has(token) && /^\d{1,2}$/.test(tokens[index + 1] ?? '')) {
      parsed.dayNumber = Number(tokens[index + 1])
      index += 1
    } else if (/^\d{4}$/.test(token) && parsed.year === null) {
      parsed.year = Number(token)
    } else if (ordinal && parsed.day === null) {
      parsed.day = Number(ordinal[1])
    } else {
      return null
    }
  }

  return parsed
}

function isoDate(year: number, month: number, day: number): string | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return IsoDateSchema.safeParse(value).success ? value : null
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

function calendarDate(parsed: ParsedDate, reference: string): string | null {
  if (parsed.day === null || parsed.month === null) return null

  const { day, month } = parsed

  if (parsed.year !== null) return isoDate(parsed.year, month, day)

  const year = Number(reference.slice(0, 4))
  const candidates = [isoDate(year, month, day), isoDate(year + 1, month, day)]

  return candidates.find((candidate) => candidate !== null && candidate >= reference) ?? null
}

export function resolveDayDates(
  dateTexts: (string | null)[],
  options: ResolveDayDatesOptions,
): (string | null)[] {
  const resolved: (string | null)[] = []

  dateTexts.forEach((text, index) => {
    const previous = index === 0 ? null : (resolved[index - 1] ?? null)
    const anchor = index === 0 ? options.start : previous === null ? null : addDays(previous, 1)
    const parsed = text === null ? null : parseDateText(text)
    let date: string | null = null

    if (parsed?.dayNumber != null) {
      date =
        options.start === null || parsed.dayNumber < 1
          ? null
          : addDays(options.start, parsed.dayNumber - 1)
    } else if (parsed && parsed.month !== null) {
      date = calendarDate(parsed, options.reference)

      if (date !== null && parsed.weekday !== null && weekdayOf(date) !== parsed.weekday) {
        date = null
      }
    } else if (parsed && parsed.weekday !== null && parsed.day === null && anchor !== null) {
      date = addDays(anchor, (parsed.weekday - weekdayOf(anchor) + 7) % 7)
    }

    resolved.push(date)
  })

  return resolved
}
