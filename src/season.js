import { hashString, mulberry32 } from './rules.js'
import { WEEKLY_POOL } from './data/weekly-pool.js'

export const SEASON_NAMES = [
  'Köz Mevsimi',
  'Kül Yağmuru',
  'Buz Uykusu',
  'Alev Nöbeti',
  'Duman Perdesi',
  'Kor Hasadı',
]

export function getWeekInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  const year = d.getUTCFullYear()
  const id = `${year}-W${String(week).padStart(2, '0')}`
  // d is the Thursday of the ISO week; its Monday is three days earlier.
  const start = new Date(d.getTime() - 3 * 86400000)
  const end = new Date(start.getTime() + 7 * 86400000)
  return {
    id,
    year,
    week,
    start,
    end,
    label: `${week}. Hafta`,
    seasonName: SEASON_NAMES[(year + week) % SEASON_NAMES.length],
  }
}

export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'yeni sezon'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}g ${hours}sa`
  if (hours > 0) return `${hours}sa ${minutes}dk`
  return `${Math.max(1, minutes)}dk`
}

function rotateRows(rows, variant) {
  const turns = variant % 4
  let current = rows.map((row) => row.split(''))
  for (let t = 0; t < turns; t++) {
    const height = current.length
    const width = current[0].length
    const next = Array.from({ length: width }, () => Array(height).fill('#'))
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        next[c][height - 1 - r] = current[r][c]
      }
    }
    current = next
  }
  if (variant >= 4) current = current.map((row) => [...row].reverse())
  return current.map((row) => row.join(''))
}

function transformPoint([r, c], variant, height, width) {
  let point = [r, c]
  const turns = variant % 4
  for (let t = 0; t < turns; t++) {
    point = [point[1], height - 1 - point[0]]
    ;[height, width] = [width, height]
  }
  if (variant >= 4) point = [point[0], width - 1 - point[1]]
  return point
}

export function transformLevel(level, variant) {
  const height = level.rows.length
  const width = level.rows[0].length
  const rows = rotateRows(level.rows, variant)
  const sentries = (level.sentries || []).map((sentry) => ({
    ...sentry,
    path: sentry.path.map((point) => transformPoint(point, variant, height, width)),
  }))
  return {
    ...level,
    rows,
    sentries,
    transform: variant,
  }
}

function seededShuffle(list, rng) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const BUCKETS = [
  { label: 'Isınma', min: 2, max: 3 },
  { label: 'Kıvılcım', min: 4, max: 5 },
  { label: 'Köz', min: 6, max: 7 },
  { label: 'Alev', min: 8, max: 8 },
  { label: 'Ocak', min: 9, max: 10 },
]

/**
 * The same five levels for everyone during an ISO week. Variants are applied
 * after validation, so rotation/reflection cannot break solvability.
 */
export function getWeeklyLevels(weekId, { pool = WEEKLY_POOL } = {}) {
  const rng = mulberry32(hashString(`korlabirent:${weekId}:levels:v1`))
  const used = new Set()
  const selected = []
  for (let index = 0; index < BUCKETS.length; index++) {
    const bucket = BUCKETS[index]
    let candidates = pool.filter(
      (level) =>
        level.difficulty >= bucket.min &&
        level.difficulty <= bucket.max &&
        level.optimal <= 58 &&
        !used.has(level.id),
    )
    if (!candidates.length) {
      candidates = pool.filter((level) => level.difficulty >= bucket.min && level.difficulty <= bucket.max && !used.has(level.id))
    }
    if (!candidates.length) candidates = pool.filter((level) => !used.has(level.id))
    const ordered = seededShuffle(candidates, rng)
    const chosen = ordered[0]
    if (!chosen) continue
    used.add(chosen.id)
    const variant = Math.floor(rng() * 8)
    const transformed = transformLevel(chosen, variant)
    selected.push({
      ...transformed,
      id: `weekly-${weekId}-${index + 1}`,
      weeklyIndex: index + 1,
      weeklyLabel: bucket.label,
      name: chosen.name,
      par: chosen.par,
      optimal: chosen.optimal,
      difficulty: chosen.difficulty,
      intro:
        index === 0
          ? 'Sezonun ilk korları. Ritmini bul.'
          : index === BUCKETS.length - 1
            ? 'Son ocak. Bütün korları topla ve çık.'
            : 'Labirent değişti. Aynı ritimle devam et.',
    })
  }
  return selected
}

export function weeklySeedLabel(weekId) {
  return `#${weekId.replace('-W', '·')}`
}
