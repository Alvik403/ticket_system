import { useEffect, useMemo, useState } from 'react'
import { BookingCalendar } from './BookingCalendar'
import { countryLabel, ticketStatusLabel } from './labels'
import './queue.css'

const API = import.meta.env.VITE_API_URL ?? '/api'
const ERROR_TTL_MS = 30_000

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

type Country = 'RF' | 'CN'
type Tab = 'book' | 'find' | 'schedule' | 'privacy'
type Ticket = {
  id?: string
  number: string
  status: string
  serviceName: string
  deskLabel?: string
  createdAt: string
  scheduledAt?: string
  scheduledLabel?: string
  durationMinutes?: number
  country?: Country
  fullName?: string
  travelHistory?: string
  clientNotice?: string
  servedBy?: string
  lookupCode?: string
  canCheckIn?: boolean
  queuePosition?: number
}
type ScheduleRow = {
  scheduledAt: string
  durationMinutes: number
  occupied: boolean
}
type Slot = { time: string; scheduledAt: string; available: boolean }
type Hold = {
  holdId: string
  deskId: string
  scheduledAt: string
  expiresAt: string
  expiresInSeconds: number
  canRefresh: boolean
}

async function fetchCurrentTicket(): Promise<Ticket | null> {
  try {
    const response = await fetch(`${API}/public/tickets/current`, {
      credentials: 'include',
    })
    if (response.status === 404) return null
    if (!response.ok) return null
    const value = (await response.json()) as Ticket | null
    return value?.number ? value : null
  } catch {
    return null
  }
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  })
}

function formatTimeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatHoldTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatScheduledDisplay(ticket: Ticket): string {
  if (ticket.scheduledLabel) {
    return ticket.scheduledLabel.replace(',', ' в')
  }
  if (!ticket.scheduledAt) return '—'
  const date = new Date(ticket.scheduledAt).toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
  })
  const time = formatTimeLabel(ticket.scheduledAt)
  return `${date} в ${time}`
}

function ticketStatusClass(status: string): string {
  if (['BOOKED', 'WAITING'].includes(status)) return 'muted'
  if (['CHECKED_IN', 'REQUEUED', 'ASSIGNED'].includes(status)) return 'waiting'
  if (status === 'CALLED') return 'called'
  if (status === 'IN_SERVICE') return 'active'
  if (status === 'COMPLETED') return 'done'
  return 'muted'
}

