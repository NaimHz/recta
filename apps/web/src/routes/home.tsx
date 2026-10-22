import { useEffect, useState } from 'react'

type HealthState = 'loading' | 'ok' | 'error'

const labels: Record<HealthState, string> = {
  loading: 'Vérification de l’API…',
  ok: 'API connectée',
  error: 'API injoignable',
}

export function Home() {
  const [health, setHealth] = useState<HealthState>('loading')

  useEffect(() => {
    let cancelled = false

    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(() => {
        if (!cancelled) setHealth('ok')
      })
      .catch(() => {
        if (!cancelled) setHealth('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="page">
      <p className="eyebrow">Recta</p>
      <h1>Le plan est peut-être faux. On vérifie.</h1>
      <p className="lede">
        Colle un itinéraire, quelle que soit sa source. On te dit ce qui ne tient pas — horaires,
        trajets, dernier train — avec la preuve. Puis on propose une version corrigée.
      </p>
      <div className="status" role="status" aria-live="polite">
        <span className="dot" data-state={health} aria-hidden="true" />
        {labels[health]}
      </div>
      <p className="footnote">Fact-check ton itinéraire.</p>
    </main>
  )
}
