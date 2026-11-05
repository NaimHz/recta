import { useEffect, useState, type FormEvent } from 'react'
import { fetchCities, verifyPlan } from '../verify/api'
import { ReportView } from '../verify/report-view'
import type { City, VerifyResponse } from '../verify/types'

type HealthState = 'loading' | 'ok' | 'error'

const labels: Record<HealthState, string> = {
  loading: 'Vérification de l’API…',
  ok: 'API connectée',
  error: 'API injoignable',
}

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!running) return

    setSeconds(0)
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [running])

  return seconds
}

export function Home() {
  const [health, setHealth] = useState<HealthState>('loading')
  const [cities, setCities] = useState<City[]>([])
  const [text, setText] = useState('')
  const [cityId, setCityId] = useState('')
  const [start, setStart] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VerifyResponse | null>(null)
  const elapsed = useElapsedSeconds(pending)

  useEffect(() => {
    let cancelled = false

    fetchCities()
      .then((list) => {
        if (cancelled) return
        setCities(list)
        setCityId((current) => current || (list[0]?.id ?? ''))
        setHealth('ok')
      })
      .catch(() => {
        if (!cancelled) setHealth('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setResult(null)

    try {
      setResult(await verifyPlan({ text, cityId, start: start === '' ? null : start }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="page">
      <p className="eyebrow">Recta</p>
      <h1>Le plan est peut-être faux. On vérifie.</h1>
      <div className="status" role="status" aria-live="polite">
        <span className="dot" data-state={health} aria-hidden="true" />
        {labels[health]}
      </div>

      <form className="verify-form" onSubmit={submit}>
        <label htmlFor="plan-text">Itinéraire</label>
        <textarea
          id="plan-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Colle ici le plan, tel quel."
          rows={14}
          required
        />
        <div className="fields">
          <div className="field">
            <label htmlFor="plan-city">Ville</label>
            <select
              id="plan-city"
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              required
            >
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="plan-start">Premier jour (facultatif)</label>
            <input
              id="plan-start"
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <button type="submit" disabled={pending || text.trim() === '' || cityId === ''}>
            {pending ? `Vérification… ${elapsed} s` : 'Vérifier'}
          </button>
        </div>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? <ReportView result={result} /> : null}
    </main>
  )
}
