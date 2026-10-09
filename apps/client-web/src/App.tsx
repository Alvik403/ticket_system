import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { BookingCalendar } from './BookingCalendar'
import { countryLabel, ticketStatusLabel } from './labels'
import { contactFieldsError } from './person'
import {
  formatPhoneInput,
  normalizePhoneDigits,
} from './phone'
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
type Tab = 'book' | 'find'
type Ticket = {
  id?: string
  number: string
  status: string
  kind?: 'booking' | 'walkIn'
  statusLabel?: string
  progressStep?: number
  progressLabels?: string[]
  showDesk?: boolean
  serviceName: string
  deskLabel?: string
  createdAt: string
  scheduledAt?: string
  scheduledLabel?: string
  durationMinutes?: number
  country?: Country
  fullName?: string
  phone?: string
  departureDate?: string
  arrivalDate?: string
  closedAt?: string
  clientNotice?: string
  servedBy?: string
  lookupCode?: string
  canCheckIn?: boolean
  queuePosition?: number
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

function HoldTimer({
  hold,
  seconds,
  onRefresh,
}: {
  hold: Hold | null
  seconds: number
  onRefresh: () => void
}) {
  if (!hold || seconds <= 0) return null
  return (
    <div className="hold-timer">
      <span>Слот забронирован на {formatHoldTime(seconds)}</span>
      {hold.canRefresh && (
        <button type="button" className="secondary" onClick={onRefresh}>
          Продлить
        </button>
      )}
    </div>
  )
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

function openDatePicker(event: MouseEvent<HTMLLabelElement>) {
  const input = event.currentTarget.querySelector('input[type="date"]')
  if (!(input instanceof HTMLInputElement)) return
  input.focus()
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker()
    } catch {
      input.click()
    }
  }
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
  const [phone, setPhone] = useState('')
  const [departureDate, setDepartureDate] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState('')
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
        const params = new URLSearchParams(window.location.search)
        const wantedSite = params.get('site')
        const wantedDate = params.get('date')
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
        setSelectedDate(
          wantedDate && bookingDates.includes(wantedDate)
            ? wantedDate
            : bookingDates[0],
        )
        if (service) setServiceTypeId(service)

        if (current?.number) {
          setTicket(current)
          setTab('book')
          setStep(5)
          setError('')
        }
      } catch {
        setError('Сервис временно недоступен')
      } finally {
        setLoading(false)
      }
    }

    void bootstrap()
  }, [])

  const ticketNumber = ticket?.number

  useEffect(() => {
    if (!ticketNumber) return
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
  }, [ticketNumber])

  useEffect(() => {
    if (!siteId || !selectedDate || !country || step < 2 || step > 4) return
    let active = true
    const load = (initial: boolean) => {
      if (initial) setLoadingSlots(true)
      fetch(
        `${API}/public/sites/${siteId}/slots?date=${selectedDate}&country=${country}`,
      )
        .then(async (response) => {
          if (!response.ok) throw new Error('slots')
          return response.json() as Promise<Slot[]>
        })
        .then((value) => {
          if (!active) return
          const now = Date.now()
          const upcoming = value.filter(
            (slot) => new Date(slot.scheduledAt).getTime() > now,
          )
          setSlots(upcoming)
          setError((current) =>
            current === 'Не удалось загрузить свободное время' ? '' : current,
          )
          setSelectedSlot((current) => {
            const match = upcoming.find(
              (slot) => slot.scheduledAt === current?.scheduledAt,
            )
            return match &&
              (match.available || hold?.scheduledAt === match.scheduledAt)
              ? { ...match, available: true }
              : null
          })
        })
        .catch(() => {
          if (active && initial) setError('Не удалось загрузить свободное время')
        })
        .finally(() => {
          if (active && initial) setLoadingSlots(false)
        })
    }
    load(true)
    const timer = window.setInterval(() => load(false), 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [siteId, selectedDate, country, step, hold?.scheduledAt])

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
  const phoneNormalized = normalizePhoneDigits(phone)
  const contactError = contactFieldsError({
    lastName,
    firstName,
    patronymic,
    phoneDigits: phoneNormalized,
    country,
    departureDate,
    arrivalDate,
    requireTravelDates: true,
  })

  const availableCount = useMemo(
    () => slots.filter((slot) => slot.available || slot.scheduledAt === hold?.scheduledAt).length,
    [slots, hold?.scheduledAt],
  )

  const durationLabel = useMemo(() => {
    if (country === 'RF') return '20 минут'
    if (country === 'CN') return '30 минут'
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

  function continueToConfirm() {
    if (contactError || !hold) {
      setError(contactError ?? 'Выберите время снова')
      return
    }
    setError('')
    setStep(4)
  }

  async function createTicket() {
    setError('')
    if (contactError) {
      setError(contactError)
      setStep(3)
      return
    }
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
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        patronymic: patronymic.trim(),
        phone: phoneNormalized,
        departureDate,
        arrivalDate,
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
    setPhone('')
    setDepartureDate('')
    setArrivalDate('')
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
      </nav>

      <main className="page">
        {loading ? (
          <section className="panel loading-panel">Загрузка…</section>
        ) : tab === 'book' ? (
          ticket && step === 5 ? (
            <section className="panel ticket-panel" aria-live="polite">
              <div className="ticket-card">
                <span className="ticket-card-label">
                  {ticket.kind === 'walkIn' ? 'Ваш талон' : 'Ваша запись'}
                </span>
                <div className="ticket-number">{ticket.number}</div>
                <p className="ticket-save-hint muted">
                  Сфотографируйте или запишите свой талончик
                </p>
                {ticket.progressLabels?.length ? (
                  <ol className="ticket-progress">
                    {ticket.progressLabels.map((label, index) => (
                      <li
                        key={label}
                        className={
                          index <= (ticket.progressStep ?? 0) ? 'done' : undefined
                        }
                      >
                        {label}
                      </li>
                    ))}
                  </ol>
                ) : null}
                <span className={`ticket-status ${ticketStatusClass(ticket.status)}`}>
                  {ticket.statusLabel ?? ticketStatusLabel[ticket.status] ?? ticket.status}
                </span>

                <div className="ticket-details">
                  <p className="ticket-client-name">{ticket.fullName}</p>
                  {ticket.phone && (
                    <p className="ticket-phone muted">
                      Телефон: {formatPhoneInput(ticket.phone)}
                    </p>
                  )}
                  {ticket.kind !== 'walkIn' && (
                    <p className="ticket-schedule">{formatScheduledDisplay(ticket)}</p>
                  )}
                  <p className="ticket-tags">
                    {countryLabel[ticket.country ?? 'RF']} · {ticket.durationMinutes} мин
                  </p>
                  {ticket.showDesk && ticket.deskLabel && (
                    <p className="ticket-desk-line">Стол: {ticket.deskLabel}</p>
                  )}
                  {ticket.lookupCode && (
                    <p className="ticket-lookup">
                      Код восстановления: <strong>{ticket.lookupCode}</strong>
                    </p>
                  )}
                  {ticket.kind === 'walkIn' &&
                  ['CHECKED_IN', 'REQUEUED', 'ASSIGNED'].includes(ticket.status) &&
                  ticket.queuePosition ? (
                    <p className="ticket-queue">Место в очереди: {ticket.queuePosition}</p>
                  ) : null}
                  {ticket.kind === 'booking' &&
                  ['CHECKED_IN', 'REQUEUED', 'ASSIGNED'].includes(ticket.status) ? (
                    <p className="ticket-queue muted">
                      Стол занят — ожидайте, когда освободится
                    </p>
                  ) : null}
                </div>

                {ticket.clientNotice && (
                  <div className="notice-banner">{ticket.clientNotice}</div>
                )}
                {ticket.showDesk && ticket.deskLabel && (
                  <div className="desk-banner">
                    <span>{ticket.kind === 'walkIn' ? 'Вас вызывают к' : 'Подойдите к'}</span>
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
                {[
                  { label: 'Направление', short: 'Напр.' },
                  { label: 'Дата и время', short: 'Время' },
                  { label: 'Данные', short: 'Данные' },
                  { label: 'Подтверждение', short: 'Готово' },
                ].map((item, index) => (
                  <li key={item.label} className={step > index ? 'done' : step === index + 1 ? 'current' : ''}>
                    <span>{index + 1}</span>
                    <small data-short={item.short}>{item.label}</small>
                  </li>
                ))}
              </ol>

              {step === 1 && (
                <div className="step-body">
                  <h2>Выберите направление</h2>
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
                  <div className="step-actions step-actions-single">
                    <button disabled={!canNextStep2} onClick={() => {
                      setLoadingSlots(true)
                      setSlots([])
                      setStep(2)
                    }}>Далее</button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="step-body">
                  <h2>Выберите дату и время</h2>
                  <HoldTimer hold={hold} seconds={holdSeconds} onRefresh={() => void refreshHold()} />
                  <div className="booking-datetime-layout">
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
                            Свободно: {availableCount}
                          </p>
                          <div className="slot-grid slot-grid-compact">
                            {slots
                              .filter(
                                (slot) =>
                                  slot.available ||
                                  hold?.scheduledAt === slot.scheduledAt,
                              )
                              .map((slot) => {
                              const held = hold?.scheduledAt === slot.scheduledAt
                              return (
                                <button
                                  key={slot.scheduledAt}
                                  type="button"
                                  className={`slot${held ? ' selected' : ''}`}
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
                  <HoldTimer hold={hold} seconds={holdSeconds} onRefresh={() => void refreshHold()} />
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
                  <div className="travel-dates-row">
                    <label className="date-field" onClick={openDatePicker}>
                      Дата выезда
                      <span className="date-field-input-wrap">
                        <input
                          type="date"
                          value={departureDate}
                          onChange={(event) => setDepartureDate(event.target.value)}
                          onClick={(event) => {
                            const input = event.currentTarget
                            if (typeof input.showPicker === 'function') {
                              try {
                                input.showPicker()
                              } catch {
                                /* ignore */
                              }
                            }
                          }}
                        />
                      </span>
                    </label>
                    <label className="date-field" onClick={openDatePicker}>
                      Дата приезда
                      <span className="date-field-input-wrap">
                        <input
                          type="date"
                          value={arrivalDate}
                          min={departureDate || undefined}
                          onChange={(event) => setArrivalDate(event.target.value)}
                          onClick={(event) => {
                            const input = event.currentTarget
                            if (typeof input.showPicker === 'function') {
                              try {
                                input.showPicker()
                              } catch {
                                /* ignore */
                              }
                            }
                          }}
                        />
                      </span>
                    </label>
                  </div>
                  <label className="hp" aria-hidden="true">
                    Сайт
                    <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                  </label>
                  <p className={`form-alert${error ? '' : ' is-empty'}`} role="alert">
                    {error}
                  </p>
                  <div className="step-actions">
                    <button className="secondary" onClick={() => setStep(2)}>Назад</button>
                    <button type="button" onClick={continueToConfirm}>Далее</button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="step-body">
                  <h2>Подтверждение</h2>
                  <HoldTimer hold={hold} seconds={holdSeconds} onRefresh={() => void refreshHold()} />
                  <dl className="summary">
                    <div><dt>Услуга</dt><dd>Предоставление и сдача маршрутного листа</dd></div>
                    <div><dt>Направление</dt><dd>{countryLabel[country as Country]}</dd></div>
                    <div><dt>Длительность</dt><dd>{durationLabel}</dd></div>
                    <div><dt>Дата и время</dt><dd>{formatDateLabel(selectedDate)}, {selectedSlot?.time}</dd></div>
                    <div><dt>Фамилия</dt><dd>{lastName}</dd></div>
                    <div><dt>Имя</dt><dd>{firstName}</dd></div>
                    <div><dt>Отчество</dt><dd>{patronymic}</dd></div>
                    <div><dt>Телефон</dt><dd>{phone || '—'}</dd></div>
                    <div><dt>Дата выезда</dt><dd>{departureDate || '—'}</dd></div>
                    <div><dt>Дата приезда</dt><dd>{arrivalDate || '—'}</dd></div>
                  </dl>
                  <p className={`form-alert${error ? '' : ' is-empty'}`} role="alert">
                    {error}
                  </p>
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
              Введите цифры номера талона и код восстановления с карточки записи.
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
                  onChange={(event) =>
                    setLookupNumber(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="001"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
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
              <button type="submit" disabled={lookupLoading || lookupNumber.length < 1 || lookupCode.trim().length !== 6}>
                {lookupLoading ? 'Ищем…' : 'Открыть запись'}
              </button>
            </form>
          </section>
        ) : null}

        {ticket?.clientNotice && tab !== 'book' && (
          <div className="notice-banner floating-notice">{ticket.clientNotice}</div>
        )}

        {error && !(tab === 'book' && (step === 3 || step === 4)) && (
          <div className="error" role="alert">{error}</div>
        )}
      </main>
    </div>
  )
}

export default App
