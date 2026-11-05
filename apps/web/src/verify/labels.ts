import type {
  IssueCode,
  IssueSeverity,
  StopResolution,
  UndeterminedReason,
  VerificationStatus,
} from '@recta/domain'

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  error: 'Erreur',
  warning: 'Avertissement',
  info: 'Info',
}

export const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }

export const STATUS_LABELS: Record<VerificationStatus, string> = {
  conforme: 'Conforme',
  violation: 'Problèmes détectés',
  indéterminé: 'Indéterminé',
}

export const RESOLUTION_LABELS: Record<StopResolution, string> = {
  resolved: 'résolu',
  ambiguous: 'ambigu',
  not_found: 'introuvable',
}

export const CODE_LABELS: Record<IssueCode, string> = {
  place_closed_day: 'Fermé ce jour',
  place_not_operating: 'Fermé durablement',
  holiday_closure: 'Fermé (jour férié)',
  outside_opening_hours: 'Hors horaires',
  after_last_entry: 'Après la dernière entrée',
  travel_time_infeasible: 'Trajet impossible',
  stop_overlap: 'Chevauchement',
  insufficient_buffer: 'Marge insuffisante',
  fragmented_half_day: 'Demi-journée éclatée',
  overloaded_day: 'Journée surchargée',
  last_departure_missed: 'Dernier départ manqué',
}

export const REASON_LABELS: Record<UndeterminedReason, string> = {
  unknown: 'cause inconnue',
  missing_hours: 'horaires absents',
  invalid_syntax: 'horaires illisibles',
  invalid_timezone: 'fuseau invalide',
  invalid_context: 'contexte d’horaires invalide',
  invalid_local_time: 'heure locale inexistante',
  place_unresolved: 'lieu non résolu',
  missing_coordinates: 'coordonnées absentes',
  time_unknown: 'heure absente',
  date_unknown: 'date absente',
  transit_unavailable: 'trajet non calculable',
  unknown_mode: 'mode de transport inconnu',
  rule_error: 'erreur interne de règle',
}
