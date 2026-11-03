import { describe, expect, it } from 'vitest'
import type { Issue, IssueCode, IssueSeverity, Plan, Stop } from '../plan'
import { SCHEMA_VERSION } from '../version'
import { RuleContractError, verifyPlan } from './engine'
import type { Rule, RuleFinding } from './rule'

function makeStop(id: string): Stop {
  return {
    id,
    name: id,
    sourceText: null,
    type: null,
    resolution: 'not_found',
    place: null,
    start: '10:00',
    end: '11:00',
    windowSource: 'explicit',
  }
}

const plan: Plan = {
  schemaVersion: SCHEMA_VERSION,
  cityId: 'test-city',
  days: [
    {
      id: 'day-1',
      date: '2026-11-03',
      timezone: 'Europe/Paris',
      stops: [makeStop('stop-1'), makeStop('stop-2')],
    },
  ],
  constraints: [],
}

function issue(code: IssueCode, stopId: string, severity: IssueSeverity = 'error'): RuleFinding {
  const built: Issue = {
    id: `${code}:${stopId}`,
    code,
    severity,
    message: `${code} sur ${stopId}`,
    stopIds: [stopId],
    evidence: [
      {
        source: 'fixture',
        sourceDate: null,
        retrievedAt: null,
        url: null,
        attribution: null,
        raw: '',
        fields: {},
      },
    ],
  }

  return { kind: 'issue', issue: built }
}

function pass(code: IssueCode, stopId: string): RuleFinding {
  return { kind: 'pass', code, stopIds: [stopId] }
}

function rule(id: string, codes: IssueCode[], findings: RuleFinding[], log?: string[]): Rule {
  return {
    id,
    codes,
    run() {
      log?.push(id)
      return findings
    },
  }
}

describe('verifyPlan', () => {
  it('exécute les règles dans l’ordre du registre', () => {
    const log: string[] = []

    verifyPlan(plan, [
      rule('premiere', ['place_not_operating'], [], log),
      rule('seconde', ['outside_opening_hours'], [], log),
    ])

    expect(log).toEqual(['premiere', 'seconde'])
  })

  it('propage une fermeture vers les contrôles horaires du même stop seulement', () => {
    const result = verifyPlan(plan, [
      rule('statut', ['place_not_operating'], [issue('place_not_operating', 'stop-1')]),
      rule(
        'horaires',
        ['outside_opening_hours'],
        [issue('outside_opening_hours', 'stop-1'), issue('outside_opening_hours', 'stop-2')],
      ),
    ])

    expect(result.issues.map((entry) => entry.id)).toEqual([
      'place_not_operating:stop-1',
      'outside_opening_hours:stop-2',
    ])
    expect(result.checks).toEqual([
      { code: 'place_not_operating', executed: 1, undetermined: 0, suppressed: 0 },
      { code: 'outside_opening_hours', executed: 1, undetermined: 0, suppressed: 1 },
    ])
  })

  it('ne propage pas vers un code non dominé', () => {
    const result = verifyPlan(plan, [
      rule('jour', ['place_closed_day'], [issue('place_closed_day', 'stop-1')]),
      rule('trajet', ['stop_overlap'], [issue('stop_overlap', 'stop-1')]),
    ])

    expect(result.issues.map((entry) => entry.code)).toEqual(['place_closed_day', 'stop_overlap'])
  })

  it('déduplique par identifiant et garde la sévérité la plus haute', () => {
    const result = verifyPlan(plan, [
      rule(
        'doublons',
        ['outside_opening_hours'],
        [
          issue('outside_opening_hours', 'stop-1', 'warning'),
          issue('outside_opening_hours', 'stop-1', 'error'),
        ],
      ),
    ])

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.severity).toBe('error')
    expect(result.checks[0]?.executed).toBe(2)
  })

  it('convertit une règle en échec en indéterminés par stop', () => {
    const failing: Rule = {
      id: 'en-echec',
      codes: ['stop_overlap'],
      run() {
        throw new Error('panne')
      },
    }

    const result = verifyPlan(plan, [failing])

    expect(result.status).toBe('indéterminé')
    expect(result.undetermined).toEqual([
      { codes: ['stop_overlap'], stopIds: ['stop-1'], reason: 'rule_error' },
      { codes: ['stop_overlap'], stopIds: ['stop-2'], reason: 'rule_error' },
    ])
    expect(result.checks).toEqual([
      { code: 'stop_overlap', executed: 2, undetermined: 2, suppressed: 0 },
    ])
  })

  it('refuse un code que la règle ne déclare pas', () => {
    expect(() =>
      verifyPlan(plan, [rule('menteuse', ['stop_overlap'], [issue('place_closed_day', 'stop-1')])]),
    ).toThrow(RuleContractError)
  })

  it('retire d’un indéterminé les codes dominés', () => {
    const result = verifyPlan(plan, [
      rule('jour', ['place_closed_day'], [issue('place_closed_day', 'stop-1')]),
      rule(
        'horaires',
        ['outside_opening_hours', 'after_last_entry', 'stop_overlap'],
        [
          {
            kind: 'undetermined',
            undetermined: {
              codes: ['outside_opening_hours', 'stop_overlap'],
              stopIds: ['stop-1'],
              reason: 'missing_hours',
            },
          },
        ],
      ),
    ])

    expect(result.undetermined).toEqual([
      { codes: ['stop_overlap'], stopIds: ['stop-1'], reason: 'missing_hours' },
    ])
    expect(result.checks.find((count) => count.code === 'outside_opening_hours')).toEqual({
      code: 'outside_opening_hours',
      executed: 0,
      undetermined: 0,
      suppressed: 1,
    })
    expect(result.checks.find((count) => count.code === 'after_last_entry')?.executed).toBe(0)
  })

  it('agrège le statut', () => {
    expect(verifyPlan(plan, [rule('vide', ['stop_overlap'], [])]).status).toBe('conforme')
    expect(
      verifyPlan(plan, [rule('ok', ['stop_overlap'], [pass('stop_overlap', 'stop-1')])]).status,
    ).toBe('conforme')
    expect(
      verifyPlan(plan, [rule('ko', ['stop_overlap'], [issue('stop_overlap', 'stop-1')])]).status,
    ).toBe('violation')
  })
})
