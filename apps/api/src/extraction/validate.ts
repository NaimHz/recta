import type { ExtractedPlan } from '@recta/domain'

export type ExtractionInvention = {
  path: string
  value: string
}

export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function containsNormalized(normalizedSource: string, value: string): boolean {
  return normalizedSource.includes(normalizeForMatch(value))
}

function checkField(
  inventions: ExtractionInvention[],
  path: string,
  normalizedSource: string,
  value: string | null,
): void {
  if (value === null) return
  if (containsNormalized(normalizedSource, value)) return

  inventions.push({ path, value })
}

/**
 * Vérifie que chaque valeur non nulle est justifiée par le texte.
 * Un stop doit citer un extrait exact du texte, et ses champs doivent apparaître
 * dans cette citation.
 */
export function findInventions(text: string, plan: ExtractedPlan): ExtractionInvention[] {
  const normalizedText = normalizeForMatch(text)
  const inventions: ExtractionInvention[] = []

  plan.days.forEach((day, dayIndex) => {
    const dayPath = `days[${dayIndex}]`

    checkField(inventions, `${dayPath}.dateText`, normalizedText, day.dateText)
    checkField(inventions, `${dayPath}.city`, normalizedText, day.city)
    checkField(inventions, `${dayPath}.timezoneText`, normalizedText, day.timezoneText)

    day.stops.forEach((stop, stopIndex) => {
      const stopPath = `${dayPath}.stops[${stopIndex}]`
      const quote = normalizeForMatch(stop.sourceText)
      const quoteFound = normalizedText.includes(quote)

      if (!quoteFound) {
        inventions.push({ path: `${stopPath}.sourceText`, value: stop.sourceText })
      }

      const evidence = quoteFound ? quote : normalizedText

      checkField(inventions, `${stopPath}.name`, evidence, stop.name)
      checkField(inventions, `${stopPath}.startText`, evidence, stop.startText)
      checkField(inventions, `${stopPath}.endText`, evidence, stop.endText)
      checkField(inventions, `${stopPath}.type`, evidence, stop.type)
    })
  })

  return inventions
}
