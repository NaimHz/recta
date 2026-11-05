import type { ResolutionAgentOption, StopResolution, VerificationReport } from '@recta/domain'

export type City = {
  id: string
  name: string
}

export type ResolutionSummary = {
  stopId: string
  name: string
  status: StopResolution
  question: string | null
  options: ResolutionAgentOption[]
}

export type VerifyResponse = {
  report: VerificationReport
  resolutions: ResolutionSummary[]
}

export type VerifyRequest = {
  text: string
  cityId: string
  start: string | null
}
