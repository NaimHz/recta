import OpeningHours from 'opening_hours'
import { IsoDateSchema, LocalTimeSchema, type Coordinates, type VerificationStatus } from './plan'

/**
 * Le parseur `opening_hours` travaille avec les getters locaux de `Date`.
 * Pour éviter de dépendre du fuseau du serveur, les calculs sont faits dans
 * un mur d'horloge UTC : la date UTC représente l'heure locale de la ville.
 */
export type OpeningHoursContext = {
  timezone: string
  countryCode: string
  holidayRegion: string
  coordinates: Coordinates
}

export type LocalDateTime = {
  date: string
  time: string
}

export type OpeningHoursWindow = {
  date: string
  start: string
  end: string
}

export type OpeningHoursReason =
  | 'open'
  | 'closed'
  | 'closes_during_stop'
  | 'unknown'
  | 'missing_hours'
  | 'invalid_syntax'
  | 'invalid_timezone'
  | 'invalid_context'
  | 'invalid_local_time'

export type OpeningHoursCheck = {
  status: VerificationStatus
  reason: OpeningHoursReason
  local: LocalDateTime | null
  warnings: string[]
  holiday: boolean
}

type RuntimeProcess = {
  env?: Record<string, string | undefined>
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()
const formatterOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone)

  if (cached) return cached

  const formatter = new Intl.DateTimeFormat('en-CA', {
    ...formatterOptions,
    timeZone: timezone,
  })

  formatterCache.set(timezone, formatter)

  return formatter
}

function isValidTimezone(timezone: string): boolean {
  try {
    formatterFor(timezone)
    return true
  } catch {
    return false
  }
}

function isValidCoordinates(coordinates: Coordinates): boolean {
  return (
    Number.isFinite(coordinates.lat) &&
    Number.isFinite(coordinates.lon) &&
    coordinates.lat >= -90 &&
    coordinates.lat <= 90 &&
    coordinates.lon >= -180 &&
    coordinates.lon <= 180
  )
}

/**
 * Convertit un instant réel en date et heure locales de la ville.
 * Renvoie null si l'instant ou le fuseau est invalide.
 */
export function localDateTimeInTimezone(instant: Date, timezone: string): LocalDateTime | null {
  if (Number.isNaN(instant.getTime()) || !isValidTimezone(timezone)) {
    return null
  }

  try {
    const parts = formatterFor(timezone).formatToParts(instant)
    const values = new Map(parts.map((part) => [part.type, part.value]))
    const year = values.get('year')
    const month = values.get('month')
    const day = values.get('day')
    const hour = values.get('hour')
    const minute = values.get('minute')

    if (!year || !month || !day || !hour || !minute) {
      return null
    }

    const date = `${year}-${month}-${day}`
    const time = `${hour}:${minute}`

    if (!IsoDateSchema.safeParse(date).success || !LocalTimeSchema.safeParse(time).success) {
      return null
    }

    return { date, time }
  } catch {
    return null
  }
}

function wallClockDate(local: LocalDateTime): Date | null {
  if (
    !IsoDateSchema.safeParse(local.date).success ||
    !LocalTimeSchema.safeParse(local.time).success
  ) {
    return null
  }

  const [year, month, day] = local.date.split('-').map(Number)
  const [hour, minute] = local.time.split(':').map(Number)

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute))
}

function nextLocalDate(date: string): string | null {
  if (!IsoDateSchema.safeParse(date).success) {
    return null
  }

  const parsed = new Date(`${date}T00:00:00.000Z`)

  parsed.setUTCDate(parsed.getUTCDate() + 1)

  return parsed.toISOString().slice(0, 10)
}

/**
 * Vérifie qu'une heure locale existe réellement dans le fuseau.
 * Elle n'existe pas, par exemple, à 02:30 lors du passage à l'heure d'été.
 */
function localTimeExists(local: LocalDateTime, timezone: string): boolean {
  const wall = wallClockDate(local)

  if (!wall) {
    return false
  }

  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(wall.getTime() + offsetMinutes * 60_000)
    const candidateLocal = localDateTimeInTimezone(candidate, timezone)

    if (candidateLocal?.date === local.date && candidateLocal.time === local.time) {
      return true
    }
  }

  return false
}

/**
 * `opening_hours` lit les composantes locales de `Date`. On force
 * temporairement UTC pendant l'appel synchrone pour que les dates UTC
 * construites ci-dessus représentent bien le mur d'horloge voulu.
 */
function withUtcWallClock<T>(task: () => T): T {
  const runtimeProcess = (globalThis as typeof globalThis & { process?: RuntimeProcess }).process
  const env = runtimeProcess?.env

  if (!env) {
    return task()
  }

  const previousTimezone = env.TZ

  env.TZ = 'UTC'

  try {
    return task()
  } finally {
    if (previousTimezone === undefined) {
      delete env.TZ
    } else {
      env.TZ = previousTimezone
    }
  }
}

function nominatimObject(context: OpeningHoursContext) {
  return {
    lat: context.coordinates.lat,
    lon: context.coordinates.lon,
    address: {
      country_code: context.countryCode.toLowerCase(),
      state: context.holidayRegion,
    },
  }
}

