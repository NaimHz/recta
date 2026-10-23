import { describe, expect, it } from 'vitest'
import {
  checkOpeningHoursAt,
  checkOpeningHoursWindow,
  localDateTimeInTimezone,
  type OpeningHoursContext,
  type OpeningHoursReason,
} from './opening-hours-engine'
import type { VerificationStatus } from './plan'

const PARIS: OpeningHoursContext = {
  timezone: 'Europe/Paris',
  countryCode: 'FR',
  holidayRegion: 'Île-de-France',
  coordinates: { lat: 48.8566, lon: 2.3522 },
}

const LYON: OpeningHoursContext = {
  timezone: 'Europe/Paris',
  countryCode: 'FR',
  holidayRegion: 'Auvergne-Rhône-Alpes',
  coordinates: { lat: 45.764, lon: 4.8357 },
}

const UTC: OpeningHoursContext = {
  timezone: 'UTC',
  countryCode: 'GB',
  holidayRegion: 'England',
  coordinates: { lat: 51.5074, lon: -0.1278 },
}

type AtCase = {
  name: string
  raw: string | null
  instant: string
  context?: OpeningHoursContext
  status: VerificationStatus
  reason: OpeningHoursReason
  localDate?: string
  localTime?: string
  holiday?: boolean
}

const atCases: AtCase[] = [
  {
    name: '24/7 est ouvert un mercredi midi',
    raw: '24/7',
    instant: '2026-10-21T10:00:00Z',
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-21',
    localTime: '12:00',
  },
  {
    name: '24/7 reste ouvert pendant le retour à l’heure d’hiver',
    raw: '24/7',
    instant: '2026-10-25T00:30:00Z',
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-25',
    localTime: '02:30',
  },
  {
    name: 'une plage en semaine est ouverte le mercredi midi',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T10:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'une plage en semaine est fermée le samedi',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-24T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'une plage est fermée une minute avant l’ouverture',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T06:59:00Z',
    status: 'violation',
    reason: 'closed',
    localTime: '08:59',
  },
  {
    name: 'une plage est ouverte à l’heure exacte d’ouverture',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T07:00:00Z',
    status: 'conforme',
    reason: 'open',
    localTime: '09:00',
  },
  {
    name: 'une plage est fermée à l’heure exacte de fermeture',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T16:00:00Z',
    status: 'violation',
    reason: 'closed',
    localTime: '18:00',
  },
  {
    name: 'une plage est ouverte une minute avant la fermeture',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T15:59:00Z',
    status: 'conforme',
    reason: 'open',
    localTime: '17:59',
  },
  {
    name: 'un jour de fermeture explicite est fermé',
    raw: 'Mo-Fr 09:00-18:00; Sa,Su off',
    instant: '2026-10-25T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'un jour off en semaine est fermé',
    raw: 'Mo-Fr 09:00-18:00; We off',
    instant: '2026-10-21T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'un autre jour de la semaine reste ouvert',
    raw: 'Mo-Fr 09:00-18:00; We off',
    instant: '2026-10-22T10:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'une plage de week-end ouvre le dimanche midi',
    raw: 'Mo-Fr 09:00-18:00; Sa,Su 10:00-16:00',
    instant: '2026-10-25T10:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'une plage de week-end est fermée à 16 h',
    raw: 'Mo-Fr 09:00-18:00; Sa,Su 10:00-16:00',
    instant: '2026-10-25T15:00:00Z',
    status: 'violation',
    reason: 'closed',
    localTime: '16:00',
  },
  {
    name: 'une plage 00:00-24:00 couvre minuit',
    raw: 'Mo-Su 00:00-24:00',
    instant: '2026-10-21T22:00:00Z',
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-22',
    localTime: '00:00',
  },
  {
    name: 'une plage 00:00-24:00 couvre la fin de nuit',
    raw: 'Mo-Su 00:00-24:00',
    instant: '2026-10-21T23:59:00Z',
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-22',
    localTime: '01:59',
  },
  {
    name: 'off est une fermeture valide',
    raw: 'off',
    instant: '2026-10-21T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'closed est une fermeture valide',
    raw: 'closed',
    instant: '2026-10-21T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'une syntaxe incompréhensible donne indéterminé',
    raw: 'nonsense',
    instant: '2026-10-21T10:00:00Z',
    status: 'indéterminé',
    reason: 'invalid_syntax',
  },
  {
    name: 'une heure hors bornes donne indéterminé',
    raw: 'Mo-Fr 25:00-26:00',
    instant: '2026-10-21T10:00:00Z',
    status: 'indéterminé',
    reason: 'invalid_syntax',
  },
  {
    name: 'une chaîne vide donne indéterminé',
    raw: '',
    instant: '2026-10-21T10:00:00Z',
    status: 'indéterminé',
    reason: 'missing_hours',
  },
  {
    name: 'une absence d’horaires donne indéterminé',
    raw: null,
    instant: '2026-10-21T10:00:00Z',
    status: 'indéterminé',
    reason: 'missing_hours',
  },
  {
    name: 'un état unknown donne indéterminé en semaine',
    raw: 'Mo-Fr 09:00-18:00; unknown',
    instant: '2026-10-21T10:00:00Z',
    status: 'indéterminé',
    reason: 'unknown',
  },
  {
    name: 'un état unknown donne indéterminé le samedi',
    raw: 'Mo-Fr 09:00-18:00; unknown',
    instant: '2026-10-24T10:00:00Z',
    status: 'indéterminé',
    reason: 'unknown',
  },
  {
    name: 'un commentaire après open ne change pas l’état',
    raw: 'Mo-Fr 09:00-18:00 open "sur rendez-vous"',
    instant: '2026-10-21T10:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'une pause déjeuner est fermée à 12:30',
    raw: 'Mo-Fr 09:00-12:00,13:00-18:00',
    instant: '2026-10-21T10:30:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'une pause déjeuner rouvre à 13:00',
    raw: 'Mo-Fr 09:00-12:00,13:00-18:00',
    instant: '2026-10-21T11:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'la première fenêtre se ferme à 12:00',
    raw: 'Mo-Fr 09:00-12:00,13:00-18:00',
    instant: '2026-10-21T10:00:00Z',
    status: 'violation',
    reason: 'closed',
    localTime: '12:00',
  },
  {
    name: 'une plage nocturne est ouverte le vendredi soir',
    raw: 'Fr 20:00-02:00',
    instant: '2026-10-23T21:00:00Z',
    status: 'conforme',
    reason: 'open',
    localTime: '23:00',
  },
  {
    name: 'une plage nocturne continue après minuit',
    raw: 'Fr 20:00-02:00',
    instant: '2026-10-23T23:00:00Z',
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-24',
    localTime: '01:00',
  },
  {
    name: 'une plage nocturne ferme à 02:00',
    raw: 'Fr 20:00-02:00',
    instant: '2026-10-24T00:00:00Z',
    status: 'violation',
    reason: 'closed',
    localDate: '2026-10-24',
    localTime: '02:00',
  },
  {
    name: 'une plage saisonnière est ouverte en juillet',
    raw: 'Jul-Aug Mo-Su 10:00-18:00',
    instant: '2026-07-15T10:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'une plage saisonnière est fermée en octobre',
    raw: 'Jul-Aug Mo-Su 10:00-18:00',
    instant: '2026-10-21T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'une plage datée est ouverte dans sa période',
    raw: '2026 Jul 01-2026 Aug 31 Mo-Su 10:00-18:00',
    instant: '2026-07-15T10:00:00Z',
    status: 'conforme',
    reason: 'open',
  },
  {
    name: 'une plage datée est fermée hors période',
    raw: '2026 Jul 01-2026 Aug 31 Mo-Su 10:00-18:00',
    instant: '2026-10-21T10:00:00Z',
    status: 'violation',
    reason: 'closed',
  },
  {
    name: 'un jour férié explicite est ouvert',
    raw: 'PH 10:00-18:00',
    instant: '2026-07-14T10:00:00Z',
    status: 'conforme',
    reason: 'open',
    holiday: true,
  },
  {
    name: 'un jour férié explicite ne s’applique pas le lendemain',
    raw: 'PH 10:00-18:00',
    instant: '2026-07-15T10:00:00Z',
    status: 'violation',
    reason: 'closed',
    holiday: false,
  },
  {
    name: 'PH off ferme le jour férié',
    raw: 'Mo-Fr 09:00-18:00; PH off',
    instant: '2026-07-14T10:00:00Z',
    status: 'violation',
    reason: 'closed',
    holiday: true,
  },
  {
    name: 'PH off laisse le lendemain ouvert',
    raw: 'Mo-Fr 09:00-18:00; PH off',
    instant: '2026-07-15T10:00:00Z',
    status: 'conforme',
    reason: 'open',
    holiday: false,
  },
  {
    name: 'le jour férié est reconnu avec la région de Lyon',
    raw: 'Mo-Su 09:00-18:00; PH off',
    instant: '2026-07-14T10:00:00Z',
    context: LYON,
    status: 'violation',
    reason: 'closed',
    holiday: true,
  },
  {
    name: 'le lendemain du 14 juillet est ouvert à Lyon',
    raw: 'Mo-Su 09:00-18:00; PH off',
    instant: '2026-07-15T10:00:00Z',
    context: LYON,
    status: 'conforme',
    reason: 'open',
    holiday: false,
  },
  {
    name: 'le fuseau de Paris décale l’instant de deux heures',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T07:30:00Z',
    context: PARIS,
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-21',
    localTime: '09:30',
  },
  {
    name: 'le même instant en UTC est encore fermé',
    raw: 'Mo-Fr 09:00-18:00',
    instant: '2026-10-21T07:30:00Z',
    context: UTC,
    status: 'violation',
    reason: 'closed',
    localDate: '2026-10-21',
    localTime: '07:30',
  },
  {
    name: 'une plage du soir est ouverte à Paris à 19:30',
    raw: 'Mo-Fr 18:00-20:00',
    instant: '2026-10-21T17:30:00Z',
    context: PARIS,
    status: 'conforme',
    reason: 'open',
    localTime: '19:30',
  },
  {
    name: 'la même plage est fermée en UTC à 17:30',
    raw: 'Mo-Fr 18:00-20:00',
    instant: '2026-10-21T17:30:00Z',
    context: UTC,
    status: 'violation',
    reason: 'closed',
    localTime: '17:30',
  },
  {
    name: 'le passage à l’heure d’été saute de 01:30 à 03:30',
    raw: 'Su 03:00-04:00',
    instant: '2026-03-29T01:30:00Z',
    context: PARIS,
    status: 'conforme',
    reason: 'open',
    localDate: '2026-03-29',
    localTime: '03:30',
  },
  {
    name: 'avant le passage à l’heure d’été il est 01:30',
    raw: 'Su 03:00-04:00',
    instant: '2026-03-29T00:30:00Z',
    context: PARIS,
    status: 'violation',
    reason: 'closed',
    localDate: '2026-03-29',
    localTime: '01:30',
  },
  {
    name: 'le retour à l’heure d’hiver donne 02:30',
    raw: 'Su 02:00-03:00',
    instant: '2026-10-25T01:30:00Z',
    context: PARIS,
    status: 'conforme',
    reason: 'open',
    localDate: '2026-10-25',
    localTime: '02:30',
  },
  {
    name: 'après le retour à l’heure d’hiver il est 03:30',
    raw: 'Su 02:00-03:00',
    instant: '2026-10-25T02:30:00Z',
    context: PARIS,
    status: 'violation',
    reason: 'closed',
    localDate: '2026-10-25',
    localTime: '03:30',
  },
  {
    name: 'une plage PH restreinte est ouverte le matin férié',
    raw: 'PH 10:00-12:00',
    instant: '2026-07-14T09:00:00Z',
    status: 'conforme',
    reason: 'open',
    localTime: '11:00',
    holiday: true,
  },
  {
    name: 'une plage PH restreinte est fermée l’après-midi férié',
    raw: 'PH 10:00-12:00',
    instant: '2026-07-14T11:00:00Z',
    status: 'violation',
    reason: 'closed',
    localTime: '13:00',
    holiday: true,
  },
  {
    name: 'une règle PH remplace la plage de semaine le jour férié',
    raw: 'Mo-Fr 09:00-18:00; PH 10:00-12:00',
    instant: '2026-07-14T09:00:00Z',
    status: 'conforme',
    reason: 'open',
    localTime: '11:00',
    holiday: true,
  },
  {
    name: 'une règle PH ferme l’après-midi du jour férié',
    raw: 'Mo-Fr 09:00-18:00; PH 10:00-12:00',
    instant: '2026-07-14T11:00:00Z',
    status: 'violation',
    reason: 'closed',
    localTime: '13:00',
    holiday: true,
  },
  {
    name: 'la règle PH ne s’applique pas le lendemain',
    raw: 'Mo-Fr 09:00-18:00; PH 10:00-12:00',
    instant: '2026-07-15T11:00:00Z',
    status: 'conforme',
    reason: 'open',
    localTime: '13:00',
    holiday: false,
  },
]

