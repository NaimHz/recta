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
| `pnpm verify fixture.txt` | Vérifie la fixture minimale et sort le résultat JSON avec preuve, coût et fraîcheur |
| `pnpm extract fichier.txt` | Extrait un plan depuis un texte via Anthropic (clé et modèle requis) |
| `pnpm data:check` | Vérifie les bases curatées : 20 sites par ville, chaque fait avec source et date de revue |
| `pnpm osm:fetch` | Récupère 25 lieux OSM par ville de référence et écrit `evals/sources/osm-places.json` |
| `pnpm eval:resolution` | Mesure top-1 et top-3 de la résolution sur 30 cas et écrit `evals/resolution/report.json` |
| `pnpm eval:agent` | Mesure les 10 cas de l'agent de résolution et écrit `evals/resolution/agent-report.json` |
| `pnpm eval:opening-hours` | Mesure 40 cas d'horaires et écrit `evals/opening-hours/report.json` |
| `pnpm eval:verification` | Combine les 30 cas de résolution et les 40 cas d'horaires dans `evals/verification/report.json` |
| `pnpm eval:extraction` | Valide 10 textes sur les sorties enregistrées et écrit `evals/extraction/report.json` |
| `pnpm eval:extraction:live` | Rejoue les 10 textes via Anthropic et écrit `evals/extraction/live-report.json` |
| `pnpm eval:extraction-f1` | Note 30 textes, 3 formats et 7 champs sur les sorties enregistrées, et écrit `evals/extraction-f1/report.json` |
| `pnpm eval:extraction-f1:live` | Rejoue les 30 textes via Anthropic et écrit `evals/extraction-f1/live-report.json` |
| `pnpm build` | Build du web |
| `pnpm db:up` | Démarre Postgres/PostGIS |
| `pnpm db:reset` | Recrée la base, applique les migrations et charge les villes |
| `pnpm db:check` | Vérifie PostGIS et la présence des villes |

`pnpm osm:fetch --nominatim` ajoute un géocodage de contrôle par ville, à une requête par seconde
maximum. Les appels Overpass sont espacés d'au moins une seconde.

`pnpm eval:verification` regroupe les deux jeux de test de la couche factuelle : 30 cas de
résolution et 40 cas d'horaires. Le rapport donne le top-1, le top-3, les abstentions et la liste
des erreurs, avec le détail de chaque cas.

L'extraction utilise un schéma Zod strict. Toute information absente vaut `null`, et chaque stop
doit citer un extrait exact du texte dans `sourceText`. Le mode enregistré ne fait aucun appel ;
le mode live nécessite `ANTHROPIC_API_KEY` et `EXTRACTION_MODEL` :

```sh
ANTHROPIC_API_KEY=... EXTRACTION_MODEL=... pnpm eval:extraction:live
```

Le corpus F1 contient 30 textes, 10 par format (`whatsapp`, `email`, `article`). Les annotations
sont manuelles et validées : chaque `sourceText` est une citation exacte et chaque valeur non nulle
doit y apparaître. Le score aligne les jours et les stops, puis calcule un F1 par champ : `name`,
`startText`, `endText`, `type`, `dateText`, `city`, `timezoneText`. La tolérance ignore accents,
casse, ponctuation et articles de date, compare les heures sous forme canonique `HH:MM`, accepte
les variantes de noms à 50 % de tokens communs et regroupe les types synonymes. Le rapport donne
le F1 macro, le F1 micro, le détail par format et les erreurs classées. Baseline live : 30/30
schéma, 30/30 sans invention, F1 macro 0,986 et F1 micro 0,978 ; le champ `type` reste le plus
fragile.

## Faits curatés

Chaque ville a une base `packages/data/cities/<ville>/curated-facts.yml`. Les faits hors OSM
(`business_status`) y sont versionnés avec leur source HTTPS et leur date de revue. Les 20 sites
de chaque ville sont reliés à un objet OSM. `pnpm data:check` valide le format, les doublons et la
présence d'une source datée pour chaque fait.

## Coût et fraîcheur

`pnpm verify` ajoute au résultat deux blocs. `usage` compte les appels, estime le coût et applique
les plafonds : alerte à 0,50 €, arrêt à 1,00 €. `freshness` donne l'âge de la source de chaque lieu
et signale ceux de plus de 365 jours. Sans date de source, la fraîcheur est `inconnue` : elle n'est
pas supposée fraîche.

Les appels Google Places sont estimés à 0,02 €. OSM, OSRM et Transitous restent gratuits. La
fixture locale ne fait aucun appel externe : son coût est donc nul.

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