function openingHoursFor(raw: string, context: OpeningHoursContext): OpeningHours {
  return new OpeningHours(raw, nominatimObject(context))
}

function result(
  status: VerificationStatus,
  reason: OpeningHoursReason,
  local: LocalDateTime | null,
  warnings: string[] = [],
  holiday = false,
): OpeningHoursCheck {
  return { status, reason, local, warnings, holiday }
}

function invalidContextResult(context: OpeningHoursContext): OpeningHoursCheck | null {
  if (!isValidTimezone(context.timezone)) {
    return result('indéterminé', 'invalid_timezone', null)
  }

  if (!isValidCoordinates(context.coordinates)) {
    return result('indéterminé', 'invalid_context', null)
  }

  return null
}

/**
 * Vérifie un lieu à un instant précis, en tenant compte du fuseau de la ville,
 * des jours fériés et des changements d'heure.
 */
export function checkOpeningHoursAt(
  raw: string | null | undefined,
  context: OpeningHoursContext,
  instant: Date,
): OpeningHoursCheck {
  const contextError = invalidContextResult(context)

  if (contextError) return contextError

  const local = localDateTimeInTimezone(instant, context.timezone)

  if (!local) {
    return result('indéterminé', 'invalid_local_time', null)
  }

  if (!raw || raw.trim() === '') {
    return result('indéterminé', 'missing_hours', local)
  }

  const wall = wallClockDate(local)

  if (!wall) {
    return result('indéterminé', 'invalid_local_time', local)
  }

  try {
    return withUtcWallClock(() => {
      const schedule = openingHoursFor(raw.trim(), context)
      const warnings = schedule.getWarnings()
      const holiday = schedule.getPublicHolidayContext(wall).isHoliday
      const state = schedule.getStateString(wall)
      const unknown = schedule.getUnknown(wall)

      if (unknown || state === 'unknown') {
        return result('indéterminé', 'unknown', local, warnings, holiday)
      }

      if (state === 'open') {
        return result('conforme', 'open', local, warnings, holiday)
      }

      return result('violation', 'closed', local, warnings, holiday)
    })
  } catch {
    return result('indéterminé', 'invalid_syntax', local)
  }
}

/**
 * Vérifie qu'un stop tient dans une plage d'ouverture. La fenêtre est exprimée
 * en heure locale. Une fin antérieure au début est interprétée comme le
 * lendemain (passage de minuit).
 */
export function checkOpeningHoursWindow(
  raw: string | null | undefined,
  context: OpeningHoursContext,
  window: OpeningHoursWindow,
): OpeningHoursCheck {
  const contextError = invalidContextResult(context)

  if (contextError) return contextError

  const start: LocalDateTime = { date: window.date, time: window.start }
  let end: LocalDateTime = { date: window.date, time: window.end }

  if (!wallClockDate(start) || !wallClockDate(end) || window.start === window.end) {
    return result('indéterminé', 'invalid_local_time', start)
  }

  if (window.end < window.start) {
    const endDate = nextLocalDate(window.date)

    if (!endDate) {
      return result('indéterminé', 'invalid_local_time', start)
    }

    end = { date: endDate, time: window.end }
  }

  if (!localTimeExists(start, context.timezone) || !localTimeExists(end, context.timezone)) {
    return result('indéterminé', 'invalid_local_time', start)
  }

  if (!raw || raw.trim() === '') {
    return result('indéterminé', 'missing_hours', start)
  }

  const startWall = wallClockDate(start)
  const endWall = wallClockDate(end)

  if (!startWall || !endWall) {
    return result('indéterminé', 'invalid_local_time', start)
  }

  try {
    return withUtcWallClock(() => {
      const schedule = openingHoursFor(raw.trim(), context)
      const warnings = schedule.getWarnings()
      const holiday = schedule.getPublicHolidayContext(startWall).isHoliday
      const state = schedule.getStateString(startWall)
      const unknown = schedule.getUnknown(startWall)

      if (unknown || state === 'unknown') {
        return result('indéterminé', 'unknown', start, warnings, holiday)
      }

      if (state === 'close') {
        return result('violation', 'closed', start, warnings, holiday)
      }

      const intervals = schedule.getOpenIntervals(startWall, endWall)
      let unknownInterval = false
      let covered = false

      for (const [from, to, isUnknown] of intervals) {
        if (to.getTime() <= startWall.getTime() || from.getTime() >= endWall.getTime()) {
          continue
        }

        if (isUnknown) {
          unknownInterval = true
          continue
        }

        if (from.getTime() <= startWall.getTime() && to.getTime() >= endWall.getTime()) {
          covered = true
        }
      }

      if (unknownInterval || intervals.length === 0) {
        return result('indéterminé', 'unknown', start, warnings, holiday)
      }

      if (covered) {
        return result('conforme', 'open', start, warnings, holiday)
      }

      return result('violation', 'closes_during_stop', start, warnings, holiday)
    })
  } catch {
    return result('indéterminé', 'invalid_syntax', start)
  }
}
