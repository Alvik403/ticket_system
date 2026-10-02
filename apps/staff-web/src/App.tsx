import { useEffect, useMemo, useState } from 'react'
import { auditPresentation } from './auditLabels'
import { ticketStatusLabel } from './labels'
import './staff.css'

const API = import.meta.env.VITE_API_URL ?? '/api'
const ERROR_TTL_MS = 30_000
let csrfToken = ''
const api = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  if (init?.method && !['GET', 'HEAD'].includes(init.method)) {
    headers.set('x-csrf-token', csrfToken)
  }
  return fetch(`${API}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  })
}

type View = 'work' | 'desks' | 'audit' | 'managers'
type AuditRow = {
  id: string
  action: string
  actorSubject: string
  targetId?: string
  occurredAt: string
  details?: Record<string, unknown>
}
type User = { subject: string; displayName: string; roles: string[]; csrfToken: string }
type Desk = {
  id: string
  label: string
  displayNumber?: number | null
  country: 'RF' | 'CN'
  active: boolean
  site: { id: string; name: string }
  employees: { id: string; displayName: string }[]
}
type AdminEmployee = {
  id: string | null
  keycloakId: string
  username: string
  displayName: string
  role: string
  status: string
  country: 'RF' | 'CN' | null
  desk: { id: string; label: string } | null
}
type BookingRow = {
  id: string
  number: string
  fullName?: string
  status: string
  kind?: 'booking' | 'walkIn'
  kindLabel?: string
  statusLabel?: string
  scheduledAt?: string
  slotTime?: string | null
  scheduledLabel?: string
  issuedLabel?: string
  departureDate?: string
  arrivalDate?: string
  country?: string
  deskLabel?: string
  statusHint?: string
  statusOptions?: Array<{ value: string; label: string; current?: boolean }>
  phone?: string
  openedAt?: string
  closedAt?: string
}

function managerSlotTimeLabel(row: BookingRow) {
  if (row.slotTime) return row.slotTime
  if (row.scheduledLabel) return row.scheduledLabel
  if (row.issuedLabel) return `Без слота · ${row.issuedLabel}`
  return '—'
}

const MANAGER_SETTLED_STATUSES = new Set(['NO_SHOW', 'COMPLETED', 'CANCELLED'])
const MANAGER_IN_PROGRESS_STATUSES = new Set(['CALLED', 'ASSIGNED', 'IN_SERVICE'])

function isManagerSettledRow(status: string) {
  return MANAGER_SETTLED_STATUSES.has(status)
}

function isManagerInProgressRow(status: string) {
  return MANAGER_IN_PROGRESS_STATUSES.has(status)
}

function statusActionClass(label: string) {
  if (label === 'Не явился') return 'status-action-danger'
  if (label === 'Вернуть в очередь' || label === 'Клиент пришёл') {
    return 'status-action-muted'
  }
  return 'status-action-primary'
}

function todayMoscow(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function countryLabel(country: 'RF' | 'CN') {
  return country === 'RF' ? 'РФ' : 'Заграничная'
}

function formatDateTime(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatPhoneDisplay(phone?: string) {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) {
    return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
  }
  return phone
}

async function readApiError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { message?: string | string[] } | null
  if (!payload?.message) return fallback
  return Array.isArray(payload.message) ? payload.message.join(', ') : payload.message
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [view, setView] = useState<View>('work')
  const [error, setError] = useState('')
  const [auditEvents, setAuditEvents] = useState<AuditRow[]>([])
  const [desks, setDesks] = useState<Desk[]>([])
  const [employees, setEmployees] = useState<AdminEmployee[]>([])
  const [creatingDesk, setCreatingDesk] = useState(false)
  const [newDeskLabel, setNewDeskLabel] = useState('')
  const [newDeskCountry, setNewDeskCountry] = useState<'RF' | 'CN'>('RF')
  const [newDeskNumber, setNewDeskNumber] = useState('')
  const [newDeskSiteId, setNewDeskSiteId] = useState('')
  const [countryPending, setCountryPending] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(todayMoscow)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [managerCountry, setManagerCountry] = useState<'RF' | 'CN' | null>(null)
  const [bookingsLoading, setBookingsLoading] = useState(false)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [statusPending, setStatusPending] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [newManagerUsername, setNewManagerUsername] = useState('')
  const [newManagerFirstName, setNewManagerFirstName] = useState('')
  const [newManagerLastName, setNewManagerLastName] = useState('')
  const [newManagerEmail, setNewManagerEmail] = useState('')
  const [creatingManager, setCreatingManager] = useState(false)
  const [passwordReveal, setPasswordReveal] = useState<{
    username: string
    temporaryPassword: string
    title: string
  } | null>(null)

  useEffect(() => {
    api('/auth/me')
      .then(async (response) => {
        if (!response.ok) {
          setUser(null)
          return
        }
        const value = (await response.json()) as User
        csrfToken = value.csrfToken
        setUser(value)
      })
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    if (user === null) window.location.assign(`${API}/auth/login`)
  }, [user])

  const isAdmin = Boolean(user?.roles.includes('ADMIN'))
  const isAuditor = Boolean(user?.roles.includes('AUDITOR'))
  const isEmployee = Boolean(user?.roles.includes('EMPLOYEE'))
  const showSidebar = isAdmin || (isAuditor && !isEmployee)

  useEffect(() => {
    if (showSidebar) {
      setView((current) => (current === 'work' ? 'desks' : current))
    }
  }, [showSidebar])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(''), ERROR_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!user || showSidebar) return
    setBookingsLoading(true)
    api(`/employee/bookings?date=${selectedDate}`)
      .then(async (response) => {
        if (!response.ok) {
          setError('Не удалось загрузить записи')
          setBookings([])
          return
        }
        const payload = (await response.json()) as
          | BookingRow[]
          | { managerCountry?: 'RF' | 'CN' | null; bookings?: BookingRow[] }
        if (Array.isArray(payload)) {
          setManagerCountry(null)
          setBookings(payload)
          return
        }
        setManagerCountry(payload.managerCountry ?? null)
        setBookings(payload.bookings ?? [])
      })
      .catch(() => {
        setError('Не удалось загрузить записи')
        setBookings([])
      })
      .finally(() => setBookingsLoading(false))
  }, [user, selectedDate, showSidebar])

  async function reloadBookings() {
    if (!user || showSidebar) return
    setBookingsLoading(true)
    try {
      const response = await api(`/employee/bookings?date=${selectedDate}`)
      if (!response.ok) {
        setError('Не удалось загрузить записи')
        setBookings([])
        return
      }
      const payload = (await response.json()) as
        | BookingRow[]
        | { managerCountry?: 'RF' | 'CN' | null; bookings?: BookingRow[] }
      const rows = Array.isArray(payload) ? payload : (payload.bookings ?? [])
      if (Array.isArray(payload)) {
        setManagerCountry(null)
      } else {
        setManagerCountry(payload.managerCountry ?? null)
      }
      setBookings(rows)
      setSelectedBookingId((current) =>
        current && rows.some((row) => row.id === current) ? current : null,
      )
    } catch {
      setError('Не удалось загрузить записи')
      setBookings([])
    } finally {
      setBookingsLoading(false)
    }
  }

  useEffect(() => {
    if (!showSidebar || view !== 'audit') return
    setError('')
    api('/auditor/audit?limit=100')
      .then(async (response) => {
        if (!response.ok) {
          setError('Не удалось загрузить журнал')
          return
        }
        setAuditEvents(await response.json())
      })
      .catch(() => setError('Не удалось загрузить журнал'))
  }, [view, showSidebar])

  useEffect(() => {
    if (!isAdmin || (view !== 'desks' && view !== 'managers')) return
    void reloadAdminData()
  }, [view, isAdmin])

  async function reloadAdminData() {
    setError('')
    const [desksRes, managersRes, sitesRes] = await Promise.all([
      api('/admin/desks'),
      api('/admin/managers'),
      api('/admin/sites'),
    ])
    if (!desksRes.ok || !managersRes.ok || !sitesRes.ok) {
      setError('Не удалось загрузить данные')
      return
    }
    const siteRows = await sitesRes.json()
    setDesks(await desksRes.json())
    setEmployees(await managersRes.json())
    if (siteRows[0]) setNewDeskSiteId(siteRows[0].id)
  }

  async function reloadDesksData() {
    await reloadAdminData()
  }

  async function createDesk() {
    if (!newDeskLabel.trim() || !newDeskSiteId) return
    setError('')
    const parsedNumber = newDeskNumber.trim() === '' ? undefined : Number(newDeskNumber)
    if (
      parsedNumber !== undefined &&
      (!Number.isInteger(parsedNumber) || parsedNumber < 1 || parsedNumber > 99)
    ) {
      setError('Номер стола на табло — целое число от 1 до 99')
      return
    }
    const response = await api('/admin/desks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: newDeskLabel.trim(),
        siteId: newDeskSiteId,
        country: newDeskCountry,
        displayNumber: parsedNumber,
      }),
    })
    if (!response.ok) {
      setError('Не удалось создать стол')
      return
    }
    setNewDeskLabel('')
    setNewDeskNumber('')
    setCreatingDesk(false)
    await reloadDesksData()
  }

  async function saveDeskNumber(deskId: string, raw: string) {
    setError('')
    const displayNumber = raw.trim() === '' ? null : Number(raw)
    if (
      displayNumber !== null &&
      (!Number.isInteger(displayNumber) || displayNumber < 1 || displayNumber > 99)
    ) {
      setError('Номер стола на табло — целое число от 1 до 99')
      return
    }
    const response = await api(`/admin/desks/${deskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayNumber }),
    })
    if (!response.ok) {
      setError(await readApiError(response, 'Не удалось сохранить номер стола'))
      return
    }
    await reloadDesksData()
  }

  async function deleteDeskItem(desk: Desk) {
    if (!window.confirm(`Удалить «${desk.label}»?`)) return
    setError('')
    const response = await api(`/admin/desks/${desk.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось удалить стол')
      return
    }
    await reloadDesksData()
  }

  async function assignEmployeeToDesk(deskId: string, employeeId: string) {
    setError('')
    if (!employeeId) {
      const assignedIds = new Set<string>()
      for (const employee of employees) {
        if (employee.id && employee.desk?.id === deskId) assignedIds.add(employee.id)
      }
      for (const employee of desks.find((desk) => desk.id === deskId)?.employees ?? []) {
        assignedIds.add(employee.id)
      }
      const results = await Promise.all(
        [...assignedIds].map((id) =>
          api(`/admin/employees/${id}/desk`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deskId: null }),
          }),
        ),
      )
      const failed = results.find((response) => !response.ok)
      if (failed) {
        setError('Не удалось снять сотрудника со стола')
        return
      }
      await reloadDesksData()
      return
    }
    const response = await api(`/admin/employees/${employeeId}/desk`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deskId }),
    })
    if (!response.ok) {
      setError('Не удалось назначить сотрудника')
      return
    }
    await reloadDesksData()
  }

  async function assignEmployeeCountry(keycloakId: string, country: 'RF' | 'CN') {
    const employee = employees.find((row) => row.keycloakId === keycloakId)
    if (employee?.country === country) return
    setError('')
    setCountryPending(keycloakId)
    const response = await api(`/admin/managers/${keycloakId}/country`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country }),
    })
    setCountryPending(null)
    if (!response.ok) {
      setError(await readApiError(response, 'Не удалось изменить направление'))
      return
    }
    const updated = await response.json() as {
      id: string
      country: 'RF' | 'CN'
      desk: { id: string; label: string } | null
    }
    setEmployees((rows) =>
      rows.map((row) =>
        row.keycloakId === keycloakId
          ? {
              ...row,
              id: updated.id ?? row.id,
              country: updated.country,
              desk: updated.desk ?? null,
            }
          : row,
      ),
    )
    await reloadDesksData()
  }

  async function createManagerAccount() {
    if (!newManagerUsername.trim() || !newManagerFirstName.trim() || !newManagerLastName.trim()) {
      return
    }
    setError('')
    setCreatingManager(true)
    const response = await api('/admin/managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: newManagerUsername.trim(),
        firstName: newManagerFirstName.trim(),
        lastName: newManagerLastName.trim(),
        email: newManagerEmail.trim() || undefined,
      }),
    })
    setCreatingManager(false)
    if (!response.ok) {
      setError(await readApiError(response, 'Не удалось создать менеджера'))
      return
    }
    const created = await response.json() as {
      username: string
      temporaryPassword: string
    }
    setNewManagerUsername('')
    setNewManagerFirstName('')
    setNewManagerLastName('')
    setNewManagerEmail('')
    setPasswordReveal({
      username: created.username,
      temporaryPassword: created.temporaryPassword,
      title: 'Менеджер создан',
    })
    await reloadAdminData()
  }

  async function setBookingStatus(ticketId: string, status: string) {
    const current = bookings.find((row) => row.id === ticketId)
    if (!current || current.status === status) return
    setError('')
    setStatusMessage('')
    setStatusPending(true)
    const response = await api(`/employee/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setStatusPending(false)
    if (!response.ok) {
      const message = await readApiError(response, 'Не удалось изменить статус')
      setStatusMessage(message)
      return
    }
    await response.json()
    await reloadBookings()
    setStatusMessage('')
  }

  async function resetManagerPassword(keycloakId: string, username: string) {
    setError('')
    const response = await api(`/admin/managers/${keycloakId}/reset-password`, {
      method: 'POST',
    })
    if (!response.ok) {
      setError(await readApiError(response, 'Не удалось сбросить пароль'))
      return
    }
    const reset = await response.json() as { temporaryPassword: string }
    setPasswordReveal({
      username,
      temporaryPassword: reset.temporaryPassword,
      title: 'Временный пароль',
    })
  }

  const statusFilterOptions = useMemo(() => {
    const statuses = new Map<string, string>()
    for (const row of bookings) {
      if (!statuses.has(row.status)) {
        statuses.set(
          row.status,
          row.statusLabel ?? ticketStatusLabel[row.status] ?? row.status,
        )
      }
    }
    return [...statuses.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], 'ru'),
    )
  }, [bookings])

  const filteredBookings = useMemo(() => {
    if (statusFilter === 'ALL') return bookings
    return bookings.filter((row) => row.status === statusFilter)
  }, [bookings, statusFilter])

  if (!user) return <main className="loading">Переход к форме входа…</main>

  const selectedBooking =
    bookings.find((row) => row.id === selectedBookingId) ?? null

  return (
    <div className={`shell${showSidebar ? '' : ' shell-employee'}`}>
      {showSidebar && (
        <aside>
          <div className="profile">
            <span className="eyebrow">Рабочий кабинет</span>
            <h2>{user.displayName}</h2>
            <span className="role-badge">{isAdmin ? 'Администратор' : 'Аудитор'}</span>
          </div>
          <nav>
            {isAdmin && (
              <button className={view === 'desks' ? 'active' : ''} onClick={() => setView('desks')}>
                Столы
              </button>
            )}
            <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}>
              История действий
            </button>
            {isAdmin && (
              <button className={view === 'managers' ? 'active' : ''} onClick={() => setView('managers')}>
                Менеджеры
              </button>
            )}
          </nav>
          <button type="button" className="logout-button" onClick={() => { window.location.href = `${API}/auth/logout` }}>
            Выйти
          </button>
        </aside>
      )}

      <div className="content-column">
        {!showSidebar && (
          <header className="top-bar">
            <div className="top-bar-center">
              <h1>{user.displayName}</h1>
            </div>
            <div className="top-bar-actions">
              <button
                type="button"
                className="logout-top"
                onClick={() => { window.location.href = `${API}/auth/logout` }}
              >
                Выйти
              </button>
            </div>
          </header>
        )}

        <main>
          {view === 'work' && !showSidebar && (
            <div className="work-screen manager-schedule">
              <header className="page-header page-header-compact">
                <div className="page-header-titles">
                  <h1>Записи и живая очередь</h1>
                  {managerCountry && (
                    <p className="manager-lane-label">
                      Направление: {countryLabel(managerCountry)}
                    </p>
                  )}
                </div>
                <div className="manager-list-filters">
                  <label className="date-picker-inline">
                    Дата
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(event) => {
                        setSelectedDate(event.target.value)
                        setSelectedBookingId(null)
                      }}
                    />
                  </label>
                  <label className="date-picker-inline">
                    Статус
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="ALL">Все</option>
                      {statusFilterOptions.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </header>

              <div className="manager-layout">
                <section className="manager-bookings-panel">
                  <ul className="manager-bookings-list">
                    {filteredBookings.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={`manager-booking-btn${selectedBookingId === row.id ? ' selected' : ''}${isManagerInProgressRow(row.status) ? ' in-progress' : ''}${isManagerSettledRow(row.status) ? ' settled' : ''}`}
                          onClick={() => {
                            setSelectedBookingId(row.id)
                            setStatusMessage('')
                          }}
                        >
                          <span className="manager-booking-name">{row.fullName ?? 'Без ФИО'}</span>
                          <span className="manager-booking-number">Талон {row.number}</span>
                          <span className="manager-booking-time">
                            {managerSlotTimeLabel(row)}
                          </span>
                          <span className={`status-badge status-${row.status.toLowerCase()}`}>
                            {row.statusLabel ?? ticketStatusLabel[row.status] ?? row.status}
                          </span>
                        </button>
                      </li>
                    ))}
                    {!bookings.length && !bookingsLoading && !managerCountry && (
                      <li className="manager-bookings-empty">
                        Направление не задано. Администратор должен выбрать РФ или Заграничная
                        в разделе «Менеджеры».
                      </li>
                    )}
                    {!filteredBookings.length &&
                      bookings.length > 0 &&
                      !bookingsLoading && (
                      <li className="manager-bookings-empty">
                        Нет талонов с выбранным статусом
                      </li>
                    )}
                    {!bookings.length && !bookingsLoading && managerCountry && (
                      <li className="manager-bookings-empty">
                        На выбранную дату талонов по направлению «{countryLabel(managerCountry)}»
                        нет
                      </li>
                    )}
                    {bookingsLoading && (
                      <li className="manager-bookings-empty">Загрузка…</li>
                    )}
                  </ul>
                </section>

                <section className="client-panel">
                  {selectedBooking ? (
                    <article className="client-card">
                      <div className="number">{selectedBooking.number}</div>
                      <h2>{selectedBooking.fullName ?? '—'}</h2>
                      <p className="client-detail">
                        Телефон: {formatPhoneDisplay(selectedBooking.phone)}
                      </p>
                      <p className="client-detail">
                        Слот: {formatDateLabel(selectedDate)},{' '}
                        {managerSlotTimeLabel(selectedBooking)}
                      </p>
                      <p className="client-detail">
                        Выезд: {selectedBooking.departureDate ?? '—'} · Приезд:{' '}
                        {selectedBooking.arrivalDate ?? '—'}
                      </p>
                      <p className="client-detail">
                        Талон открыт: {formatDateTime(selectedBooking.openedAt)}
                      </p>
                      <p className="client-detail">
                        Талон закрыт: {formatDateTime(selectedBooking.closedAt)}
                      </p>
                      <p className="client-detail">
                        {selectedBooking.country === 'CN' ? 'Заграничная' : 'РФ'}
                        {selectedBooking.deskLabel ? ` · ${selectedBooking.deskLabel}` : ''}
                      </p>
                      <div className="status-field">
                        <span className="status-field-label">Статус</span>
                        <p className="status-current">
                          {selectedBooking.statusLabel ??
                            ticketStatusLabel[selectedBooking.status] ??
                            selectedBooking.status}
                        </p>
                        <div className="status-actions">
                          {(selectedBooking.statusOptions ?? [])
                            .filter((option) => !option.current)
                            .map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={statusActionClass(option.label)}
                                disabled={statusPending}
                                onClick={() =>
                                  void setBookingStatus(selectedBooking.id, option.value)
                                }
                              >
                                {option.label}
                              </button>
                            ))}
                        </div>
                        {statusMessage && (
                          <p className="status-error" role="alert">
                            {statusMessage}
                          </p>
                        )}
                      </div>
                    </article>
                  ) : (
                    <article className="client-card client-card-muted">
                      <h2>Выберите запись</h2>
                      <p>Нажмите на строку в списке, чтобы увидеть ФИО, талон и даты.</p>
                    </article>
                  )}
                </section>
              </div>
            </div>
          )}

          {view === 'audit' && showSidebar && (
            <>
              <header className="page-header">
                <div>
                  <span className="eyebrow">Контроль</span>
                  <h1>История действий</h1>
                </div>
              </header>
              <section className="audit-list">
                {auditEvents.map((row) => {
                  const presentation = auditPresentation(row.action)
                  const detailCountry =
                    typeof row.details?.country === 'string'
                      ? row.details.country === 'CN'
                        ? 'Заграничная'
                        : 'РФ'
                      : null
                  const detailUsername =
                    typeof row.details?.username === 'string'
                      ? row.details.username
                      : null
                  return (
                    <article key={row.id} className={`audit-row audit-tone-${presentation.tone}`}>
                      <span className={`audit-badge audit-badge-${presentation.tone}`}>
                        {presentation.label}
                      </span>
                      <div className="audit-meta">
                        <span>{row.actorSubject}</span>
                        {detailUsername && <span>@{detailUsername}</span>}
                        {detailCountry && <span>{detailCountry}</span>}
                        {row.targetId && !detailUsername && (
                          <span className="audit-target">{row.targetId.slice(0, 8)}…</span>
                        )}
                        <time>{new Date(row.occurredAt).toLocaleString('ru-RU')}</time>
                      </div>
                    </article>
                  )
                })}
                {!auditEvents.length && <p className="muted">Записей пока нет</p>}
              </section>
            </>
          )}

          {view === 'desks' && isAdmin && (
            <>
              <header className="page-header page-header-compact">
                <h1>Столы</h1>
              </header>

              <section className="desk-board">
                {desks.map((desk) => (
                  <article key={desk.id} className="desk-card">
                    <button
                      type="button"
                      className="desk-delete"
                      aria-label={`Удалить ${desk.label}`}
                      onClick={() => void deleteDeskItem(desk)}
                    >
                      ×
                    </button>
                    <span className="desk-label">{desk.label}</span>
                    <span className={`desk-country desk-country-${desk.country.toLowerCase()}`}>
                      {countryLabel(desk.country)}
                    </span>
                    <label className="desk-assign">
                      № на табло
                      <input
                        type="number"
                        min={1}
                        max={99}
                        key={`${desk.id}-${desk.displayNumber ?? ''}`}
                        defaultValue={desk.displayNumber ?? ''}
                        placeholder="1–99"
                        onBlur={(event) => void saveDeskNumber(desk.id, event.target.value)}
                      />
                    </label>
                    <label className="desk-assign">
                      Менеджер
                      <select
                        value={desk.employees[0]?.id ?? ''}
                        onChange={(event) =>
                          void assignEmployeeToDesk(desk.id, event.target.value)
                        }
                      >
                        <option value="">Не назначен</option>
                        {employees
                          .filter((employee) =>
                            employee.id &&
                            employee.role !== 'ADMIN' &&
                            (!employee.country || employee.country === desk.country) &&
                            (!employee.desk || employee.desk.id === desk.id),
                          )
                          .map((employee) => (
                            <option key={employee.id!} value={employee.id!}>
                              {employee.displayName}
                            </option>
                          ))}
                      </select>
                    </label>
                  </article>
                ))}

                {!creatingDesk ? (
                  <button
                    type="button"
                    className="desk-card desk-add"
                    onClick={() => setCreatingDesk(true)}
                  >
                    <span className="desk-plus">+</span>
                    <span>Добавить стол</span>
                  </button>
                ) : (
                  <article className="desk-card desk-create">
                    <label>
                      Название
                      <input
                        autoFocus
                        value={newDeskLabel}
                        placeholder="Стол РФ-3"
                        onChange={(event) => setNewDeskLabel(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void createDesk()
                          if (event.key === 'Escape') {
                            setCreatingDesk(false)
                            setNewDeskLabel('')
                            setNewDeskNumber('')
                          }
                        }}
                      />
                    </label>
                    <label>
                      Направление
                      <select
                        value={newDeskCountry}
                        onChange={(event) => setNewDeskCountry(event.target.value as 'RF' | 'CN')}
                      >
                        <option value="RF">РФ</option>
                        <option value="CN">Заграничная</option>
                      </select>
                    </label>
                    <label>
                      № на табло
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={newDeskNumber}
                        placeholder="1–99"
                        onChange={(event) => setNewDeskNumber(event.target.value)}
                      />
                    </label>
                    <div className="desk-create-actions">
                      <button
                        type="button"
                        onClick={() => void createDesk()}
                        disabled={!newDeskLabel.trim()}
                      >
                        Создать
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setCreatingDesk(false)
                          setNewDeskLabel('')
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  </article>
                )}
              </section>

              {!desks.length && !creatingDesk && (
                <p className="desk-hint muted">Пока нет столов — нажмите «+», чтобы создать первый</p>
              )}
            </>
          )}

          {view === 'managers' && isAdmin && (
            <>
              <header className="page-header page-header-compact">
                <h1>Менеджеры</h1>
              </header>
              <section className="employees-panel">
                <div className="manager-create-form">
                  <h2>Новый менеджер</h2>
                  <p className="muted">
                    Создаётся учётная запись Keycloak с временным паролем. При первом входе потребуется смена пароля.
                  </p>
                  <div className="manager-create-grid">
                    <label>
                      Логин
                      <input
                        value={newManagerUsername}
                        onChange={(event) => setNewManagerUsername(event.target.value)}
                        placeholder="rf3"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Имя
                      <input
                        value={newManagerFirstName}
                        onChange={(event) => setNewManagerFirstName(event.target.value)}
                      />
                    </label>
                    <label>
                      Фамилия
                      <input
                        value={newManagerLastName}
                        onChange={(event) => setNewManagerLastName(event.target.value)}
                      />
                    </label>
                    <label>
                      Email (необяз.)
                      <input
                        value={newManagerEmail}
                        onChange={(event) => setNewManagerEmail(event.target.value)}
                        placeholder="manager@example.com"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={creatingManager || !newManagerUsername.trim()}
                    onClick={() => void createManagerAccount()}
                  >
                    {creatingManager ? 'Создание…' : 'Создать менеджера'}
                  </button>
                </div>

                <ul className="employees-list">
                  {employees.filter((employee) => employee.role !== 'ADMIN').map((employee) => (
                    <li key={employee.keycloakId}>
                      <div className="employee-main">
                        <div className="employee-info">
                          <strong>{employee.displayName}</strong>
                          <span>Логин: {employee.username}</span>
                          <span>{employee.desk ? `Стол: ${employee.desk.label}` : 'Стол не назначен'}</span>
                        </div>
                        <div className="employee-actions">
                          <div className="country-toggle">
                            <span className="country-toggle-label">Направление</span>
                            <div className="country-toggle-buttons">
                              {(['RF', 'CN'] as const).map((country) => (
                                <button
                                  key={country}
                                  type="button"
                                  className={employee.country === country ? 'active' : ''}
                                  disabled={countryPending === employee.keycloakId}
                                  onClick={() => void assignEmployeeCountry(employee.keycloakId, country)}
                                >
                                  {countryLabel(country)}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              void resetManagerPassword(employee.keycloakId, employee.username)
                            }
                          >
                            Сбросить пароль
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {passwordReveal && (
            <div className="modal-backdrop" role="presentation" onClick={() => setPasswordReveal(null)}>
              <div
                className="modal-card"
                role="dialog"
                aria-modal="true"
                onClick={(event) => event.stopPropagation()}
              >
                <h2>{passwordReveal.title}</h2>
                <p className="muted">Сохраните пароль — он показывается один раз. При входе Keycloak попросит задать новый.</p>
                <dl className="password-reveal">
                  <div><dt>Логин</dt><dd>{passwordReveal.username}</dd></div>
                  <div><dt>Временный пароль</dt><dd><code>{passwordReveal.temporaryPassword}</code></dd></div>
                </dl>
                <button type="button" onClick={() => setPasswordReveal(null)}>Понятно</button>
              </div>
            </div>
          )}

          {error && <div className="error" role="alert">{error}</div>}
        </main>
      </div>
    </div>
  )
}

export default App