describe('checkOpeningHoursAt', () => {
  it.each(atCases)('$name', (testCase) => {
    const result = checkOpeningHoursAt(
      testCase.raw,
      testCase.context ?? PARIS,
      new Date(testCase.instant),
    )

    expect(result.status).toBe(testCase.status)
    expect(result.reason).toBe(testCase.reason)

    if (testCase.localDate) {
      expect(result.local?.date).toBe(testCase.localDate)
    }

    if (testCase.localTime) {
      expect(result.local?.time).toBe(testCase.localTime)
    }

    if (testCase.holiday !== undefined) {
      expect(result.holiday).toBe(testCase.holiday)
    }
  })

  it('retourne indéterminé pour un fuseau inconnu', () => {
    const result = checkOpeningHoursAt(
      '24/7',
      { ...PARIS, timezone: 'Mars/Olympus' },
      new Date('2026-10-21T10:00:00Z'),
    )

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('invalid_timezone')
    expect(result.local).toBeNull()
  })

  it('retourne indéterminé pour une date invalide', () => {
    const result = checkOpeningHoursAt('24/7', PARIS, new Date('date invalide'))

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('invalid_local_time')
  })

  it('retourne indéterminé pour des coordonnées invalides', () => {
    const result = checkOpeningHoursAt(
      '24/7',
      { ...PARIS, coordinates: { lat: 100, lon: 2.3522 } },
      new Date('2026-10-21T10:00:00Z'),
    )

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('invalid_context')
  })
})

