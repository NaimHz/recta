import { describe, expect, it } from 'vitest'
import type { IssueCode, IssueSeverity, StopWindowSource, VerificationStatus } from '../plan'
import {
  LYON_FACTS,
  PARIS_FACTS,
  curatedSource,
  osmPlace,
  planOn,
  stopAt,
  withPlaceFacts,
} from './__fixtures__/plans'
import { verifyPlan } from './engine'
import type { VerificationFacts } from './rule'

type HoursCase = {
  label: string
  facts: VerificationFacts
  date: string | null
  place: { name: string; raw: string | null; id?: string }
  start: string | null
  end: string | null
  windowSource?: StopWindowSource
  expected: { status: VerificationStatus; issues: Array<[IssueCode, IssueSeverity]> }
}

const ARMEE =
  'Nov-Mar: Mo-Su 10:00-17:00; Apr-Oct: Mo-Su 10:00-18:00; Apr-Sep: Tu 21:00+; Jan 1 off; May 1 off; Dec 25 off'
const LOUVRE_ID = 'osm:relation/7515426'
const LOUVRE_HOURS = 'Mo,Th,Sa,Su 09:00-18:00; We,Fr 09:00-21:00; Tu off'
const POMPIDOU_ID = 'osm:way/55503397'
const IMPRIMERIE_ID = 'osm:way/62271798'

const parisWithFacts = withPlaceFacts(
  withPlaceFacts(PARIS_FACTS, LOUVRE_ID, [
    {
      key: 'last_entry_before_close_minutes',
      value: 60,
      source: curatedSource('https://www.louvre.fr/en/visit'),
    },
  ]),
  POMPIDOU_ID,
  [
    {
      key: 'business_status',
      value: 'closed_temporarily',
      source: curatedSource(
        'https://www.centrepompidou.fr/en/centre-pompidou-is-transforming-itself',
      ),
    },
  ],
)
const lyonWithFacts = withPlaceFacts(LYON_FACTS, IMPRIMERIE_ID, [
  {
    key: 'business_status',
    value: 'closed_temporarily',
    source: curatedSource('https://www.imprimerie.lyon.fr/fr/edito/travaux'),
  },
])

const violation = (...issues: Array<[IssueCode, IssueSeverity]>) => ({
  status: 'violation' as const,
  issues,
})
const undetermined = { status: 'indéterminé' as const, issues: [] }

