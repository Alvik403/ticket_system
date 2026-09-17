import { useCallback, useEffect, useState } from 'react'
import {
  employeeStatusLabel,
  pluralClients,
  ticketStatusLabel,
} from './labels'
import './staff.css'

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'
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

type View = 'work' | 'stats' | 'desks' | 'audit'
type AuditRow = { id: string; action: string; actorSubject: string; targetId?: string; occurredAt: string }
type User = { subject: string; displayName: string; roles: string[]; csrfToken: string }
type Desk = {
  id: string
  label: string
  country: 'RF' | 'CN'
  active: boolean
  site: { id: string; name: string }
  employees: { id: string; displayName: string }[]
}
type AdminEmployee = {
  id: string
  displayName: string
  role: string
  status: string
  country: 'RF' | 'CN' | null
  desk: { id: string; label: string } | null
}
type Overview = {
  waiting: number
  inProgress: number
  completedToday: number
  cancelledToday: number
  noShowToday: number
  createdToday: number
  availableAgents: number
  activeDesks: number
  averageWaitSeconds: number
  averageHandlingSeconds: number
  hourly: { hour: string; count: number }[]
}
type Metric = {
  employeeId: string
  displayName: string
  completed: number
  averageHandlingSeconds: number
  medianHandlingSeconds: number
  p90HandlingSeconds: number
  averageWaitSeconds: number
  slaPercent: number
  noShowCount: number
}
type QueueTicket = {
  id: string
  number: string
  status: string
  createdAt: string
  scheduledAt?: string
  scheduledLabel?: string
  deskLabel?: string
  country?: string
  durationMinutes?: number
  canMarkNoShow?: boolean
  serviceType: { name: string }
  assignment?: { employeeName: string; deskLabel?: string }
}
type RescheduleSlot = { time: string; scheduledAt: string }
type BlockedSlotRow = {
  id: string
  employeeId: string
  employeeName?: string
  date: string
  startTime: string
  endTime: string
  reason?: string
}
type BlockDraft = { date: string; start: string; end: string; reason: string }
type Current = {
  employee: { displayName: string; status: string; desk?: { id?: string; label: string }; site?: { id: string } }
  assignment: {
    id: string
    ticket: {
      id: string
      number: string
      status: string
      fullName?: string
      travelHistory?: string
      scheduledAt?: string
      country?: string
      durationMinutes?: number
      serviceType: { name: string }
    }
    desk?: { label: string }
  } | null
  queue?: { waitingCount: number; availableAgents: number }
  queueTickets?: QueueTicket[]
  dayBookings?: QueueTicket[]
  queueEmptyReason?: 'NO_DESK' | 'NO_COUNTRY' | 'NO_CHECKED_IN' | null
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  const minutes = Math.floor(value / 60)
  const seconds = Math.round(value % 60)
  return minutes ? `${minutes} мин ${seconds} сек` : `${seconds} сек`
}


