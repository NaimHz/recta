import type {
  CheckCount,
  Issue,
  IssueCode,
  IssueSeverity,
  Plan,
  Undetermined,
  VerificationResult,
} from '../plan'
import { ISSUE_CODES } from '../plan'
import { SCHEMA_VERSION } from '../version'
import { RULES } from './registry'
import type { Rule, RuleFinding, VerificationFacts } from './rule'

export const SUPERSEDES: Partial<Record<IssueCode, readonly IssueCode[]>> = {
  place_not_operating: [
    'place_closed_day',
    'holiday_closure',
    'outside_opening_hours',
    'after_last_entry',
  ],
  place_closed_day: ['outside_opening_hours', 'after_last_entry'],
  holiday_closure: ['outside_opening_hours', 'after_last_entry'],
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { info: 0, warning: 1, error: 2 }

export class RuleContractError extends Error {
  constructor(ruleId: string, code: IssueCode) {
    super(`La règle ${ruleId} a produit le code ${code}, qu'elle ne déclare pas.`)
    this.name = 'RuleContractError'
  }
}

function findingCodes(finding: RuleFinding): IssueCode[] {
  if (finding.kind === 'issue') return [finding.issue.code]
  if (finding.kind === 'pass') return [finding.code]

  return finding.undetermined.codes
}

function findingStopIds(finding: RuleFinding): string[] {
  if (finding.kind === 'issue') return finding.issue.stopIds
  if (finding.kind === 'pass') return finding.stopIds

  return finding.undetermined.stopIds
}

function allStopIds(plan: Plan): string[] {
  return plan.days.flatMap((day) => day.stops.map((stop) => stop.id))
}

export function verifyPlan(
  plan: Plan,
  facts: VerificationFacts,
  rules: readonly Rule[] = RULES,
): VerificationResult {
  const issues = new Map<string, Issue>()
  const undetermined: Undetermined[] = []
  const counts = new Map<IssueCode, CheckCount>()
  const dominatedByStop = new Map<string, Set<IssueCode>>()

  const counter = (code: IssueCode): CheckCount => {
    let count = counts.get(code)

    if (!count) {
      count = { code, executed: 0, undetermined: 0, suppressed: 0 }
      counts.set(code, count)
    }

    return count
  }

  const isSuppressed = (code: IssueCode, stopIds: string[]): boolean =>
    stopIds.some((stopId) => dominatedByStop.get(stopId)?.has(code))

  for (const rule of rules) {
    for (const code of rule.codes) counter(code)

    let findings: RuleFinding[]

    try {
      findings = rule.run({ plan, facts })
    } catch {
      findings = allStopIds(plan).map((stopId) => ({
        kind: 'undetermined',
        undetermined: { codes: [...rule.codes], stopIds: [stopId], reason: 'rule_error' },
      }))
    }

    for (const finding of findings) {
      const codes = findingCodes(finding)

      for (const code of codes) {
        if (!rule.codes.includes(code)) throw new RuleContractError(rule.id, code)
      }

      const stopIds = findingStopIds(finding)
      const activeCodes = codes.filter((code) => !isSuppressed(code, stopIds))

      for (const code of codes) {
        if (!activeCodes.includes(code)) counter(code).suppressed += 1
      }

      if (activeCodes.length === 0) continue

      for (const code of activeCodes) counter(code).executed += 1

      if (finding.kind === 'undetermined') {
        for (const code of activeCodes) counter(code).undetermined += 1
        undetermined.push({ ...finding.undetermined, codes: activeCodes })
        continue
      }

      if (finding.kind === 'pass') continue

      const existing = issues.get(finding.issue.id)

      if (existing) {
        if (SEVERITY_RANK[finding.issue.severity] > SEVERITY_RANK[existing.severity]) {
          existing.severity = finding.issue.severity
        }
        continue
      }

      issues.set(finding.issue.id, { ...finding.issue })

      const dominated = SUPERSEDES[finding.issue.code] ?? []

      for (const stopId of finding.issue.stopIds) {
        const set = dominatedByStop.get(stopId) ?? new Set<IssueCode>()

        for (const code of dominated) set.add(code)
        dominatedByStop.set(stopId, set)
      }
    }
  }

  const issueList = [...issues.values()]
  const status =
    issueList.length > 0 ? 'violation' : undetermined.length > 0 ? 'indéterminé' : 'conforme'

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    plan,
    issues: issueList,
    undetermined,
    checks: ISSUE_CODES.flatMap((code) => {
      const count = counts.get(code)

      return count ? [count] : []
    }),
  }
}
