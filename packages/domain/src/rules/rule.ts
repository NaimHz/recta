import type { BusinessStatus } from '../curated-facts'
import type { Coordinates, EvidenceSource, Issue, IssueCode, Plan, Undetermined } from '../plan'

export type FactSource = {
  provider: EvidenceSource
  url: string | null
  sourceDate: string | null
  retrievedAt: string | null
}

export type PlaceFact =
  | { key: 'business_status'; value: BusinessStatus; source: FactSource }
  | { key: 'last_entry_before_close_minutes'; value: number; source: FactSource }

export type VerificationFacts = {
  city: {
    timezone: string
    countryCode: string
    holidayRegion: string
    center: Coordinates
  }
  placeFacts: Record<string, PlaceFact[]>
}

export type RuleContext = {
  plan: Plan
  facts: VerificationFacts
}

export type RuleFinding =
  | { kind: 'issue'; issue: Issue }
  | { kind: 'pass'; code: IssueCode; stopIds: string[] }
  | { kind: 'undetermined'; undetermined: Undetermined }

export type Rule = {
  id: string
  codes: readonly IssueCode[]
  run(context: RuleContext): RuleFinding[]
}