const CASES: HoursCase[] = [
  {
    label: 'jour fermé : musée ouvert du mardi au samedi, un lundi',
    facts: LYON_FACTS,
    date: '2026-11-02',
    place: { name: 'Cité musée Tony Garnier', raw: 'Tu-Sa 14:00-18:00' },
    start: '15:00',
    end: '16:00',
    expected: violation(['place_closed_day', 'error']),
  },
  {
    label: 'jour fermé : restaurant de semaine, un samedi',
    facts: PARIS_FACTS,
    date: '2026-11-07',
    place: { name: 'Le Severo', raw: 'Mo-Fr 12:00-14:00,19:30-21:30' },
    start: '12:30',
    end: '13:30',
    expected: violation(['place_closed_day', 'error']),
  },
  {
    label: 'jour fermé : restaurant fermé le dimanche',
    facts: LYON_FACTS,
    date: '2026-11-08',
    place: { name: 'Maison Villemanzy', raw: 'Mo-Sa 12:00-13:30, 19:30-21:30' },
    start: '12:00',
    end: '13:00',
    expected: violation(['place_closed_day', 'error']),
  },
  {
    label: 'jour fermé : restaurant sans plage le lundi',
    facts: LYON_FACTS,
    date: '2026-11-02',
    place: {
      name: "Le Lyon de l'Atlas",
      raw: 'Fr-Sa 12:00-14:00,19:00-21:30; Tu-Th 12:00-14:00,19:00-21:00',
    },
    start: '12:30',
    end: '13:30',
    expected: violation(['place_closed_day', 'error']),
  },
  {
    label: 'férié : 1er mai au musée de l’Armée',
    facts: PARIS_FACTS,
    date: '2027-05-01',
    place: { name: "Musée de l'Armée", raw: ARMEE },
    start: '11:00',
    end: '12:00',
    expected: violation(['holiday_closure', 'error']),
  },
  {
    label: 'férié : 25 décembre au musée de l’Armée',
    facts: PARIS_FACTS,
    date: '2027-12-25',
    place: { name: "Musée de l'Armée", raw: ARMEE },
    start: '11:00',
    end: '12:00',
    expected: violation(['holiday_closure', 'error']),
  },
  {
    label: 'férié sans effet : lundi de Pâques dans un musée fermé le lundi',
    facts: PARIS_FACTS,
    date: '2027-03-29',
    place: {
      name: 'Musée des Arts et Métiers',
      raw: 'Tu-Th 10:00-18:00; Fr 10:00-21:00; Sa-Su 10:00-18:00',
    },
    start: '10:30',
    end: '11:30',
    expected: violation(['place_closed_day', 'error']),
  },
  {
    label: 'hors plage : arrivée pendant la fermeture de l’après-midi',
    facts: PARIS_FACTS,
    date: '2026-11-03',
    place: { name: 'Le Severo', raw: 'Mo-Fr 12:00-14:00,19:30-21:30' },
    start: '14:30',
    end: '15:30',
    expected: violation(['outside_opening_hours', 'error']),
  },
  {
    label: 'hors plage : déjeuner qui déborde sur la fermeture',
    facts: PARIS_FACTS,
    date: '2026-11-03',
    place: { name: 'Le Severo', raw: 'Mo-Fr 12:00-14:00,19:30-21:30' },
    start: '13:30',
    end: '14:30',
    expected: violation(['outside_opening_hours', 'error']),
  },
  {
    label: 'hors plage : pause déjeuner courte',
    facts: LYON_FACTS,
    date: '2026-11-03',
    place: { name: "L'Auberge", raw: 'Tu-Sa 12:00-13:30,19:00-21:30' },
    start: '13:00',
    end: '14:00',
    expected: violation(['outside_opening_hours', 'error']),
  },
  {
    label: 'hors plage : soirée après minuit dans un café fermant à minuit',
    facts: LYON_FACTS,
    date: '2026-11-03',
    place: { name: 'Coolé', raw: 'Mo-Sa 10:00-00:00; Su 10:00-21:00' },
    start: '22:00',
    end: '01:00',
    expected: violation(['outside_opening_hours', 'error']),
  },
  {
    label: 'hors plage : fermeture à 24:00 dépassée',
    facts: LYON_FACTS,
    date: '2026-11-03',
    place: { name: 'Le Bistro Autrement', raw: 'Mo-Sa,PH 07:00-24:00, Su 08:00-24:00' },
    start: '23:30',
    end: '00:30',
    expected: violation(['outside_opening_hours', 'error']),
  },
  {
    label: 'statut : Centre Pompidou fermé, les contrôles horaires sont dominés',
    facts: parisWithFacts,
    date: '2026-11-04',
    place: { name: 'Centre Pompidou', raw: 'We-Mo 11:00-21:00', id: POMPIDOU_ID },
    start: '08:00',
    end: '10:00',
    expected: violation(['place_not_operating', 'error']),
  },
  {
    label: 'statut : musée de l’Imprimerie fermé, sans horaires OSM',
    facts: lyonWithFacts,
    date: '2026-11-04',
    place: { name: "Musée de l'Imprimerie", raw: null, id: IMPRIMERIE_ID },
    start: '14:00',
    end: '15:00',
    expected: violation(['place_not_operating', 'error']),
  },
  {
    label: 'dernière entrée : arrivée au Louvre après 17:00 un lundi',
    facts: parisWithFacts,
    date: '2026-11-02',
    place: { name: 'Musée du Louvre', raw: LOUVRE_HOURS, id: LOUVRE_ID },
    start: '17:15',
    end: '18:00',
    expected: violation(['after_last_entry', 'error']),
  },
  {
    label: 'dernière entrée : nocturne du mercredi respectée',
    facts: parisWithFacts,
    date: '2026-11-04',
    place: { name: 'Musée du Louvre', raw: LOUVRE_HOURS, id: LOUVRE_ID },
    start: '19:30',
    end: '20:30',
    expected: { status: 'conforme', issues: [] },
  },
  {
    label: 'indéterminé : syntaxe d’horaires invalide',
    facts: PARIS_FACTS,
    date: '2026-11-03',
    place: { name: 'Lieu', raw: 'ouvert en semaine' },
    start: '10:00',
    end: '11:00',
    expected: undetermined,
  },
  {
    label: 'indéterminé : horaires absents d’OSM',
    facts: LYON_FACTS,
    date: '2026-11-03',
    place: { name: 'Comptoir des Marronniers', raw: null },
    start: '12:00',
    end: '13:30',
    expected: undetermined,
  },
  {
    label: 'indéterminé : jour sans date',
    facts: PARIS_FACTS,
    date: null,
    place: { name: 'Le Severo', raw: 'Mo-Fr 12:00-14:00,19:30-21:30' },
    start: '14:30',
    end: '15:30',
    expected: undetermined,
  },
  {
    label: 'indéterminé : heure inexistante au passage à l’heure d’été',
    facts: PARIS_FACTS,
    date: '2027-03-28',
    place: { name: 'Les Arts et Métiers', raw: 'Mo-Su 07:00-02:00' },
    start: '02:30',
    end: '03:30',
    expected: undetermined,
  },
]

function run(testCase: HoursCase) {
  const place = osmPlace(testCase.place.name, testCase.place.raw, testCase.place.id)
  const stop = stopAt(place, testCase.start, testCase.end, testCase.windowSource)

  return verifyPlan(planOn(testCase.date, stop), testCase.facts)
}

describe('règles horaires : 20 cas', () => {
  it('compte 20 cas, dont 4 indéterminés', () => {
    expect(CASES).toHaveLength(20)
    expect(CASES.filter((testCase) => testCase.expected.status === 'indéterminé')).toHaveLength(4)
  })

  it.each(CASES)('$label', (testCase) => {
    const result = run(testCase)

    expect(result.status).toBe(testCase.expected.status)
    expect(result.issues.map((issue) => [issue.code, issue.severity])).toEqual(
      testCase.expected.issues,
    )

    for (const issue of result.issues) {
      expect(issue.evidence.length).toBeGreaterThan(0)
    }
  })

  it('ne produit aucun faux positif sur les cas indéterminés', () => {
    const falsePositives = CASES.filter(
      (testCase) => testCase.expected.status === 'indéterminé',
    ).flatMap((testCase) => run(testCase).issues)

    expect(falsePositives).toEqual([])
  })
})
