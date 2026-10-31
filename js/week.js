/* UTC Monday-based weekly seasons. Everyone sees the same reset moment. */

export function getWeekInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  const year = d.getUTCFullYear()
  const key = `${year}-W${String(week).padStart(2, '0')}`
  const start = startOfWeek(date)
  const end = new Date(start.getTime() + 7 * 86400000)
  return {
    year,
    week,
    key,
    start,
    end,
    nextReset: end,
    label: `${String(week).padStart(2, '0')}. HAFTA`,
    shortLabel: `${week}. Hafta`,
    range: `${formatDay(start)} — ${formatDay(new Date(end.getTime() - 86400000))}`,
  }
}

export function startOfWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 1)
  return d
}

export function nextReset(date = new Date()) {
  const start = startOfWeek(date)
  return new Date(start.getTime() + 7 * 86400000)
}

export function previousWeekKey(date = new Date()) {
  return getWeekInfo(new Date(date.getTime() - 7 * 86400000)).key
}

export function formatDay(date) {
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`
}

export function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return days > 0 ? `${days}g ${clock}` : clock
}

export function formatDuration(ms, compact = false) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (compact) return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return `${hours}s ${String(rest).padStart(2, '0')}d`
  }
  return `${minutes}d ${String(seconds).padStart(2, '0')}s`
}

export function weekSeed(key, salt = 'PRISMA-v1') {
  return `${salt}:${key}`
}