function App() {
  const [tab, setTab] = useState<Tab>('book')
  const [step, setStep] = useState(1)
  const [siteId, setSiteId] = useState('')
  const [serviceTypeId, setServiceTypeId] = useState('')
  const [country, setCountry] = useState<Country | ''>('')
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [hold, setHold] = useState<Hold | null>(null)
  const [holdSeconds, setHoldSeconds] = useState(0)
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [patronymic, setPatronymic] = useState('')
  const [travelHistory, setTravelHistory] = useState('')
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [checkInLoading, setCheckInLoading] = useState(false)
  const [lookupNumber, setLookupNumber] = useState('')
  const [lookupCode, setLookupCode] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(''), ERROR_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    async function bootstrap() {
      try {
        const wantedSite = new URLSearchParams(window.location.search).get('site')
        const [sites, bookingDates, current] = await Promise.all([
          fetchJson<Array<{ id: string; code: string }>>(`${API}/public/sites`),
          fetchJson<string[]>(`${API}/public/booking/dates`),
          fetchCurrentTicket(),
          ensurePublicCsrf(),
        ])

        const site = wantedSite
          ? sites.find((row) => row.code === wantedSite)
          : sites[0]
        if (!site) throw new Error('no site')
        if (!Array.isArray(bookingDates) || !bookingDates.length) {
          throw new Error('no dates')
        }

        const services = await fetchJson<Array<{ id: string }>>(
          `${API}/public/sites/${site.id}/services`,
        )
        const service = services[0]?.id ?? ''

        setSiteId(site.id)
        setDates(bookingDates)
        setScheduleDate(bookingDates[0])
        setSelectedDate(bookingDates[0])
        if (service) setServiceTypeId(service)

        if (current?.number) {
          setTicket(current)
          setTab('book')
          setStep(5)
        }
      } catch {
        setError('Сервис временно недоступен')
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  useEffect(() => {
    if (!ticket) return
    const events = new EventSource(`${API}/public/tickets/events`, {
      withCredentials: true,
    })
    events.onmessage = (event) => {
      const value = JSON.parse(event.data) as Ticket
      setTicket((current) => ({
        ...value,
        lookupCode: current?.lookupCode ?? value.lookupCode,
      }))
      if (value.clientNotice) setError('')
    }
    return () => events.close()
  }, [ticket?.number])

  useEffect(() => {
    if (!siteId || !selectedDate || !country || step < 2) return
    setLoadingSlots(true)
    fetch(
      `${API}/public/sites/${siteId}/slots?date=${selectedDate}&country=${country}`,
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('slots')
        return response.json() as Promise<Slot[]>
      })
      .then((value) => {
        setSlots(value)
        setSelectedSlot((current) => {
          const match = value.find((slot) => slot.scheduledAt === current?.scheduledAt)
          return match && (match.available || hold?.scheduledAt === match.scheduledAt)
            ? { ...match, available: true }
            : null
        })
      })
      .catch(() => setError('Не удалось загрузить свободное время'))
      .finally(() => setLoadingSlots(false))
  }, [siteId, selectedDate, country, step, hold?.scheduledAt])

  useEffect(() => {
    if (tab !== 'schedule' || !siteId || !scheduleDate) return
    setLoadingSchedule(true)
    fetch(`${API}/public/schedule?siteId=${siteId}&date=${scheduleDate}`)
      .then(async (response) => (response.ok ? response.json() : []))
      .then(setSchedule)
      .catch(() => setError('Не удалось загрузить очередь'))
      .finally(() => setLoadingSchedule(false))
  }, [tab, siteId, scheduleDate])

  useEffect(() => {
    if (!hold) {
      setHoldSeconds(0)
      return
    }
    const tick = () => {
      const left = Math.max(
        0,
        Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000),
      )
      setHoldSeconds(left)
      if (left <= 0) {
        setHold(null)
        setSelectedSlot(null)
        if (step === 3 || step === 4) {
          setStep(2)
          setError('Время брони слота истекло, выберите время снова')
        }
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [hold, step])

  const canNextStep2 = Boolean(country)
  const canNextStep3 = Boolean(selectedDate && selectedSlot && hold)
  const fullName = useMemo(
    () => [lastName, firstName, patronymic].map((part) => part.trim()).filter(Boolean).join(' '),
    [lastName, firstName, patronymic],
  )
  const canSubmit =
    lastName.trim().length >= 2 &&
    firstName.trim().length >= 2 &&
    (country === 'CN' || patronymic.trim().length >= 2) &&
    travelHistory.trim().length >= 2 &&
    consent &&
    Boolean(hold)

  const availableCount = useMemo(
    () => slots.filter((slot) => slot.available || slot.scheduledAt === hold?.scheduledAt).length,
    [slots, hold?.scheduledAt],
  )

  const durationLabel = useMemo(() => {
    if (country === 'RF') return '10 минут'
    if (country === 'CN') return '20 минут'
    return ''
  }, [country])

  async function holdSelectedSlot(slot: Slot) {
    if (!siteId || !country) return
    setError('')
    setSelectedSlot(slot)
    const response = await fetch(`${API}/public/slots/hold`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': await ensurePublicCsrf(),
      },
      body: JSON.stringify({
        siteId,
        country,
        scheduledAt: slot.scheduledAt,
      }),
    })
    if (!response.ok) {
      setSelectedSlot(null)
      setHold(null)
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Это время уже занято, выберите другое')
      return
    }
    setHold(await response.json())
  }

  async function refreshHold() {
    if (!hold?.canRefresh) return
    const response = await fetch(`${API}/public/slots/hold/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': await ensurePublicCsrf(),
      },
      body: JSON.stringify({ holdId: hold.holdId }),
    })
    if (!response.ok) {
      setError('Продлить бронь слота больше нельзя')
      return
    }
    setHold(await response.json())
  }

  async function createTicket() {
    setError('')
    if (!siteId || !serviceTypeId || !country || !selectedSlot || !hold) return
    const response = await fetch(`${API}/public/tickets`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': await ensurePublicCsrf(),
      },
      body: JSON.stringify({
        siteId,
        serviceTypeId,
        country,
        fullName: fullName.trim(),
        travelHistory: travelHistory.trim(),
        scheduledAt: selectedSlot.scheduledAt,
        holdId: hold.holdId,
        personalDataConsent: true,
        website: honeypot,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось создать запись')
      if (response.status === 409) {
        setHold(null)
        setSelectedSlot(null)
        setStep(2)
      }
      return
    }
    const value = await response.json()
    if (value.ignored) return
    setHold(null)
    setTicket(value)
    setStep(5)
  }

  async function checkIn() {
    if (!ticket || checkInLoading) return
    setCheckInLoading(true)
    try {
      const response = await fetch(`${API}/public/tickets/current/check-in`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': await ensurePublicCsrf() },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null
        setError(payload?.message ?? 'Сейчас нельзя отметить явку')
        return
      }
      const value = await response.json()
      setTicket((current) => ({
        ...value,
        lookupCode: current?.lookupCode ?? value.lookupCode,
      }))
    } finally {
      setCheckInLoading(false)
    }
  }

  async function findTicket() {
    if (lookupLoading) return
    setLookupLoading(true)
    setError('')
    try {
      const response = await fetch(`${API}/public/tickets/lookup`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': await ensurePublicCsrf(),
        },
        body: JSON.stringify({
          number: lookupNumber.trim(),
          lookupCode: lookupCode.trim().toUpperCase(),
        }),
      })
      if (!response.ok) {
        setError('Запись не найдена. Проверьте номер и код.')
        return
      }
      const value = await response.json()
      setTicket(value)
      setTab('book')
      setStep(5)
    } finally {
      setLookupLoading(false)
    }
  }

  async function cancelTicket() {
    if (!ticket || cancelLoading) return
    setCancelLoading(true)
    try {
      await fetch(`${API}/public/tickets/current`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': await ensurePublicCsrf() },
      })
      setCancelConfirmOpen(false)
      resetBooking()
    } finally {
      setCancelLoading(false)
    }
  }

  function resetBooking() {
    setTicket(null)
    setStep(1)
    setCountry('')
    setSelectedSlot(null)
    setHold(null)
    setLastName('')
    setFirstName('')
    setPatronymic('')
    setTravelHistory('')
    setConsent(false)
  }

  function HoldTimer() {
    if (!hold || holdSeconds <= 0) return null
    return (
      <div className="hold-timer">
        <span>Слот забронирован на {formatHoldTime(holdSeconds)}</span>
        {hold.canRefresh && (
          <button type="button" className="secondary" onClick={() => void refreshHold()}>
            Продлить
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand">
          <strong>Электронная очередь</strong>
          <span>Предоставление и сдача маршрутного листа</span>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'book' ? 'active' : ''} onClick={() => setTab('book')}>
          Запись
        </button>
        <button className={tab === 'find' ? 'active' : ''} onClick={() => setTab('find')}>
          Найти запись
        </button>
        <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>
          Занятость
        </button>
        <button className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}>
          Персональные данные
        </button>
      </nav>

      <main className="page">
        {loading ? (
          <section className="panel loading-panel">Загрузка…</section>
        ) : tab === 'book' ? (
          ticket && step === 5 ? (
            <section className="panel ticket-panel" aria-live="polite">
              <div className="ticket-card">
                <span className="ticket-card-label">Ваша запись</span>
                <div className="ticket-number">{ticket.number}</div>
                <span className={`ticket-status ${ticketStatusClass(ticket.status)}`}>
                  {ticketStatusLabel[ticket.status] ?? ticket.status}
                </span>

                <div className="ticket-details">
                  <p className="ticket-client-name">{ticket.fullName}</p>
                  <p className="ticket-schedule">{formatScheduledDisplay(ticket)}</p>
                  <p className="ticket-tags">
                    {countryLabel[ticket.country ?? 'RF']} · {ticket.durationMinutes} мин
                  </p>
                  {ticket.deskLabel && (
                    <p className="ticket-desk-line">Стол: {ticket.deskLabel}</p>
                  )}
                  {ticket.lookupCode && (
                    <p className="ticket-lookup">
                      Код восстановления: <strong>{ticket.lookupCode}</strong>
                    </p>
                  )}
                  {ticket.status === 'CHECKED_IN' && ticket.queuePosition ? (
                    <p className="ticket-queue">Место в очереди: {ticket.queuePosition}</p>
                  ) : null}
                </div>

                {ticket.clientNotice && (
                  <div className="notice-banner">{ticket.clientNotice}</div>
                )}
                {ticket.status !== 'BOOKED' && ticket.deskLabel && (
                  <div className="desk-banner">
                    <span>Подойдите к</span>
                    <strong>{ticket.deskLabel}</strong>
                  </div>
                )}

                <div className="ticket-actions">
                  {ticket.canCheckIn && (
                    <button type="button" disabled={checkInLoading} onClick={() => void checkIn()}>
                      {checkInLoading ? 'Отмечаем…' : 'Я на месте'}
                    </button>
                  )}
                  {!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ticket.status) && (
                    <button
                      type="button"
                      className="danger-outline"
                      onClick={() => setCancelConfirmOpen(true)}
                    >
                      Отменить запись
                    </button>
                  )}
                  {['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ticket.status) && (
                    <button type="button" onClick={resetBooking}>Новая запись</button>
                  )}
                </div>
              </div>

              {cancelConfirmOpen && (
                <div className="modal-backdrop" role="presentation" onClick={() => setCancelConfirmOpen(false)}>
                  <div
                    className="modal-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="cancel-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h3 id="cancel-title">Отменить запись?</h3>
                    <p>
                      Запись <strong>{ticket.number}</strong> на {formatScheduledDisplay(ticket)} будет отменена.
                    </p>
                    <div className="modal-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={cancelLoading}
                        onClick={() => setCancelConfirmOpen(false)}
                      >
                        Нет, оставить
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={cancelLoading}
                        onClick={() => void cancelTicket()}
                      >
                        {cancelLoading ? 'Отмена…' : 'Да, отменить'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section className="panel">
              <ol className="steps-bar">
                {['Страна', 'Дата и время', 'Данные', 'Подтверждение'].map((label, index) => (
                  <li key={label} className={step > index ? 'done' : step === index + 1 ? 'current' : ''}>
                    <span>{index + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>

              {step === 1 && (
                <div className="step-body">
                  <h2>Выберите страну</h2>
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
                      <strong>Китай</strong>
                    </button>
                  </div>
                  <button disabled={!canNextStep2} onClick={() => {
                    setLoadingSlots(true)
                    setSlots([])
                    setStep(2)
                  }}>Далее</button>
                </div>
              )}

              {step === 2 && (
                <div className="step-body">
                  <h2>Выберите дату и время</h2>
                  <HoldTimer />
                  <BookingCalendar
                    availableDates={dates}
                    value={selectedDate}
                    onChange={(date) => {
                      setSelectedDate(date)
                      setSelectedSlot(null)
                      setHold(null)
                    }}
                  />
                  <div className="slot-section">
                    {loadingSlots ? (
                      <p className="muted">Загрузка времени…</p>
                    ) : slots.length ? (
                      <>
                        <p className="slot-hint muted">
                          Свободно: {availableCount} из {slots.length}
                        </p>
                        <div className="slot-grid">
                          {slots.map((slot) => {
                            const held = hold?.scheduledAt === slot.scheduledAt
                            return (
                              <button
                                key={slot.scheduledAt}
                                type="button"
                                disabled={!slot.available && !held}
                                className={`slot${!slot.available && !held ? ' unavailable' : ''}${held ? ' selected' : ''}`}
                                onClick={() => void holdSelectedSlot(slot)}
                              >
                                {slot.time}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    ) : (
                      <p className="muted">На эту дату нет доступных интервалов</p>
                    )}
                  </div>
                  <div className="step-actions">
                    <button className="secondary" onClick={() => setStep(1)}>Назад</button>
                    <button disabled={!canNextStep3} onClick={() => setStep(3)}>Далее</button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="step-body">
                  <h2>Контактные данные</h2>
                  <HoldTimer />
                  <div className="name-grid">
                    <label>
                      Фамилия
                      <input
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        placeholder="Иванов"
                        autoComplete="family-name"
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
                      Отчество{country === 'CN' ? ' (необязательно)' : ''}
                      <input
                        value={patronymic}
                        onChange={(event) => setPatronymic(event.target.value)}
                        placeholder={country === 'CN' ? 'Если есть' : 'Иванович'}
                        autoComplete="additional-name"
                      />
                    </label>
                  </div>
                  <label>
                    Поездки (куда ездили)
                    <textarea
                      rows={4}
                      value={travelHistory}
                      onChange={(event) => setTravelHistory(event.target.value)}
                      placeholder="Укажите страны и даты поездок"
                    />
                  </label>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    <span>
                      Даю согласие на обработку персональных данных (ФИО и сведения о поездках)
                      для записи на приём. Срок хранения — 90 дней.{' '}
                      <button type="button" className="link-button" onClick={() => setTab('privacy')}>
                        Подробнее
                      </button>
                    </span>
                  </label>
                  <label className="hp" aria-hidden="true">
                    Сайт
                    <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                  </label>
                  <div className="step-actions">
                    <button className="secondary" onClick={() => setStep(2)}>Назад</button>
                    <button disabled={!canSubmit} onClick={() => setStep(4)}>Далее</button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="step-body">
                  <h2>Подтверждение</h2>
                  <HoldTimer />
                  <dl className="summary">
                    <div><dt>Услуга</dt><dd>Предоставление и сдача маршрутного листа</dd></div>
                    <div><dt>Страна</dt><dd>{countryLabel[country as Country]}</dd></div>
                    <div><dt>Длительность</dt><dd>{durationLabel}</dd></div>
                    <div><dt>Дата и время</dt><dd>{formatDateLabel(selectedDate)}, {selectedSlot?.time}</dd></div>
                    <div><dt>Фамилия</dt><dd>{lastName}</dd></div>
                    <div><dt>Имя</dt><dd>{firstName}</dd></div>
                    <div><dt>Отчество</dt><dd>{patronymic}</dd></div>
                    <div><dt>Поездки</dt><dd>{travelHistory}</dd></div>
                  </dl>
                  <div className="step-actions">
                    <button className="secondary" onClick={() => setStep(3)}>Назад</button>
                    <button onClick={() => void createTicket()}>Получить талон</button>
                  </div>
                </div>
              )}
            </section>
          )
        ) : tab === 'find' ? (
          <section className="panel">
            <h2>Найти запись</h2>
            <p className="muted">
              Введите номер талона и код восстановления с карточки записи.
            </p>
            <form
              className="lookup-form"
              onSubmit={(event) => {
                event.preventDefault()
                void findTicket()
              }}
            >
              <label>
                Номер
                <input
                  value={lookupNumber}
                  onChange={(event) => setLookupNumber(event.target.value)}
                  placeholder="MAIN-001"
                  autoComplete="off"
                />
              </label>
              <label>
                Код
                <input
                  value={lookupCode}
                  onChange={(event) => setLookupCode(event.target.value.toUpperCase())}
                  placeholder="A3K7Q2"
                  maxLength={6}
                  autoComplete="off"
                />
              </label>
              <button type="submit" disabled={lookupLoading || lookupNumber.trim().length < 3 || lookupCode.trim().length !== 6}>
                {lookupLoading ? 'Ищем…' : 'Открыть запись'}
              </button>
            </form>
          </section>
        ) : tab === 'schedule' ? (
          <section className="panel">
            <div className="panel-head">
              <h2>Занятые окна</h2>
              <label className="field-select field-select-inline">
                <span className="sr-only">Дата</span>
                <select
                  className="select-control"
                  value={scheduleDate}
                  onChange={(event) => setScheduleDate(event.target.value)}
                  disabled={!dates.length}
                >
                  {!dates.length ? (
                    <option value="">Нет доступных дат</option>
                  ) : (
                    dates.map((date) => (
                      <option key={date} value={date}>{formatDateLabel(date)}</option>
                    ))
                  )}
                </select>
              </label>
            </div>
            <ul className="schedule-list">
              {schedule.map((row) => (
                <li key={row.scheduledAt}>
                  <span className="schedule-time">{formatTimeLabel(row.scheduledAt)}</span>
                  <div className="schedule-body">
                    <strong>Занято</strong>
                    <span>{row.durationMinutes} мин</span>
                  </div>
                </li>
              ))}
              {!schedule.length && (
                <li className="schedule-empty">
                  {loadingSchedule ? 'Загрузка…' : 'На этот день свободны все окна'}
                </li>
              )}
            </ul>
          </section>
        ) : (
          <section className="panel">
            <h2>Обработка персональных данных</h2>
            <p className="muted">
              Оператор обрабатывает ФИО и сведения о поездках только для записи на приём и
              обслуживания в окне. Данные хранятся в Российской Федерации. Срок хранения
              оперативных записей — 90 дней, журнала безопасности — 1 год.
            </p>
            <p className="muted">
              Без согласия запись не создаётся. Доступ к полным сведениям есть у сотрудника,
              который ведёт приём, и у администратора. Публичная страница показывает только
              занятость слотов без ФИО и номеров талонов.
            </p>
            <p className="muted">
              Документ носит информационно-технический характер и не заменяет локальные акты
              оператора. Перед пилотом оператор утверждает политику и при необходимости
              уведомляет Роскомнадзор.
            </p>
            <button className="secondary" onClick={() => setTab('book')}>К записи</button>
          </section>
        )}

        {ticket?.clientNotice && tab !== 'book' && (
          <div className="notice-banner floating-notice">{ticket.clientNotice}</div>
        )}

        {error && <div className="error" role="alert">{error}</div>}
      </main>
    </div>
  )
}

export default App
