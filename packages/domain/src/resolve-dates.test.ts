import { describe, expect, it } from 'vitest'
import { resolveDayDates } from './resolve-dates'

const REFERENCE = { reference: '2026-10-20', start: null }

function single(text: string | null, options = REFERENCE): string | null {
  return resolveDayDates([text], options)[0] ?? null
}

describe('resolveDayDates', () => {
  it.each([
    ['Samedi 24 octobre', '2026-10-24'],
    ['Le samedi 24 octobre', '2026-10-24'],
    ['Vendredi 23 octobre', '2026-10-23'],
    ['dimanche 25 octobre', '2026-10-25'],
    ['Le 1er novembre', '2026-11-01'],
    ['sam 24/10', '2026-10-24'],
    ['Vendredi 23/10', '2026-10-23'],
    ['Saturday, October 24', '2026-10-24'],
    ['On Sunday, October 25', '2026-10-25'],
    ['24 octobre 2027', '2027-10-24'],
    ['24/10/2027', '2027-10-24'],
  ])('lit « %s »', (text, expected) => {
    expect(single(text)).toBe(expected)
  })

  it('prend l’année suivante pour une date déjà passée', () => {
    expect(single('2 mars')).toBe('2027-03-02')
    expect(single('Mardi 2 mars')).toBe('2027-03-02')
  })

  it('refuse un jour de semaine qui contredit la date', () => {
    expect(single('Samedi 25 octobre')).toBeNull()
    expect(single('Dimanche 26 octobre')).toBeNull()
  })

  it('refuse une date impossible ou une forme inconnue', () => {
    expect(single('31 février')).toBeNull()
    expect(single('31/02')).toBeNull()
    expect(single('demain')).toBeNull()
    expect(single('samedi soir')).toBeNull()
    expect(single(null)).toBeNull()
  })

  it('ancre un jour de semaine seul sur le départ, puis sur le jour précédent', () => {
    expect(
      resolveDayDates(['Samedi', 'dimanche'], { reference: '2026-10-24', start: '2026-10-24' }),
    ).toEqual(['2026-10-24', '2026-10-25'])
    expect(
      resolveDayDates(['Vendredi 23 octobre', 'Saturday'], {
        reference: '2026-10-20',
        start: null,
      }),
    ).toEqual(['2026-10-23', '2026-10-24'])
  })

  it('rend indéterminé un jour de semaine sans ancre', () => {
    expect(resolveDayDates(['Samedi'], REFERENCE)).toEqual([null])
    expect(resolveDayDates([null, 'dimanche'], { ...REFERENCE, start: '2026-10-24' })).toEqual([
      null,
      null,
    ])
  })

  it('lit un numéro de jour à partir du départ', () => {
    expect(
      resolveDayDates(['Jour 1', 'Day 2'], { reference: '2026-10-24', start: '2026-10-24' }),
    ).toEqual(['2026-10-24', '2026-10-25'])
    expect(resolveDayDates(['Jour 1'], REFERENCE)).toEqual([null])
    expect(resolveDayDates(['Jour 0'], { ...REFERENCE, start: '2026-10-24' })).toEqual([null])
  })
})
