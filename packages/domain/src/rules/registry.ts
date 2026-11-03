import { dayClosure } from './day-closure'
import { lastEntry } from './last-entry'
import { openingWindow } from './opening-window'
import { placeStatus } from './place-status'
import type { Rule } from './rule'

export const RULES: readonly Rule[] = [placeStatus, dayClosure, openingWindow, lastEntry]
