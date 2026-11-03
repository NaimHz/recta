import { dayClosure } from './day-closure'
import { dayLoad } from './day-load'
import { fragmentedHalfDay } from './fragmented-half-day'
import { lastDeparture } from './last-departure'
import { lastEntry } from './last-entry'
import { openingWindow } from './opening-window'
import { placeStatus } from './place-status'
import type { Rule } from './rule'
import { stopOverlap } from './stop-overlap'
import { travelTime } from './travel-time'

export const RULES: readonly Rule[] = [
  placeStatus,
  dayClosure,
  openingWindow,
  lastEntry,
  stopOverlap,
  travelTime,
  fragmentedHalfDay,
  dayLoad,
  lastDeparture,
]
