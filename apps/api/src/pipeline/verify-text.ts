import {
  buildVerificationReport,
  localDateTimeInTimezone,
  verifyPlan,
  type VerificationReport,
} from '@recta/domain'
import { createAnthropicExtractionClientFromEnv } from '../extraction/anthropic'
import { NominatimPlaceSearch } from '../resolution/nominatim-search'
import { NominatimClient } from '../sources/nominatim'
import { OsrmClient } from '../sources/osrm'
import { OverpassClient } from '../sources/overpass'
import { TransitousClient } from '../sources/transitous'
import { loadCityConfig, loadVerificationFacts } from '../verification/facts'
import { collectTravelFacts } from '../verification/travel'
import { buildPlanFromText, type StopResolutionSummary } from './text-to-plan'

export type VerifyTextInput = {
  text: string
  cityId: string
  start: string | null
}

export type VerifyTextResult = {
  report: VerificationReport
  resolutions: StopResolutionSummary[]
}

export type VerifyText = (input: VerifyTextInput) => Promise<VerifyTextResult>

export const verifyText: VerifyText = async ({ text, cityId, start }) => {
  const city = await loadCityConfig(cityId)
  const today =
    localDateTimeInTimezone(new Date(), city.timezone)?.date ??
    new Date().toISOString().slice(0, 10)
  const { plan, resolutions } = await buildPlanFromText(
    text,
    { city, start, today },
    {
      extraction: createAnthropicExtractionClientFromEnv(),
      search: new NominatimPlaceSearch({ client: new NominatimClient() }),
      overpass: new OverpassClient(),
    },
  )
  const facts = await loadVerificationFacts(cityId)
  const travel = await collectTravelFacts(
    plan,
    { osrm: new OsrmClient(), transitous: new TransitousClient() },
    city,
  )

  return { report: buildVerificationReport(verifyPlan(plan, { ...facts, travel })), resolutions }
}
