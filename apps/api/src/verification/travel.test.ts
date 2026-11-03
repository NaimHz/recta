import { SCHEMA_VERSION, type Coordinates, type Plan, type Stop } from '@recta/domain'
import { describe, expect, it } from 'vitest'
import type { TransitousPlanRequest } from '../sources/transitous'
import { collectTravelFacts, type TravelClients } from './travel'

const NOW = () => new Date('2026-11-03T09:00:00.000Z')
const CITY = { timezone: 'Europe/Paris', capabilities: { transit: true, curatedFacts: true } }

function stop(id: string, start: string, end: string, coordinates: Coordinates | null): Stop {
  return {
    id,
    name: id,
    sourceText: null,
    type: null,
    resolution: 'resolved',
    place: {
      id: `osm:node/${id}`,
      name: id,
      coordinates,
      address: null,
      category: null,
      openingHoursRaw: null,
      source: { provider: 'osm', sourceDate: null, retrievedAt: null },
    },
    start,
    end,
    windowSource: 'explicit',
  }
}

const gareDuNord = { lat: 48.8809, lon: 2.3553 }
const louvre = { lat: 48.8606, lon: 2.3364 }
const marly = { lat: 48.8616428, lon: 2.3359304 }

function plan(stops: Stop[], date: string | null = '2026-11-10'): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    cityId: 'test-city',
    days: [{ id: 'day-1', date, timezone: 'Europe/Paris', stops }],
    constraints: [],
  }
}

function clients(overrides: Partial<TravelClients> = {}) {
  const tableCalls: Coordinates[][] = []
  const planCalls: TransitousPlanRequest[] = []
  const fake: TravelClients = {
    osrm: {
      table: async (points) => {
        tableCalls.push(points)
        return {
          url: 'https://osrm.test/table',
          durationsSeconds: points.map((_, row) =>
            points.map((__, col) => (row === col ? 0 : 600)),
          ),
          distancesMeters: points.map((_, row) => points.map((__, col) => (row === col ? 0 : 800))),
        }
      },
    },
    transitous: {
      plan: async (request) => {
        planCalls.push(request)
        return {
          url: 'https://transitous.test/plan',
          itineraries: [
            {
              startTime: '2026-11-10T06:55:00Z',
              endTime: '2026-11-10T07:10:00Z',
              durationSeconds: 900,
              transfers: 0,
              legs: [],
            },
            {
              startTime: '2026-11-10T07:02:00Z',
              endTime: '2026-11-10T07:26:00Z',
              durationSeconds: 1440,
              transfers: 1,
              legs: [
                {
                  mode: 'SUBWAY',
                  routeShortName: '4',
                  from: { name: 'A', lat: null, lon: null },
                  to: { name: 'B', lat: null, lon: null },
                  startTime: '2026-11-10T07:05:00Z',
                  endTime: '2026-11-10T07:20:00Z',
                },
              ],
            },
            {
              startTime: '2026-11-10T07:00:00Z',
              endTime: '2026-11-10T07:23:00Z',
              durationSeconds: 1380,
              transfers: 0,
              legs: [],
            },
          ],
        }
      },
    },
    ...overrides,
  }

  return { fake, tableCalls, planCalls }
}

describe('collectTravelFacts', () => {
  it('construit la matrice à pied du jour et les trajets consécutifs en transports', async () => {
    const { fake, tableCalls, planCalls } = clients()
    const travel = await collectTravelFacts(
      plan([
        stop('gare', '07:00', '08:00', gareDuNord),
        stop('louvre', '08:30', '11:00', louvre),
        stop('marly', '12:00', '13:00', marly),
      ]),
      fake,
      CITY,
      NOW,
    )

    expect(tableCalls).toEqual([[gareDuNord, louvre, marly]])
    expect(travel.walk[0]).toMatchObject({
      dayId: 'day-1',
      stopIds: ['gare', 'louvre', 'marly'],
      evidence: {
        source: 'osrm',
        url: 'https://osrm.test/table',
        retrievedAt: NOW().toISOString(),
      },
    })
    expect(planCalls.map((request) => request.time)).toEqual([
      '2026-11-10T07:00:00.000Z',
      '2026-11-10T10:00:00.000Z',
    ])
    expect(travel.transit[0]).toMatchObject({
      fromStopId: 'gare',
      toStopId: 'louvre',
      departureAt: '2026-11-10T07:00:00.000Z',
      arrivalAt: '2026-11-10T07:23:00Z',
      durationSeconds: 1380,
      transfers: 0,
      evidence: { source: 'transitous', sourceDate: '2026-11-10' },
    })
    expect(travel.unavailable).toEqual([])
  })

  it('ignore les stops sans coordonnées', async () => {
    const { fake, tableCalls, planCalls } = clients()
    const travel = await collectTravelFacts(
      plan([
        stop('gare', '07:00', '08:00', gareDuNord),
        stop('inconnu', '08:30', '09:00', null),
        stop('marly', '12:00', '13:00', marly),
      ]),
      fake,
      CITY,
      NOW,
    )

    expect(tableCalls).toEqual([[gareDuNord, marly]])
    expect(planCalls).toEqual([])
    expect(travel.walk[0]?.stopIds).toEqual(['gare', 'marly'])
  })

  it('transforme une panne en trajet indisponible, sans lever', async () => {
    const { fake } = clients({
      osrm: {
        table: async () => {
          throw new Error('OSRM HTTP 503')
        },
      },
      transitous: {
        plan: async () => {
          throw new Error('Transitous HTTP 502')
        },
      },
    })
    const travel = await collectTravelFacts(
      plan([stop('gare', '07:00', '08:00', gareDuNord), stop('louvre', '08:30', '11:00', louvre)]),
      fake,
      CITY,
      NOW,
    )

    expect(travel.unavailable).toEqual([
      { service: 'osrm', scope: 'day-1', reason: 'OSRM HTTP 503' },
      { service: 'transitous', scope: 'gare->louvre', reason: 'Transitous HTTP 502' },
    ])
  })

  it('note un départ à une heure locale inexistante', async () => {
    const { fake, planCalls } = clients()
    const travel = await collectTravelFacts(
      plan(
        [stop('bar', '01:00', '02:30', gareDuNord), stop('hotel', '03:30', '09:00', louvre)],
        '2026-03-29',
      ),
      fake,
      CITY,
      NOW,
    )

    expect(planCalls).toEqual([])
    expect(travel.unavailable[0]).toMatchObject({ service: 'transitous', scope: 'bar->hotel' })
  })

  it('n’appelle pas Transitous sans capacité transport ou sans date', async () => {
    const { fake, planCalls } = clients()
    const stops = [
      stop('gare', '07:00', '08:00', gareDuNord),
      stop('louvre', '08:30', '11:00', louvre),
    ]

    await collectTravelFacts(
      plan(stops),
      fake,
      { ...CITY, capabilities: { transit: false, curatedFacts: true } },
      NOW,
    )
    await collectTravelFacts(plan(stops, null), fake, CITY, NOW)

    expect(planCalls).toEqual([])
  })
})
