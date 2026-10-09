import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toDataURL } from 'qrcode'
import { contactFieldsError } from './person'
import {
  formatPhoneInput,
  normalizePhoneDigits,
} from './phone'
import './queue.css'
import './kiosk.css'

const API = import.meta.env.VITE_API_URL ?? '/api'

type SlotRow = {
  time: string
  scheduledAt: string
  available: boolean
}

let publicCsrfToken = ''

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function ensurePublicCsrf(): Promise<string> {
  if (publicCsrfToken) return publicCsrfToken
  const value = await fetchJson<{ csrfToken: string }>(`${API}/public/csrf`)
  publicCsrfToken = value.csrfToken
  return publicCsrfToken
}

async function readApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { message?: string | string[] }
    | null
  if (!payload?.message) return fallback
  return Array.isArray(payload.message) ? payload.message.join(', ') : payload.message
}

function todayMoscow(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function bookingUrl(origin: string, date: string, siteCode: string) {
  const url = new URL(`${origin}/client/`)
  url.searchParams.set('date', date)
  if (siteCode) url.searchParams.set('site', siteCode)
  return url.toString()
}

export default function Kiosk() {
  const today = todayMoscow()
  const [siteId, setSiteId] = useState('')
  const [siteCode, setSiteCode] = useState('')
  const [serviceTypeId, setServiceTypeId] = useState('')
  const [dates, setDates] = useState<string[]>([])
  const [qrSrc, setQrSrc] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [country, setCountry] = useState<'RF' | 'CN'>('RF')
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string>('')
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [patronymic, setPatronymic] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const [ticketSlotLabel, setTicketSlotLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const bookingDate = useMemo(() => {
    if (dates.includes(today)) return today
    return dates[0] ?? today
  }, [dates, today])

  useEffect(() => {
    async function bootstrap() {
      try {
        const [sites, bookingDates] = await Promise.all([
          fetchJson<Array<{ id: string; code: string }>>(`${API}/public/sites`),
          fetchJson<string[]>(`${API}/public/booking/dates`),
          ensurePublicCsrf(),
        ])
        const site = sites[0]
        if (!site) throw new Error('no site')
        const services = await fetchJson<Array<{ id: string }>>(
          `${API}/public/sites/${site.id}/services`,
        )
        setSiteId(site.id)
        setSiteCode(site.code)
        setDates(bookingDates)
        if (services[0]?.id) setServiceTypeId(services[0].id)
      } catch {
        setError('Сервис временно недоступен')
      }
    }
    void bootstrap()
    const timer = window.setInterval(() => {
      void fetchJson<string[]>(`${API}/public/booking/dates`)
        .then(setDates)
        .catch(() => undefined)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!bookingDate) return
    const url = bookingUrl(window.location.origin, bookingDate, siteCode)
    void toDataURL(url, {
      width: 420,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then(setQrSrc)
  }, [bookingDate, siteCode])

  useEffect(() => {
    if (!siteId || !formOpen) return
    let active = true
    const load = (initial: boolean) => {
      if (initial) {
        setSlotsLoading(true)
        setError('')
      }
      void fetchJson<SlotRow[]>(
        `${API}/public/sites/${siteId}/slots?date=${today}&country=${country}`,
      )
        .then((rows) => {
          if (!active) return
          const now = Date.now()
          const upcoming = rows.filter(
            (row) => new Date(row.scheduledAt).getTime() > now,
          )
          setSlots(upcoming)
          setSelectedSlot((current) => {
            if (
              upcoming.some((row) => row.scheduledAt === current && row.available)
            ) {
              return current
            }
            return upcoming.find((row) => row.available)?.scheduledAt ?? ''
          })
        })
        .catch(() => {
          if (active && initial) setError('Не удалось загрузить слоты на сегодня')
        })
        .finally(() => {
          if (active && initial) setSlotsLoading(false)
        })
    }
    load(true)
    const timer = window.setInterval(() => load(false), 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [siteId, country, formOpen, today])

  useEffect(() => {
    if (!ticketNumber) return
    const timer = window.setTimeout(() => {
      setTicketNumber('')
      setTicketSlotLabel('')
      setFormOpen(false)
      resetForm()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [ticketNumber])

  function resetForm() {
    setLastName('')
    setFirstName('')
    setPatronymic('')
    setPhone('')
    setConsent(false)
    setHoneypot('')
    setSelectedSlot('')
    setCountry('RF')
    setError('')
  }

  const fullName = [lastName, firstName, patronymic]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  const phoneNormalized = normalizePhoneDigits(phone)
  const contactError = contactFieldsError({
    lastName,
    firstName,
    patronymic,
    phoneDigits: phoneNormalized,
  })

  async function issueTicket(event: FormEvent) {
    event.preventDefault()
    if (loading) return
    if (!consent) {
      setError('Необходимо согласие на обработку персональных данных')
      return
    }
    if (contactError || !selectedSlot || !siteId || !serviceTypeId) {
      setError(contactError ?? 'Выберите свободное время')
      return
    }
    setLoading(true)
    setError('')
    try {
      const csrf = await ensurePublicCsrf()
      const response = await fetch(`${API}/public/tickets/walk-in`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({
          siteId,
          serviceTypeId,
          country,
          fullName,
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          patronymic: patronymic.trim(),
          phone: phoneNormalized,
          scheduledAt: selectedSlot,
          personalDataConsent: true,
          website: honeypot,
        }),
      })
      if (!response.ok) {
        setError(await readApiError(response, 'Не удалось выдать талон'))
        return
      }
      const payload = (await response.json()) as {
        number?: string
        scheduledLabel?: string
        ignored?: boolean
      }
      if (payload.ignored || !payload.number) {
        resetForm()
        setFormOpen(false)
        return
      }
      setTicketNumber(payload.number)
      setTicketSlotLabel(payload.scheduledLabel ?? '')
    } catch {
      setError('Не удалось выдать талон')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="kiosk-shell">
      <header className="kiosk-header">
        <strong>Электронная очередь</strong>
        <span>Киоск · {formatDateLabel(today)}</span>
      </header>

      <main className="kiosk-split">
        <section className="kiosk-pane kiosk-walkin">
          {ticketNumber ? (
            <div className="kiosk-ticket">
              <p>Ваш талон</p>
              <strong>{ticketNumber.replace(/^.*-/, '')}</strong>
              <span>{ticketNumber}</span>
              <p className="kiosk-ticket-save-hint">
                Сфотографируйте или запишите свой талончик
              </p>
              {ticketSlotLabel && (
                <p className="kiosk-ticket-slot">Подойдите в {ticketSlotLabel}</p>
              )}
              <button
                type="button"
                className="kiosk-primary"
                onClick={() => {
                  setTicketNumber('')
                  setTicketSlotLabel('')
                  setFormOpen(false)
                  resetForm()
                }}
              >
                Готово
              </button>
            </div>
          ) : formOpen ? (
            <form className="kiosk-form" onSubmit={(event) => void issueTicket(event)}>
              <div className="kiosk-form-scroll">
              <h1>Очередь на сегодня</h1>
              <p className="kiosk-form-lead">
                Выберите свободное время и укажите телефон — подойдите к этому слоту.
              </p>
              <div className="choice-grid">
                <button
                  type="button"
                  className={`choice-card${country === 'RF' ? ' selected' : ''}`}
                  onClick={() => setCountry('RF')}
                >
                  <strong>РФ</strong>
                </button>
                <button
                  type="button"
                  className={`choice-card${country === 'CN' ? ' selected' : ''}`}
                  onClick={() => setCountry('CN')}
                >
                  <strong>Заграничная</strong>
                </button>
              </div>
              <fieldset className="kiosk-slots">
                <legend>Свободное время</legend>
                {slotsLoading && <p className="kiosk-slots-hint">Загрузка слотов…</p>}
                {!slotsLoading && !slots.some((row) => row.available) && (
                  <p className="kiosk-slots-hint">На сегодня свободных слотов нет</p>
                )}
                <div className="kiosk-slot-grid">
                  {slots
                    .filter((row) => row.available)
                    .map((row) => (
                    <button
                      key={row.scheduledAt}
                      type="button"
                      className={`kiosk-slot-btn${
                        selectedSlot === row.scheduledAt ? ' selected' : ''
                      }`}
                      onClick={() => setSelectedSlot(row.scheduledAt)}
                    >
                      {row.time}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="name-grid">
                <label>
                  Фамилия
                  <input
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Иванов"
                    autoComplete="family-name"
                    autoFocus
                  />
                </label>
                <label>
                  Имя
                  <input
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="Иван"
                    autoComplete="given-name"
                  />
                </label>
                <label>
                  Отчество
                  <input
                    value={patronymic}
                    onChange={(event) => setPatronymic(event.target.value)}
                    placeholder="Иванович"
                    autoComplete="additional-name"
                  />
                </label>
              </div>
              <label>
                Телефон
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(formatPhoneInput(event.target.value, phone))}
                  placeholder="+7 (900) 000-00-00"
                  autoComplete="tel"
                />
              </label>
              <label className="kiosk-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                Согласие на обработку персональных данных
              </label>
              <label className="hp" aria-hidden="true">
                Сайт
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              </label>
              </div>
              <p
                className={`kiosk-form-error${error ? '' : ' is-empty'}`}
                role="alert"
              >
                {error}
              </p>
              <div className="kiosk-form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setFormOpen(false)
                    resetForm()
                  }}
                >
                  Назад
                </button>
                <button type="submit" disabled={loading}>
                  {loading ? 'Выдаём…' : 'Получить талон'}
                </button>
              </div>
            </form>
          ) : (
            <div className="kiosk-cta">
              <p>Запишитесь в очередь на сегодня</p>
              <button type="button" className="kiosk-primary" onClick={() => setFormOpen(true)}>
                Получить талончик
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="kiosk-pane kiosk-qr">
          <p>Записаться на другой день</p>
          {qrSrc ? (
            <img src={qrSrc} alt="QR-код для записи на другой день" />
          ) : (
            <div className="kiosk-qr-placeholder">Готовим QR…</div>
          )}
          <span>Наведите камеру, чтобы выбрать время</span>
        </section>
      </main>
    </div>
  )
}
