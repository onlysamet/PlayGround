/*
 * Weekly league.
 *
 * Local mode is always available: scores live in localStorage and a stable set
 * of weekly pace rivals makes the board feel alive. If a compatible endpoint is
 * configured (window.PRISMA_CONFIG.leaderboardApi), the same API is used for a
 * real shared board and local data remains as an offline mirror.
 */

import { hash32, makeRng } from './puzzle.js'

const STORE_KEY = 'prisma.league.v2'
const PROFILE_KEY = 'prisma.player.v2'
const MAX_WEEKS = 12
const MAX_PLAYERS = 150

const BOT_NAMES = [
  'Işıkçı', 'Prizma', 'Kırılma', 'Foton', 'Kıvılcım', 'Gölge', 'Ayna', 'Kristal',
  'Lumen', 'Nova', 'Vega', 'Orion', 'Atlas', 'Mira', 'Ada', 'Ege', 'Deniz',
  'Kobalt', 'Neon', 'Kuantum', 'Piksel', 'Vertex', 'Eksen', 'Yörünge', 'Kozmik',
  'Rüzgar', 'Şimşek', 'Ateş', 'Buz', 'Nebula', 'Pulsar', 'Aurora', 'Siber',
  'Sıfır', 'Artı', 'Denge', 'Kırık Işın', 'Beyaz Gürültü', 'Mavi Saat',
  'Gece Kuşu', 'Cam Kule', 'Son Foton', 'Işın İzi', 'Prizma 42', 'Lazer Kedi',
  'Spektrum', 'Yansıma', 'Parlak', 'Sonsuz Döngü', 'Kuzey Işığı', 'Sis',
]

const AVATAR_COLORS = [
  ['#58f3ff', '#2b7fff'],
  ['#ff6bdc', '#9a5cff'],
  ['#ffcf70', '#ff7a4d'],
  ['#6dffb0', '#1bb8a6'],
  ['#b18cff', '#5d5cff'],
  ['#ff8e8e', '#d34dff'],
]

function safeParse(raw, fallback) {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? value : fallback
  } catch {
    return fallback
  }
}

export function getClientId() {
  const profile = getProfile()
  return profile.id
}

export function getProfile() {
  const stored = safeParse(localStorage.getItem(PROFILE_KEY), null)
  if (stored?.id) {
    return { id: String(stored.id), name: normalizeName(stored.name) || 'Gezgin' }
  }
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const profile = { id, name: '' }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  return profile
}

export function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify({
    id: profile.id,
    name: normalizeName(profile.name),
  }))
}

export function normalizeName(value) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
}

function loadStore() {
  const store = safeParse(localStorage.getItem(STORE_KEY), null)
  if (!store || store.version !== 2 || typeof store.weeks !== 'object') {
    return { version: 2, weeks: {} }
  }
  return store
}

function saveStore(store) {
  const keys = Object.keys(store.weeks).sort().reverse()
  for (const key of keys.slice(MAX_WEEKS)) delete store.weeks[key]
  localStorage.setItem(STORE_KEY, JSON.stringify(store))
}

function pruneWeek(week) {
  const ids = Object.keys(week.players || {})
  if (ids.length <= MAX_PLAYERS) return
  ids
    .sort((a, b) => (week.players[b].updatedAt || 0) - (week.players[a].updatedAt || 0))
    .slice(MAX_PLAYERS)
    .forEach((id) => delete week.players[id])
}

export function avatarFor(name) {
  const pair = AVATAR_COLORS[hash32(name) % AVATAR_COLORS.length]
  return { from: pair[0], to: pair[1], initials: initialsFor(name) }
}

export function initialsFor(name) {
  const clean = String(name || '?').trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toLocaleUpperCase('tr-TR')
  return clean.slice(0, 2).toLocaleUpperCase('tr-TR')
}

export function buildBots(weekKey, count = 46) {
  const rng = makeRng(`prisma:pace:${weekKey}`)
  const names = rng.shuffle(BOT_NAMES).slice(0, Math.min(count, BOT_NAMES.length))
  const bots = names.map((name, index) => {
    const skill = rng.next()
    const jitter = rng.range(-160, 160)
    let score = Math.round((4620 + Math.pow(skill, 0.62) * 4250 + jitter) / 10) * 10
    score = Math.max(4380, Math.min(8970, score))
    const minutes = 5.6 + (1 - skill) * 7.8 + rng.next() * 1.8
    const timeMs = Math.round(minutes * 60000 + rng.next() * 45000)
    return {
      id: `pace-${weekKey}-${index}`,
      name,
      score,
      timeMs,
      levels: 6,
      crystals: 11 + Math.floor(skill * 9),
      updatedAt: 0,
      bot: true,
      color: avatarFor(name),
    }
  })
  return sortEntries(bots)
}

export function sortEntries(entries) {
  return entries.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
    return String(a.name).localeCompare(String(b.name), 'tr')
  })
}

export function rankOf(entries, playerId) {
  const index = entries.findIndex((entry) => entry.id === playerId)
  return index < 0 ? null : index + 1
}

