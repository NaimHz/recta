import type { DayCode } from './plan'

const JS_DAY_TO_CODE: readonly DayCode[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function dayCodeForDate(date: string): DayCode {
  const jsDay = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const code = JS_DAY_TO_CODE[jsDay]

  if (!code) {
    throw new Error(`Jour invalide pour la date ${date}`)
  }

  return code
}
