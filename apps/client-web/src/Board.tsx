import { useEffect, useMemo, useState } from 'react'
import './kiosk.css'

const API = import.meta.env.VITE_API_URL ?? '/api'

type BoardTicket = {
  number: string
  fullName: string
  countryLabel: string
  scheduledTime: string | null
  deskNumber: number | null
}

type BoardColumn = {
  id: string
  title: string
  showDesk: boolean
  tickets: BoardTicket[]
}

type BoardPayload = {
  site?: { name: string }
  country?: 'RF' | 'CN' | null
  countryLabel?: string | null
  columns: BoardColumn[]
  updatedAt?: string
}

function ticketDigits(number: string) {
  return number.replace(/^.*-/, '') || number
}

function boardCountryFromUrl(): 'RF' | 'CN' | null {
  const value = new URLSearchParams(window.location.search).get('country')
  if (value === 'RF' || value === 'CN') return value
  return null
}

export default function Board() {
  const lane = useMemo(() => boardCountryFromUrl(), [])
  const [board, setBoard] = useState<BoardPayload | null>(null)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(
        new Date().toLocaleTimeString('ru-RU', {
          timeZone: 'Europe/Moscow',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (lane) params.set('country', lane)
    const query = params.toString()

    async function load() {
      try {
        const response = await fetch(
          `${API}/public/board${query ? `?${query}` : ''}`,
          { credentials: 'include' },
        )
        if (!response.ok) throw new Error('board')
        const payload = (await response.json()) as BoardPayload
        if (!cancelled) {
          setBoard(payload)
          setError('')
        }
      } catch {
        if (!cancelled) setError('Табло временно недоступно')
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [lane])

  const columns = board?.columns ?? [
    { id: 'booked', title: 'Запись', showDesk: false, tickets: [] },
    { id: 'queue', title: 'Очередь', showDesk: false, tickets: [] },
    { id: 'approach', title: 'Подойти', showDesk: true, tickets: [] },
    { id: 'service', title: 'Приём', showDesk: false, tickets: [] },
  ]

  const laneTitle =
    board?.countryLabel ??
    (lane === 'CN' ? 'Заграничная' : lane === 'RF' ? 'РФ' : null)

  return (
    <div className="board-shell">
      <header className="board-header">
        <div>
          <strong>Электронная очередь</strong>
          <span>
            {board?.site?.name ?? 'Табло вызова'}
            {laneTitle ? ` · ${laneTitle}` : ''}
          </span>
        </div>
        <time>{clock}</time>
      </header>

      {error && (
        <p className="board-error" role="alert">
          {error}
        </p>
      )}

      <main className="board-grid">
        {columns.map((column) => (
          <section key={column.id} className={`board-column board-column-${column.id}`}>
            <h1>
              {column.title}
              <em>{column.tickets.length}</em>
            </h1>
            <ul>
              {column.tickets.map((ticket) => (
                <li key={ticket.number}>
                  <strong>{ticketDigits(ticket.number)}</strong>
                  <span className="board-ticket-name">{ticket.fullName}</span>
                  <span className="board-ticket-meta">
                    {ticket.countryLabel}
                    {ticket.scheduledTime ? ` · ${ticket.scheduledTime}` : ''}
                  </span>
                  {column.showDesk && ticket.deskNumber != null && (
                    <b>Стол {ticket.deskNumber}</b>
                  )}
                </li>
              ))}
              {!column.tickets.length && <li className="board-empty">Нет талонов</li>}
            </ul>
          </section>
        ))}
      </main>
    </div>
  )
}
