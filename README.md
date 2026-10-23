# Recta

**Fact-check ton itinéraire.**

Colle un itinéraire, quelle que soit sa source. Recta vérifie les horaires, les trajets et les
correspondances, montre ce qui ne tient pas avec la preuve, puis propose une version corrigée.

## Principe

Le texte est lu pour comprendre. Le code vérifie les faits.

Une erreur n'est affichée qu'avec sa source, sa date et la donnée brute. Une donnée manquante donne
`indéterminé`, jamais une erreur.

## Prérequis

- Node 22
- pnpm 11
- Docker et Docker Compose

## Démarrage

```bash
pnpm install
docker compose up -d
pnpm db:reset
pnpm dev
```

- Web : http://localhost:4311
- API : http://localhost:4310/health

`pnpm db:reset` recrée le schéma, applique les migrations et charge les packs villes. La commande
attend que Postgres soit prêt.

## Scripts

| Commande | Effet |
|---|---|
| `pnpm dev` | Lance le web et l'API en parallèle |
| `pnpm typecheck` | Vérifie les types dans tous les paquets |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test` | Tests unitaires |
| `pnpm verify fixture.txt` | Vérifie la fixture minimale et sort le résultat JSON avec preuve |
| `pnpm osm:fetch` | Récupère 25 lieux OSM par ville de référence et écrit `evals/sources/osm-places.json` |
| `pnpm build` | Build du web |
| `pnpm db:up` | Démarre Postgres/PostGIS |
| `pnpm db:reset` | Recrée la base, applique les migrations et charge les villes |
| `pnpm db:check` | Vérifie PostGIS et la présence des villes |

`pnpm osm:fetch --nominatim` ajoute un géocodage de contrôle par ville, à une requête par seconde
maximum. Les appels Overpass sont espacés d'au moins une seconde.

## Structure

```
apps/web          React + TanStack Router + Vite
apps/api          Fastify + Zod + Drizzle
packages/domain   Schémas et types partagés
packages/data     Packs villes et données de référence
services/solver   Solveur de contraintes
evals             Corpus, annotations, harnais d'évaluation
infra             Déploiement et CI
compose.yaml      Postgres 16 + PostGIS 3.4
```