export function getLocalEntries(weekKey, playerId, includeBots = true) {
  const store = loadStore()
  const week = store.weeks[weekKey]
  const players = week?.players ? Object.values(week.players) : []
  const entries = players.map((player) => ({
    ...player,
    color: avatarFor(player.name),
    self: player.id === playerId,
  }))
  if (includeBots) entries.push(...buildBots(weekKey).map((bot) => ({ ...bot, self: false })))
  return sortEntries(entries)
}

export function submitLocal({ weekKey, playerId, name, score, timeMs, levels, crystals }) {
  const store = loadStore()
  const week = store.weeks[weekKey] || { players: {} }
  store.weeks[weekKey] = week
  const current = week.players[playerId]
  const next = {
    id: playerId,
    name: normalizeName(name) || 'Gezgin',
    score: Math.max(0, Math.round(score)),
    timeMs: Math.max(0, Math.round(timeMs)),
    levels: Math.max(0, Math.min(6, Math.round(levels))),
    crystals: Math.max(0, Math.round(crystals)),
    updatedAt: Date.now(),
  }
  const improved = !current || next.score > current.score || (next.score === current.score && next.timeMs < current.timeMs)
  if (improved) week.players[playerId] = next
  else if (current && normalizeName(name) && current.name !== next.name) current.name = next.name
  pruneWeek(week)
  saveStore(store)
  const entries = getLocalEntries(weekKey, playerId)
  return { improved, best: week.players[playerId] || current, rank: rankOf(entries, playerId), entries }
}

export function getWeekHistory(weekKey, playerId, includeBots = true) {
  return getLocalEntries(weekKey, playerId, includeBots)
}

function apiUrl(base, weekKey) {
  const url = new URL(base, window.location.href)
  url.searchParams.set('week', weekKey)
  return url.toString()
}

async function fetchJson(url, options = {}, timeout = 3800) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export class WeeklyLeague {
  constructor({ weekKey, playerId, apiBase = '', includeBots = true }) {
    this.weekKey = weekKey
    this.playerId = playerId
    this.apiBase = apiBase
    this.includeBots = includeBots
    this.mode = apiBase ? 'remote' : 'local'
    this.status = 'idle'
    this.remoteEntries = null
    this.lastError = ''
  }

  async refresh() {
    if (!this.apiBase) {
      this.status = 'ready'
      this.mode = 'local'
      return this.entries()
    }
    this.status = 'loading'
    try {
      const data = await fetchJson(apiUrl(this.apiBase, this.weekKey))
      this.remoteEntries = Array.isArray(data.entries) ? data.entries : []
      this.status = 'ready'
      this.mode = 'remote'
      this.lastError = ''
    } catch (error) {
      this.status = 'offline'
      this.mode = 'local'
      this.lastError = error.message || 'offline'
    }
    return this.entries()
  }

  entries() {
    if (this.mode === 'remote' && this.remoteEntries) {
      return sortEntries(this.remoteEntries.map((entry) => ({
        ...entry,
        color: entry.color || avatarFor(entry.name),
        self: entry.id === this.playerId,
      })))
    }
    return getLocalEntries(this.weekKey, this.playerId, this.includeBots)
  }

  rank() {
    return rankOf(this.entries(), this.playerId)
  }

  async submit(payload) {
    const local = submitLocal({ ...payload, weekKey: this.weekKey, playerId: this.playerId })
    if (!this.apiBase) return { ...local, mode: 'local', status: 'ready' }

    try {
      const data = await fetchJson(apiUrl(this.apiBase, this.weekKey), {
        method: 'POST',
        body: JSON.stringify({
          id: this.playerId,
          name: payload.name,
          score: payload.score,
          timeMs: payload.timeMs,
          levels: payload.levels,
          crystals: payload.crystals,
        }),
      })
      this.remoteEntries = Array.isArray(data.entries) ? data.entries : []
      this.mode = 'remote'
      this.status = 'ready'
      this.lastError = ''
      return {
        ...local,
        improved: Boolean(data.improved),
        rank: rankOf(this.entries(), this.playerId),
        entries: this.entries(),
        mode: 'remote',
        status: 'ready',
      }
    } catch (error) {
      this.mode = 'local'
      this.status = 'offline'
      this.lastError = error.message || 'offline'
      return { ...local, mode: 'local', status: 'offline' }
    }
  }

  get modeLabel() {
    if (this.status === 'offline') return 'Çevrimdışı lig'
    return this.mode === 'remote' ? 'Canlı lig' : 'Yerel lig'
  }

  get modeNote() {
    if (this.mode === 'remote' && this.status === 'ready') {
      return 'Canlı sunucuya bağlı. Skorlar tüm oyuncularla paylaşılır.'
    }
    if (this.status === 'offline') {
      return 'Sunucuya ulaşılamadı. Skorun bu cihazda güvende.'
    }
    return 'Yerel lig: skorlar bu cihazda saklanır, haftalık rakipler her pazartesi yenilenir.'
  }
}
