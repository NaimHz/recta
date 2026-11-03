import type { Issue, IssueCode, Plan, Undetermined } from '../plan'

export type RuleContext = {
  plan: Plan
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
