import { useMemo, useState } from 'react'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

function parseDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month: month - 1, day }
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

type Props = {
  availableDates: string[]
  value: string
  onChange: (date: string) => void
}

export function BookingCalendar({ availableDates, value, onChange }: Props) {
  const availableSet = useMemo(() => new Set(availableDates), [availableDates])
  const firstAvailable = parseDateParts(availableDates[0] ?? '2026-01-01')
  const lastAvailable = parseDateParts(availableDates[availableDates.length - 1] ?? availableDates[0] ?? '2026-01-01')

  const [viewYear, setViewYear] = useState(firstAvailable.year)
  const [viewMonth, setViewMonth] = useState(firstAvailable.month)

  const minMonth = monthKey(firstAvailable.year, firstAvailable.month)
  const maxMonth = monthKey(lastAvailable.year, lastAvailable.month)
  const currentMonth = monthKey(viewYear, viewMonth)

  const cells = useMemo(() => {
    const startOffset = (new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay() + 6) % 7
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate()
    const grid: Array<{ key: string; day: number; selectable: boolean } | null> = []

    for (let i = 0; i < startOffset; i += 1) grid.push(null)

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = formatDateKey(viewYear, viewMonth, day)
      grid.push({
        key,
        day,
        selectable: availableSet.has(key),
      })
    }

    return grid
  }, [availableSet, viewMonth, viewYear])

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  return (
    <div className="booking-calendar">
      <div className="calendar-head">
        <button
          type="button"
          className="calendar-nav"
          aria-label="Предыдущий месяц"
          disabled={currentMonth <= minMonth}
          onClick={() => shiftMonth(-1)}
        >
          ‹
        </button>
        <strong>
          {MONTHS[viewMonth]} {viewYear}
        </strong>
        <button
          type="button"
          className="calendar-nav"
          aria-label="Следующий месяц"
          disabled={currentMonth >= maxMonth}
          onClick={() => shiftMonth(1)}
        >
          ›
        </button>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {cells.map((cell, index) =>
          cell ? (
            <button
              key={cell.key}
              type="button"
              disabled={!cell.selectable}
              className={`calendar-day${value === cell.key ? ' selected' : ''}${cell.selectable ? '' : ' disabled'}`}
              onClick={() => onChange(cell.key)}
            >
              {cell.day}
            </button>
          ) : (
            <span key={`empty-${index}`} className="calendar-day empty" aria-hidden="true" />
          ),
        )}
      </div>
    </div>
  )
}