function formatSlotTime(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatHour(value: string) {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [current, setCurrent] = useState<Current | null>(null)
  const [view, setView] = useState<View>('work')
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [adminQueue, setAdminQueue] = useState<QueueTicket[]>([])
  const [auditEvents, setAuditEvents] = useState<AuditRow[]>([])
  const [desks, setDesks] = useState<Desk[]>([])
  const [employees, setEmployees] = useState<AdminEmployee[]>([])
  const [creatingDesk, setCreatingDesk] = useState(false)
  const [newDeskLabel, setNewDeskLabel] = useState('')
  const [newDeskCountry, setNewDeskCountry] = useState<'RF' | 'CN'>('RF')
  const [newDeskSiteId, setNewDeskSiteId] = useState('')
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleSlots, setRescheduleSlots] = useState<RescheduleSlot[]>([])
  const [rescheduleSlot, setRescheduleSlot] = useState('')
  const [bookingDates, setBookingDates] = useState<string[]>([])
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlotRow[]>([])
  const [blockDrafts, setBlockDrafts] = useState<Record<string, BlockDraft>>({})
  const [countryPending, setCountryPending] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const response = await api('/employee/current')
    if (response.ok) setCurrent(await response.json())
  }, [])

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

  useEffect(() => {
    if (user?.roles.includes('ADMIN') || (user?.roles.includes('AUDITOR') && !user.roles.includes('EMPLOYEE'))) {
      setView((currentView) => (currentView === 'work' ? 'stats' : currentView))
    }
  }, [user])

  useEffect(() => {
    if (!user || user.roles.includes('ADMIN') || (user.roles.includes('AUDITOR') && !user.roles.includes('EMPLOYEE'))) return
    void refresh()
    const events = new EventSource(`${API}/employee/events`, { withCredentials: true })
    events.onmessage = (event) => setCurrent(JSON.parse(event.data))
    events.onerror = () => void refresh()
    return () => events.close()
  }, [refresh, user])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(''), ERROR_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    const canViewStats = Boolean(user?.roles.includes('ADMIN') || user?.roles.includes('AUDITOR'))
    if (!canViewStats || (view !== 'stats' && view !== 'audit')) return
    setError('')
    const base = user?.roles.includes('ADMIN') ? '/admin' : '/auditor'
    const requests = view === 'audit'
      ? [api('/auditor/audit?limit=100')]
      : [
          api(`${base}/metrics/overview`),
          api(`${base}/metrics/employees`),
          ...(user?.roles.includes('ADMIN') ? [api('/admin/queue')] : []),
        ]
    Promise.all(requests)
      .then(async (responses) => {
        if (responses.some((response) => !response.ok)) {
          setError('Не удалось загрузить статистику')
          return
        }
        if (view === 'audit') {
          setAuditEvents(await responses[0].json())
          return
        }
        setOverview(await responses[0].json())
        setMetrics(await responses[1].json())
        if (responses[2]) setAdminQueue(await responses[2].json())
      })
      .catch(() => setError('Не удалось загрузить статистику'))
  }, [view, user])

  useEffect(() => {
    if (!user?.roles.includes('ADMIN') || view !== 'desks') return
    setError('')
    Promise.all([api('/admin/desks'), api('/admin/employees'), api('/admin/sites')])
      .then(async ([desksRes, employeesRes, sitesRes]) => {
        if (!desksRes.ok || !employeesRes.ok || !sitesRes.ok) {
          setError('Не удалось загрузить столы')
          return
        }
        const siteRows = await sitesRes.json()
        setDesks(await desksRes.json())
        setEmployees(await employeesRes.json())
        if (siteRows[0]) {
          setNewDeskSiteId(siteRows[0].id)
          const blocksRes = await api(`/admin/blocked-slots?siteId=${siteRows[0].id}`)
          if (blocksRes.ok) setBlockedSlots(await blocksRes.json())
        }
      })
      .catch(() => setError('Не удалось загрузить столы'))
  }, [view, user])

  useEffect(() => {
    if (!employees.length || !bookingDates[0]) return
    setBlockDrafts((prev) => {
      const next = { ...prev }
      for (const employee of employees) {
        if (employee.role === 'ADMIN') continue
        if (!next[employee.id]) {
          next[employee.id] = {
            date: bookingDates[0],
            start: '12:00',
            end: '13:00',
            reason: '',
          }
        }
      }
      return next
    })
  }, [employees, bookingDates])

  useEffect(() => {
    fetch(`${API}/public/booking/dates`)
      .then(async (response) => (response.ok ? response.json() : []))
      .then((dates: string[]) => {
        setBookingDates(dates)
        if (dates[0]) setRescheduleDate(dates[0])
        setBlockDrafts((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next)) {
            if (!next[key].date) next[key] = { ...next[key], date: dates[0] ?? '' }
          }
          return next
        })
      })
      .catch(() => setBookingDates([]))
  }, [])

  useEffect(() => {
    if (!rescheduleOpen || !current?.employee.site?.id || !rescheduleDate || !current?.assignment?.ticket.country) {
      return
    }
    fetch(
      `${API}/public/sites/${current.employee.site.id}/slots?date=${rescheduleDate}&country=${current.assignment.ticket.country}`,
    )
      .then(async (response) => (response.ok ? response.json() : []))
      .then(setRescheduleSlots)
      .catch(() => setRescheduleSlots([]))
  }, [rescheduleOpen, rescheduleDate, current?.employee.site?.id, current?.assignment?.ticket.country])

  async function setStatus(status: string) {
    setError('')
    const response = await api('/employee/status', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось изменить статус')
      return
    }
    await refresh()
  }

  async function action(name: string) {
    if (!current?.assignment) return
    setError('')
    const response = await api(`/employee/assignments/${current.assignment.id}/action`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ action: name }),
    })
    if (!response.ok) setError('Действие недоступно для текущего статуса')
    await refresh()
  }

  async function markNoShow(ticketId: string) {
    setError('')
    const response = await api(`/employee/tickets/${ticketId}/no-show`, {
      method: 'POST',
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось отметить неявку')
      return
    }
    await refresh()
    if (isAdmin) {
      const queueRes = await api('/admin/queue')
      if (queueRes.ok) setAdminQueue(await queueRes.json())
    }
  }

  async function reloadDesksData() {
    const [desksRes, employeesRes] = await Promise.all([
      api('/admin/desks'),
      api('/admin/employees'),
    ])
    if (desksRes.ok) setDesks(await desksRes.json())
    if (employeesRes.ok) setEmployees(await employeesRes.json())
  }

  async function createDesk() {
    if (!newDeskLabel.trim() || !newDeskSiteId) return
    setError('')
    const response = await api('/admin/desks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: newDeskLabel.trim(),
        siteId: newDeskSiteId,
        country: newDeskCountry,
      }),
    })
    if (!response.ok) {
      setError('Не удалось создать стол')
      return
    }
    setNewDeskLabel('')
    setCreatingDesk(false)
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
        if (employee.desk?.id === deskId) assignedIds.add(employee.id)
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
        const payload = await failed.json().catch(() => null) as { message?: string } | null
        setError(payload?.message ?? 'Не удалось снять сотрудника со стола')
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
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось назначить сотрудника')
      return
    }
    await reloadDesksData()
  }

  async function assignEmployeeCountry(employeeId: string, country: 'RF' | 'CN') {
    const employee = employees.find((row) => row.id === employeeId)
    if (employee?.country === country) return
    setError('')
    setCountryPending(employeeId)
    const response = await api(`/admin/employees/${employeeId}/country`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country }),
    })
    setCountryPending(null)
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось изменить направление')
      return
    }
    const updated = await response.json() as AdminEmployee
    setEmployees((rows) =>
      rows.map((row) =>
        row.id === employeeId
          ? { ...row, country: updated.country, desk: updated.desk ?? null }
          : row,
      ),
    )
    await reloadDesksData()
  }

  function employeeBlockDraft(employeeId: string): BlockDraft {
    return blockDrafts[employeeId] ?? {
      date: bookingDates[0] ?? '',
      start: '12:00',
      end: '13:00',
      reason: '',
    }
  }

  function updateBlockDraft(employeeId: string, patch: Partial<BlockDraft>) {
    setBlockDrafts((prev) => ({
      ...prev,
      [employeeId]: { ...employeeBlockDraft(employeeId), ...patch },
    }))
  }

  async function createBlockedSlot(employeeId: string) {
    if (!newDeskSiteId) return
    const draft = employeeBlockDraft(employeeId)
    if (!draft.date) return
    setError('')
    const response = await api('/admin/blocked-slots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: newDeskSiteId,
        employeeId,
        date: draft.date,
        startTime: draft.start,
        endTime: draft.end,
        reason: draft.reason.trim() || undefined,
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось создать блокировку')
      return
    }
    updateBlockDraft(employeeId, { reason: '' })
    const blocksRes = await api(`/admin/blocked-slots?siteId=${newDeskSiteId}`)
    if (blocksRes.ok) setBlockedSlots(await blocksRes.json())
  }

  function countryLabel(country: 'RF' | 'CN') {
    return country === 'RF' ? 'РФ' : 'Китай'
  }

  async function submitReschedule() {
    if (!assignment?.ticket.id || !rescheduleSlot) return
    setError('')
    const response = await api(`/employee/tickets/${assignment.ticket.id}/reschedule`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledAt: rescheduleSlot }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null
      setError(payload?.message ?? 'Не удалось перенести запись')
      return
    }
    setRescheduleOpen(false)
    await refresh()
  }

  async function removeBlockedSlot(id: string) {
    setError('')
    const response = await api(`/admin/blocked-slots/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      setError('Не удалось удалить блокировку')
      return
    }
    setBlockedSlots((rows) => rows.filter((row) => row.id !== id))
  }

  if (!user) return <main className="loading">Переход к форме входа…</main>

  const assignment = current?.assignment
  const ticketStatus = assignment?.ticket.status
  const employeeStatus = current?.employee.status ?? 'OFFLINE'
  const waitingCount = current?.queue?.waitingCount ?? 0
  const queueTickets = current?.queueTickets ?? []
  const dayBookings = current?.dayBookings ?? []
  const queueEmptyReason = current?.queueEmptyReason
  const isAdmin = user.roles.includes('ADMIN')
  const isAuditor = user.roles.includes('AUDITOR')
  const showSidebar = isAdmin || (isAuditor && !user.roles.includes('EMPLOYEE'))
  const hasDesk = Boolean(current?.employee.desk?.label)
  const isReady = employeeStatus === 'AVAILABLE'
  const maxHourly = Math.max(1, ...(overview?.hourly.map((row) => row.count) ?? [1]))

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
            <button className={view === 'stats' ? 'active' : ''} onClick={() => setView('stats')}>
              Статистика
            </button>
            <button className={view === 'audit' ? 'active' : ''} onClick={() => setView('audit')}>
              Журнал
            </button>
            {isAdmin && (
            <button className={view === 'desks' ? 'active' : ''} onClick={() => setView('desks')}>
              Столы и сотрудники
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
              <span className={`status status-${employeeStatus.toLowerCase()}`}>
                {employeeStatusLabel[employeeStatus] ?? employeeStatus}
              </span>
            </div>
            <div className="top-bar-actions">
              <div
                className={`status-toggle${!hasDesk ? ' disabled' : ''}`}
                role="group"
                aria-label="Статус приёма"
              >
                <button
                  type="button"
                  className={isReady ? 'active ready' : ''}
                  disabled={!hasDesk}
                  onClick={() => void setStatus('AVAILABLE')}
                >
                  Готов
                </button>
                <button
                  type="button"
                  className={!isReady ? 'active pause' : ''}
                  disabled={!hasDesk}
                  onClick={() => void setStatus('PAUSED')}
                >
                  Пауза
                </button>
              </div>
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
          <div className="work-screen">
            {hasDesk ? (
              <p className="work-meta">Стол: {current?.employee.desk?.label}</p>
            ) : (
              <p className="work-meta work-meta-warn">Стол не назначен — обратитесь к администратору</p>
            )}

            <div className="work-layout">
              <aside className="queue-panel">
                <div className="queue-panel-head">
                  <h2>Очередь</h2>
                  <span className="queue-count">{waitingCount}</span>
                </div>
                <ul className="queue-items">
                  {queueTickets.map((ticket, index) => (
                    <li
                      key={ticket.id}
                      className={
                        assignment?.ticket.number === ticket.number ? 'current' : undefined
                      }
                    >
                      <span className="queue-pos">{index + 1}</span>
                      <div className="queue-body">
                        <strong>{ticket.number}</strong>
                        <span>{ticket.deskLabel ?? 'Стол не назначен'}</span>
                        <small>{ticket.scheduledLabel ?? formatSlotTime(ticket.scheduledAt)}</small>
                      </div>
                    </li>
                  ))}
                  {!queueTickets.length && (
                    <li className="queue-empty">
                      {queueEmptyReason === 'NO_DESK'
                        ? 'Нет стола — очередь недоступна'
                        : queueEmptyReason === 'NO_COUNTRY'
                          ? 'Нет страны — очередь недоступна'
                          : 'Нет явившихся клиентов'}
                    </li>
                  )}
                </ul>
                <div className="queue-panel-head">
                  <h2>Записи дня</h2>
                </div>
                <ul className="queue-items">
                  {dayBookings.map((ticket) => (
                    <li key={ticket.id}>
                      <div className="queue-body">
                        <strong>{ticket.number}</strong>
                        <span>{ticketStatusLabel[ticket.status] ?? ticket.status}</span>
                        <small>{ticket.scheduledLabel ?? formatSlotTime(ticket.scheduledAt)}</small>
                        {ticket.canMarkNoShow && (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void markNoShow(ticket.id)}
                          >
                            Не явился
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                  {!dayBookings.length && (
                    <li className="queue-empty">На сегодня записей нет</li>
                  )}
                </ul>
              </aside>

              <section className="client-panel">
                {!hasDesk ? (
                  <article className="client-card client-card-muted">
                    <h2>Нет рабочего стола</h2>
                    <p>Администратор назначает стол в разделе «Столы и сотрудники».</p>
                  </article>
                ) : assignment ? (
                  <article className="client-card">
                    <span className="label">Текущий клиент</span>
                    <div className="number">{assignment.ticket.number}</div>
                    <h2>{assignment.ticket.fullName ?? assignment.ticket.serviceType.name}</h2>
                    <p className="client-detail">{assignment.ticket.serviceType.name}</p>
                    <p className="client-detail">
                      {formatSlotTime(assignment.ticket.scheduledAt)} · {assignment.ticket.country === 'CN' ? 'Китай' : 'РФ'}
                    </p>
                    {assignment.ticket.travelHistory && (
                      <p className="client-travel">{assignment.ticket.travelHistory}</p>
                    )}
                    <p className="status-pill">
                      {ticketStatusLabel[ticketStatus ?? ''] ?? ticketStatus}
                    </p>
                    <div className="client-actions">
                      {!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ticketStatus ?? '') && (
                        <button className="secondary" onClick={() => setRescheduleOpen(true)}>
                          Перенести время
                        </button>
                      )}
                      {ticketStatus === 'ASSIGNED' && (
                        <>
                          <button onClick={() => void action('CALL')}>Вызвать клиента</button>
                          <button className="secondary" onClick={() => void action('REQUEUE')}>
                            Вернуть в очередь
                          </button>
                        </>
                      )}
                      {ticketStatus === 'CALLED' && (
                        <>
                          <button onClick={() => void action('START')}>Начать обслуживание</button>
                          <button className="secondary" onClick={() => void action('REQUEUE')}>
                            Вернуть в очередь
                          </button>
                          <button className="secondary" onClick={() => void action('NO_SHOW')}>
                            Не явился
                          </button>
                        </>
                      )}
                      {ticketStatus === 'IN_SERVICE' && (
                        <button onClick={() => void action('COMPLETE')}>Завершить</button>
                      )}
                    </div>
                  </article>
                ) : (
                  <article className="client-card client-card-muted">
                    <h2>
                      {isReady
                        ? waitingCount > 0
                          ? `Ожидаем ${pluralClients(waitingCount)}`
                          : queueEmptyReason === 'NO_COUNTRY'
                            ? 'Нет страны'
                            : 'Нет явившихся'
                        : 'Приём на паузе'}
                    </h2>
                    <p>
                      {isReady
                        ? waitingCount > 0
                          ? 'Следующий талон будет назначен автоматически.'
                          : 'В работу попадают только клиенты, которые нажали «Я на месте».'
                        : 'Нажмите «Готов», чтобы начать принимать клиентов.'}
                    </p>
                  </article>
                )}
              </section>
            </div>
          </div>
        )}

        {view === 'stats' && showSidebar && (
          <>
            <header className="page-header">
              <div>
                <span className="eyebrow">Аналитика</span>
                <h1>Статистика за сегодня</h1>
              </div>
            </header>

            {overview && (
              <>
                <section className="kpi-grid">
                  <article><strong>{overview.createdToday}</strong><span>Создано талонов</span></article>
                  <article><strong>{overview.completedToday}</strong><span>Завершено</span></article>
                  <article><strong>{overview.waiting}</strong><span>В очереди</span></article>
                  <article><strong>{overview.inProgress}</strong><span>В работе</span></article>
                  <article><strong>{overview.cancelledToday}</strong><span>Отменено</span></article>
                  <article><strong>{overview.noShowToday}</strong><span>Не явились</span></article>
                  <article><strong>{formatDuration(overview.averageWaitSeconds)}</strong><span>Среднее ожидание</span></article>
                  <article><strong>{formatDuration(overview.averageHandlingSeconds)}</strong><span>Среднее обслуживание</span></article>
                </section>

                <section className="chart-card">
                  <h2>Талоны по часам</h2>
                  <div className="bar-chart">
                    {overview.hourly.map((row) => (
                      <div key={row.hour} className="bar-item">
                        <div className="bar" style={{ height: `${(row.count / maxHourly) * 100}%` }} />
                        <span>{formatHour(row.hour)}</span>
                        <em>{row.count}</em>
                      </div>
                    ))}
                    {!overview.hourly.length && <p className="muted">Пока нет данных за сегодня</p>}
                  </div>
                </section>
              </>
            )}

            <section className="metrics">
              <h2>Сотрудники</h2>
              {metrics.map((metric) => (
                <article key={metric.employeeId}>
                  <h3>{metric.displayName}</h3>
                  <div className="metric-grid">
                    <div><strong>{metric.completed}</strong><span>Завершено</span></div>
                    <div><strong>{formatDuration(metric.averageWaitSeconds)}</strong><span>Ср. ожидание</span></div>
                    <div><strong>{formatDuration(metric.medianHandlingSeconds)}</strong><span>Медиана приёма</span></div>
                    <div><strong>{formatDuration(metric.p90HandlingSeconds)}</strong><span>P90 приёма</span></div>
                    <div><strong>{Math.round(metric.slaPercent)}%</strong><span>В SLA</span></div>
                    <div><strong>{metric.noShowCount}</strong><span>Не явились</span></div>
                  </div>
                </article>
              ))}
              {!metrics.length && <div className="empty inline-empty"><h2>Нет завершённых обращений</h2></div>}
            </section>

            {isAdmin && (
            <section className="queue-list">
              <h2>Активная очередь</h2>
              {adminQueue.map((ticket) => (
                <div key={ticket.id}>
                  <strong>{ticket.number}</strong>
                  <span>{ticket.scheduledLabel ?? ticket.serviceType.name}</span>
                  <span>{ticket.assignment?.employeeName ?? ticket.deskLabel ?? '—'}</span>
                  <small>{ticketStatusLabel[ticket.status] ?? ticket.status}</small>
                  {ticket.canMarkNoShow && (
                    <button type="button" className="secondary" onClick={() => void markNoShow(ticket.id)}>
                      Не явился
                    </button>
                  )}
                </div>
              ))}
              {!adminQueue.length && <p className="muted">Очередь пуста</p>}
            </section>
            )}
          </>
        )}

        {view === 'audit' && showSidebar && (
          <>
            <header className="page-header">
              <div>
                <span className="eyebrow">Контроль</span>
                <h1>Журнал действий</h1>
              </div>
            </header>
            <section className="queue-list">
              {auditEvents.map((row) => (
                <div key={row.id}>
                  <strong>{row.action}</strong>
                  <span>{row.actorSubject}</span>
                  <span>{row.targetId ?? '—'}</span>
                  <small>{new Date(row.occurredAt).toLocaleString('ru-RU')}</small>
                </div>
              ))}
              {!auditEvents.length && <p className="muted">Записей пока нет</p>}
            </section>
          </>
        )}

        {view === 'desks' && isAdmin && (
          <>
            <header className="page-header page-header-compact">
              <h1>Столы и сотрудники</h1>
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
                    Сотрудник
                    <select
                      value={desk.employees[0]?.id ?? ''}
                      onChange={(event) =>
                        void assignEmployeeToDesk(desk.id, event.target.value)
                      }
                    >
                      <option value="">Не назначен</option>
                      {employees
                        .filter((employee) =>
                          employee.role !== 'ADMIN' &&
                          (!employee.country || employee.country === desk.country) &&
                          (!employee.desk || employee.desk.id === desk.id),
                        )
                        .map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {desk.employees[0] && (
                    <span className="desk-status">
                      {employeeStatusLabel[employees.find((e) => e.id === desk.employees[0]?.id)?.status ?? ''] ?? ''}
                    </span>
                  )}
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
                      <option value="CN">Китай</option>
                    </select>
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

            <section className="employees-panel">
              <h2>Сотрудники</h2>
              <p className="muted">Направление, стол и блокировка времени — для каждого сотрудника</p>
              <ul className="employees-list">
                {employees.filter((employee) => employee.role !== 'ADMIN').map((employee) => {
                  const draft = employeeBlockDraft(employee.id)
                  const employeeBlocks = blockedSlots.filter((row) => row.employeeId === employee.id)
                  return (
                    <li key={employee.id}>
                      <div className="employee-main">
                        <div className="employee-info">
                          <strong>{employee.displayName}</strong>
                          <span>{employee.desk ? `Стол: ${employee.desk.label}` : 'Стол не назначен'}</span>
                        </div>
                        <div className="country-toggle">
                          <span className="country-toggle-label">Направление</span>
                          <div className="country-toggle-buttons">
                            {(['RF', 'CN'] as const).map((country) => (
                              <button
                                key={country}
                                type="button"
                                className={employee.country === country ? 'active' : ''}
                                disabled={countryPending === employee.id}
                                onClick={() => void assignEmployeeCountry(employee.id, country)}
                              >
                                {countryLabel(country)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="employee-blocks">
                        <div className="employee-blocks-form">
                          <label>
                            Дата
                            <select
                              value={draft.date}
                              onChange={(e) => updateBlockDraft(employee.id, { date: e.target.value })}
                            >
                              {bookingDates.map((date) => (
                                <option key={date} value={date}>{date}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            С
                            <input
                              type="time"
                              value={draft.start}
                              onChange={(e) => updateBlockDraft(employee.id, { start: e.target.value })}
                            />
                          </label>
                          <label>
                            До
                            <input
                              type="time"
                              value={draft.end}
                              onChange={(e) => updateBlockDraft(employee.id, { end: e.target.value })}
                            />
                          </label>
                          <label>
                            Коммент.
                            <input
                              value={draft.reason}
                              onChange={(e) => updateBlockDraft(employee.id, { reason: e.target.value })}
                              placeholder="Обед"
                            />
                          </label>
                          <button type="button" onClick={() => void createBlockedSlot(employee.id)}>+</button>
                        </div>
                        {employeeBlocks.length > 0 && (
                          <ul className="employee-blocks-list">
                            {employeeBlocks.map((row) => (
                              <li key={row.id}>
                                <span>{row.date} · {row.startTime}–{row.endTime}</span>
                                {row.reason && <em>{row.reason}</em>}
                                <button type="button" className="secondary" onClick={() => void removeBlockedSlot(row.id)}>×</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}

        {rescheduleOpen && assignment && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>Перенести запись</h2>
              <label>
                Дата
                <select value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)}>
                  {bookingDates.map((date) => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </label>
              <div className="slot-grid">
                {rescheduleSlots.map((slot) => (
                  <button
                    key={slot.scheduledAt}
                    type="button"
                    className={`slot${rescheduleSlot === slot.scheduledAt ? ' selected' : ''}`}
                    onClick={() => setRescheduleSlot(slot.scheduledAt)}
                  >
                    {slot.time}
                  </button>
                ))}
                {!rescheduleSlots.length && <p className="muted">Свободного времени нет</p>}
              </div>
              <div className="step-actions">
                <button type="button" className="secondary" onClick={() => setRescheduleOpen(false)}>Отмена</button>
                <button type="button" disabled={!rescheduleSlot} onClick={() => void submitReschedule()}>Сохранить</button>
              </div>
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