describe('localDateTimeInTimezone', () => {
  it('convertit le passage à l’heure d’été', () => {
    expect(localDateTimeInTimezone(new Date('2026-03-29T01:30:00Z'), 'Europe/Paris')).toEqual({
      date: '2026-03-29',
      time: '03:30',
    })
  })

  it('convertit le retour à l’heure d’hiver', () => {
    expect(localDateTimeInTimezone(new Date('2026-10-25T01:30:00Z'), 'Europe/Paris')).toEqual({
      date: '2026-10-25',
      time: '02:30',
    })
  })

  it('retourne null pour un fuseau inconnu', () => {
    expect(localDateTimeInTimezone(new Date(), 'Mars/Olympus')).toBeNull()
  })
})

describe('checkOpeningHoursWindow', () => {
  it('détecte une pause déjeuner pendant le stop', () => {
    const result = checkOpeningHoursWindow('Mo-Fr 09:00-12:00,13:00-18:00', PARIS, {
      date: '2026-10-21',
      start: '11:45',
      end: '13:15',
    })

    expect(result.status).toBe('violation')
    expect(result.reason).toBe('closes_during_stop')
  })

  it('accepte deux fenêtres adjacentes sans fausse fermeture', () => {
    const result = checkOpeningHoursWindow('Mo 09:00-12:00,12:00-18:00', PARIS, {
      date: '2026-10-19',
      start: '10:00',
      end: '14:00',
    })

    expect(result.status).toBe('conforme')
    expect(result.reason).toBe('open')
  })

  it('retourne indéterminé si la fenêtre traverse un état unknown', () => {
    const result = checkOpeningHoursWindow('Mo-Fr 09:00-18:00; unknown', PARIS, {
      date: '2026-10-21',
      start: '10:00',
      end: '12:00',
    })

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('unknown')
  })

  it('accepte un stop qui finit à l’heure de fermeture', () => {
    const result = checkOpeningHoursWindow('Mo-Fr 09:00-18:00', PARIS, {
      date: '2026-10-21',
      start: '17:00',
      end: '18:00',
    })

    expect(result.status).toBe('conforme')
    expect(result.reason).toBe('open')
  })

  it('refuse un stop qui dépasse la fermeture d’une minute', () => {
    const result = checkOpeningHoursWindow('Mo-Fr 09:00-18:00', PARIS, {
      date: '2026-10-21',
      start: '17:00',
      end: '18:01',
    })

    expect(result.status).toBe('violation')
    expect(result.reason).toBe('closes_during_stop')
  })

  it('accepte une fenêtre qui passe minuit', () => {
    const result = checkOpeningHoursWindow('Fr 20:00-02:00', PARIS, {
      date: '2026-10-23',
      start: '23:00',
      end: '01:00',
    })

    expect(result.status).toBe('conforme')
    expect(result.reason).toBe('open')
  })

  it('refuse la même fenêtre si elle dépasse la fermeture', () => {
    const result = checkOpeningHoursWindow('Fr 20:00-02:00', PARIS, {
      date: '2026-10-23',
      start: '23:00',
      end: '02:01',
    })

    expect(result.status).toBe('violation')
    expect(result.reason).toBe('closes_during_stop')
  })

  it('détecte un jour férié sur une fenêtre', () => {
    const result = checkOpeningHoursWindow('Mo-Fr 09:00-18:00; PH off', PARIS, {
      date: '2026-07-14',
      start: '10:00',
      end: '12:00',
    })

    expect(result.status).toBe('violation')
    expect(result.reason).toBe('closed')
    expect(result.holiday).toBe(true)
  })

  it('refuse une heure locale qui n’existe pas au passage à l’heure d’été', () => {
    const result = checkOpeningHoursWindow('Su 03:00-05:00', PARIS, {
      date: '2026-03-29',
      start: '02:30',
      end: '03:30',
    })

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('invalid_local_time')
  })

  it('accepte la même fenêtre après le saut de 02:00 à 03:00', () => {
    const result = checkOpeningHoursWindow('Su 03:00-05:00', PARIS, {
      date: '2026-03-29',
      start: '03:30',
      end: '04:30',
    })

    expect(result.status).toBe('conforme')
    expect(result.reason).toBe('open')
  })

  it('accepte une heure répétée au retour à l’heure d’hiver', () => {
    const result = checkOpeningHoursWindow('Su 02:00-03:00', PARIS, {
      date: '2026-10-25',
      start: '02:30',
      end: '02:45',
    })

    expect(result.status).toBe('conforme')
    expect(result.reason).toBe('open')
  })

  it('retourne indéterminé si les horaires manquent', () => {
    const result = checkOpeningHoursWindow(null, PARIS, {
      date: '2026-10-21',
      start: '10:00',
      end: '12:00',
    })

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('missing_hours')
  })

  it('retourne indéterminé pour une fenêtre dégénérée', () => {
    const result = checkOpeningHoursWindow('Mo-Fr 09:00-18:00', PARIS, {
      date: '2026-10-21',
      start: '10:00',
      end: '10:00',
    })

    expect(result.status).toBe('indéterminé')
    expect(result.reason).toBe('invalid_local_time')
  })
})
