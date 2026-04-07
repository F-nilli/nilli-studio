'use client'


const HOURS = Array.from({ length: 24 }, (_, i) => {
  const label = i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`
  return { value: i, label }
})

interface Props {
  value: string // "yyyy-MM-dd'T'HH:mm" (datetime-local format)
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  autoFocus?: boolean
}

export function DateHourPicker({ value, onChange, className, disabled, autoFocus }: Props) {
  const datePart = value ? value.slice(0, 10) : ''
  const hour = value ? parseInt(value.slice(11, 13), 10) : 0

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newDate = e.target.value
    if (!newDate) { onChange(''); return }
    const h = String(hour).padStart(2, '0')
    onChange(`${newDate}T${h}:00`)
  }

  function handleHourChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newHour = parseInt(e.target.value, 10)
    if (!datePart) return
    const h = String(newHour).padStart(2, '0')
    onChange(`${datePart}T${h}:00`)
  }

  const inputClass = `bg-[#1e1e1e] border border-[#333] text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#ff3c00] ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <input
        type="date"
        value={datePart}
        onChange={handleDateChange}
        disabled={disabled}
        autoFocus={autoFocus}
        className={`${inputClass} px-2 py-1.5 flex-1 min-w-0`}
      />
      <select
        value={hour}
        onChange={handleHourChange}
        disabled={disabled || !datePart}
        className={`${inputClass} px-2 py-1.5 shrink-0`}
      >
        {HOURS.map(h => (
          <option key={h.value} value={h.value}>{h.label}</option>
        ))}
      </select>
    </div>
  )
}
