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

## Démarrage

```bash
pnpm install
pnpm dev
```

- Web : http://localhost:4311
- API : http://localhost:4310/health

## Scripts

| Commande | Effet |
|---|---|
| `pnpm dev` | Lance le web et l'API en parallèle |
| `pnpm typecheck` | Vérifie les types dans tous les paquets |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test` | Tests unitaires |
| `pnpm build` | Build du web |

## Structure

```
apps/web          React + TanStack Router + Vite
apps/api          Fastify + Zod
packages/domain   Schémas et types partagés
packages/data     Packs villes et données de référence
services/solver   Solveur de contraintes
evals             Corpus, annotations, harnais d'évaluation
infra             Base de données, déploiement, CI
```
