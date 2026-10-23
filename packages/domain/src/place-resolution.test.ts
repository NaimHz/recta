import { describe, expect, it } from 'vitest'
import { resolvePlaces } from './place-resolution'
import type { Place } from './plan'

function makePlace(
  id: string,
  name: string,
  category: string | null,
  lat = 48.8566,
  lon = 2.3522,
): Place {
  return {
    id,
    name,
    coordinates: { lat, lon },
    address: null,
    category,
    openingHoursRaw: null,
    openingHours: null,
    source: {
      provider: 'fixture',
      sourceDate: null,
      retrievedAt: null,
    },
  }
}

describe('resolvePlaces', () => {
  it('retrouve un nom accentué à partir d’une saisie sans accents', () => {
    const candidates = [
      makePlace('osm:node/1', "Musée de l'Armée", 'tourism:museum'),
      makePlace('osm:node/2', 'Musée des Arts Décoratifs', 'tourism:museum'),
    ]

    const results = resolvePlaces({ name: 'musee de l armee', type: 'museum' }, candidates)

    expect(results[0]?.place.id).toBe('osm:node/1')
    expect(results[0]?.components.exact).toBe(true)
    expect(results[0]?.components.name).toBe(1)
  })

  it('tolère une faute de frappe', () => {
    const candidates = [
      makePlace('osm:node/1', 'Comptoir des Marronniers', 'amenity:restaurant'),
      makePlace('osm:node/2', 'Restaurant Léon de Lyon', 'amenity:restaurant'),
    ]

    const results = resolvePlaces(
      { name: 'comptoir des marronier', type: 'restaurant' },
      candidates,
    )

    expect(results[0]?.place.id).toBe('osm:node/1')
  })

  it('retrouve un nom partiel', () => {
    const candidates = [
      makePlace('osm:node/1', 'Maison Villemanzy', 'amenity:restaurant'),
      makePlace('osm:node/2', 'Le Bistro Autrement', 'amenity:restaurant'),
    ]

    const results = resolvePlaces({ name: 'villemanzy', type: 'restaurant' }, candidates)

    expect(results[0]?.place.id).toBe('osm:node/1')
  })

  it('utilise le type pour distinguer un musée d’un café au nom proche', () => {
    const candidates = [
      makePlace('osm:node/1', 'Musée des Arts et Métiers', 'tourism:museum'),
      makePlace('osm:node/2', 'Les Arts et Métiers', 'amenity:cafe'),
    ]

    const cafe = resolvePlaces({ name: 'arts et metiers', type: 'cafe' }, candidates)
    const museum = resolvePlaces({ name: 'arts et metiers', type: 'museum' }, candidates)

    expect(cafe[0]?.place.id).toBe('osm:node/2')
    expect(museum[0]?.place.id).toBe('osm:node/1')
  })

  it('ne pénalise pas une catégorie absente', () => {
    const candidates = [
      makePlace('osm:node/1', 'Café', 'amenity:cafe'),
      makePlace('osm:node/2', 'Café', null),
    ]

    const results = resolvePlaces({ name: 'cafe', type: 'cafe' }, candidates)

    expect(results.find((result) => result.place.id === 'osm:node/1')?.components.type).toBe(1)
    expect(results.find((result) => result.place.id === 'osm:node/2')?.components.type).toBe(0.5)
  })

  it('utilise la distance pour départager deux lieux homonymes', () => {
    const candidates = [
      makePlace('osm:node/1', 'La Terrasse', 'amenity:cafe', 48.86, 2.35),
      makePlace('osm:node/2', 'La Terrasse', 'amenity:cafe', 45.76, 4.83),
    ]

    const results = resolvePlaces(
      {
        name: 'la terrasse',
        type: 'cafe',
        near: { lat: 45.76, lon: 4.835 },
      },
      candidates,
    )

    expect(results[0]?.place.id).toBe('osm:node/2')
    expect(results[0]?.components.distance).toBeGreaterThan(results[1]?.components.distance ?? 0)
  })

  it('retourne au plus trois candidats', () => {
    const candidates = [
      makePlace('osm:node/1', 'Café', 'amenity:cafe'),
      makePlace('osm:node/2', 'Café Deux', 'amenity:cafe'),
      makePlace('osm:node/3', 'Café Trois', 'amenity:cafe'),
      makePlace('osm:node/4', 'Café Quatre', 'amenity:cafe'),
    ]

    const results = resolvePlaces({ name: 'cafe', type: 'cafe' }, candidates)

    expect(results).toHaveLength(3)
    expect(results[0]?.place.id).toBe('osm:node/1')
    expect(new Set(results.map((result) => result.place.id)).size).toBe(3)
  })

  it('retourne un classement vide sans nom exploitable', () => {
    expect(resolvePlaces({ name: '   ' }, [makePlace('osm:node/1', 'Lieu', null)])).toEqual([])
  })
})
