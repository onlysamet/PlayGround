import { getWeekInfo } from './season.js'
import { hashString, mulberry32 } from './rules.js'
import {
  loadProfile,
  saveProfile,
  sanitizeName,
  loadScores,
  saveScores,
  loadRemoteCache,
  saveRemoteCache,
  loadPending,
  savePending,
} from './storage.js'

const TOPIC_ROOT = 'korlabirent/v1/season'
const BROKERS = [
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
]
const GHOST_NAMES = ['Külgezgin', 'Alevsaz', 'Buzkırığı', 'Ocakbekçisi', 'Koravcısı', 'Dumaniz', 'Gecefeneri']
const MAX_ENTRIES = 120
const COLLECT_MS = 2300

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function topicFor(weekId, playerId = '+') {
  return `${TOPIC_ROOT}/${weekId}/scores/${playerId}`
}

export function makeGhosts(week) {
  const rng = mulberry32(hashString(`korlabirent:ghosts:${week.id}:v2`))
  const scores = [4320, 3860, 3420, 3010, 2640, 2280, 1920].map((base) => base + Math.floor(rng() * 180) - 90)
  return GHOST_NAMES.map((name, index) => ({
    id: `ghost-${week.id}-${index}`,
    name,
    score: scores[index],
    levels: 5,
    moves: 78 + Math.floor(rng() * 42),
    at: week.start.getTime() + (index + 1) * 3600_000,
    bot: true,
    source: 'ghost',
  }))
}

function entryScore(entry) {
  return Number.isFinite(entry?.score) ? entry.score : 0
}

function mergeEntries(...groups) {
  const map = new Map()
  for (const group of groups) {
    for (const entry of group || []) {
      if (!entry || typeof entry.id !== 'string') continue
      const existing = map.get(entry.id)
      if (!existing || entryScore(entry) > entryScore(existing)) {
        map.set(entry.id, entry)
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => {
      if (entryScore(b) !== entryScore(a)) return entryScore(b) - entryScore(a)
      if ((a.moves || 0) !== (b.moves || 0)) return (a.moves || 0) - (b.moves || 0)
      return (a.at || 0) - (b.at || 0)
    })
    .slice(0, MAX_ENTRIES)
}

export function parseRemoteEntry(raw, weekId) {
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (payload.v !== undefined && payload.v !== 1) return null
  if (typeof payload.id !== 'string' || payload.id.length < 6 || payload.id.length > 80) return null
  if (payload.bot) return null
  const score = Math.floor(Number(payload.score))
  if (!Number.isFinite(score) || score < 0 || score > 200000) return null
  return {
    id: payload.id,
    name: sanitizeName(payload.name, 'Gezgin'),
    score,
    levels: clamp(Math.floor(Number(payload.levels) || 0), 0, 5),
    moves: clamp(Math.floor(Number(payload.moves) || 0), 0, 100000),
    at: clamp(Number(payload.at) || Date.now(), 0, Date.now() + 86400000),
    bot: false,
    source: 'online',
    weekId,
  }
}

export class Leaderboard {
  constructor({ onEntries, onStatus, onToast } = {}) {
    this.onEntries = typeof onEntries === 'function' ? onEntries : () => {}
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {}
    this.onToast = typeof onToast === 'function' ? onToast : () => {}
    this.profile = loadProfile()
    this.week = getWeekInfo()
    this.localScores = loadScores()
    this.remoteCache = loadRemoteCache()
    this.pending = loadPending()
    this.remote = []
    this.client = null
    this.brokerIndex = 0
    this.connected = false
    this.collectingUntil = 0
    this.collectTimer = null
    this.rolloverTimer = null
    this.reconnectTimer = null
    this.fallbackTimer = null
    this.started = false
    this.lastStatus = 'offline'
    this.ghosts = makeGhosts(this.week)
    this.onlineName = BROKERS[0].name
  }

  start() {
    if (this.started) return
    this.started = true
    this.emitEntries('local')
    this.connect()
    this.rolloverTimer = setInterval(() => this.checkRollover(), 30000)
    this.tryFlushPending()
  }

  stop() {
    this.started = false
    clearInterval(this.rolloverTimer)
    clearTimeout(this.collectTimer)
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.fallbackTimer)
    if (this.client) {
      try {
        this.client.end(true)
      } catch {
        // ignore
      }
      this.client = null
    }
  }

  checkRollover() {
    const next = getWeekInfo()
    if (next.id === this.week.id) return
    this.week = next
    this.ghosts = makeGhosts(next)
    this.remote = []
    this.emitEntries('rollover')
    this.onToast?.('Yeni hafta başladı. Sıralama sıfırlandı.', 'season')
    this.refresh()
  }

  setStatus(status, detail = {}) {
    if (this.lastStatus === status && !detail.force) return
    this.lastStatus = status
    this.onStatus(status, { ...detail, broker: this.onlineName })
  }

  get ownEntry() {
    return this.localScores[this.week.id] || null
  }

  get cachedEntries() {
    const cached = this.remoteCache[this.week.id]
    if (!cached || !Array.isArray(cached.entries)) return []
    if (Date.now() - (cached.at || 0) > 7 * 86400000) return []
    return cached.entries
  }

  get entries() {
    const own = this.ownEntry ? [{ ...this.ownEntry, source: this.ownEntry.source || 'local' }] : []
    // Own entry goes first so a local name change wins over an older cached
    // copy of the same score. Higher remote scores still replace it.
    return mergeEntries(own, this.ghosts, this.cachedEntries, this.remote)
  }

  get playerEntry() {
    return this.entries.find((entry) => entry.id === this.profile.id) || null
  }

  get playerRank() {
    const index = this.entries.findIndex((entry) => entry.id === this.profile.id)
    return index >= 0 ? index + 1 : null
  }

  emitEntries(source = 'update') {
    const entries = this.entries
    this.onEntries({
      entries,
      week: this.week,
      profile: this.profile,
      playerRank: this.playerRank,
      playerEntry: this.playerEntry,
      source,
      online: this.connected,
      broker: this.onlineName,
    })
  }

  connect() {
    if (!this.started) return
    if (this.client) {
      try {
        this.client.end(true)
      } catch {
        // ignore
      }
      this.client = null
    }
    const mqtt = globalThis.mqtt
    if (!mqtt?.connect) {
      this.connected = false
      this.setStatus('offline', { force: true, reason: 'mqtt-unavailable' })
      this.emitEntries('offline')
      return
    }
    const broker = BROKERS[this.brokerIndex % BROKERS.length]
    this.onlineName = broker.name
    this.setStatus('connecting', { force: true })
    let settled = false
    const client = mqtt.connect(broker.url, {
      clientId: `kl_${this.profile.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}_${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      connectTimeout: 7000,
      reconnectPeriod: 0,
      keepalive: 30,
      protocolVersion: 4,
    })
    this.client = client

    const fallback = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        client.end(true)
      } catch {
        // ignore
      }
      this.brokerIndex += 1
      this.connect()
    }, 8500)
    this.fallbackTimer = fallback

    client.on('connect', () => {
      settled = true
      clearTimeout(fallback)
      this.connected = true
      this.setStatus('online', { force: true })
      this.subscribe()
      this.tryFlushPending()
      this.publishOwnBest()
    })

    client.on('message', (topic, payload) => {
      if (!topic.startsWith(`${TOPIC_ROOT}/${this.week.id}/scores/`)) return
      const entry = parseRemoteEntry(payload.toString(), this.week.id)
      if (!entry) return
      const existing = this.remote.find((item) => item.id === entry.id)
      if (!existing || entry.score > existing.score) {
        this.remote = mergeEntries(this.remote, [entry])
        this.cacheRemote()
        this.emitEntries('message')
      }
    })

    client.on('error', () => {
      if (!settled) {
        settled = true
        clearTimeout(fallback)
        this.brokerIndex += 1
        this.connect()
      }
    })

    client.on('close', () => {
      if (this.client !== client) return
      if (this.connected) {
        this.connected = false
        this.setStatus('reconnecting', { force: true })
        this.emitEntries('reconnecting')
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = setTimeout(() => {
          if (!this.connected) {
            this.brokerIndex += 1
            this.connect()
          }
        }, 5000)
      }
    })
  }

  subscribe() {
    if (!this.client || !this.connected) return
    this.collectingUntil = Date.now() + COLLECT_MS
    this.setStatus('syncing', { force: true })
    this.client.subscribe(topicFor(this.week.id), { qos: 0 }, (error) => {
      if (error) {
        this.setStatus('online', { force: true })
        return
      }
      clearTimeout(this.collectTimer)
      this.collectTimer = setTimeout(() => {
        this.setStatus('online', { force: true })
        this.emitEntries('online')
      }, COLLECT_MS)
    })
  }

  refresh() {
    if (!this.started) return
    if (!this.connected) {
      this.connect()
      this.emitEntries('offline')
      return
    }
    this.remote = []
    this.subscribe()
  }

  cacheRemote() {
    this.remoteCache[this.week.id] = {
      at: Date.now(),
      entries: this.remote,
    }
    saveRemoteCache(this.remoteCache)
  }

  tryFlushPending() {
    if (!this.connected || !this.client) return
    const remaining = []
    for (const entry of this.pending) {
      if (entry.weekId && entry.weekId !== this.week.id) {
        remaining.push(entry)
        continue
      }
      const ok = this.publishRaw(entry)
      if (!ok) remaining.push(entry)
    }
    this.pending = remaining
    savePending(this.pending)
  }

  publishRaw(entry) {
    if (!this.client || !this.connected) return false
    const payload = {
      v: 1,
      id: entry.id,
      name: entry.name,
      score: entry.score,
      levels: entry.levels,
      moves: entry.moves,
      at: entry.at,
    }
    try {
      this.client.publish(topicFor(this.week.id, entry.id), JSON.stringify(payload), { qos: 0, retain: true }, (error) => {
        if (error) this.onToast?.('Skor gönderilemedi; tekrar denenecek.', 'warn')
      })
      return true
    } catch {
      return false
    }
  }

  publishOwnBest() {
    const own = this.ownEntry
    if (!own || !this.connected) return
    const remoteOwn = this.remote.find((entry) => entry.id === own.id)
    if (remoteOwn && remoteOwn.score >= own.score) return
    this.publishRaw(own)
  }

  submit({ score, levels = 5, moves = 0, name } = {}) {
    const cleanName = sanitizeName(name || this.profile.name, 'Gezgin')
    if (name && cleanName !== this.profile.name) {
      this.profile = { ...this.profile, name: cleanName }
      saveProfile(this.profile)
    }
    const safeScore = Math.max(0, Math.floor(Number(score) || 0))
    if (safeScore <= 0) return null
    const entry = {
      id: this.profile.id,
      name: cleanName,
      score: safeScore,
      levels: clamp(Math.floor(Number(levels) || 0), 0, 5),
      moves: Math.max(0, Math.floor(Number(moves) || 0)),
      at: Date.now(),
      bot: false,
      source: this.connected ? 'online' : 'local',
      weekId: this.week.id,
    }
    const existing = this.localScores[this.week.id]
    const isBetter = !existing || entry.score > existing.score
    if (isBetter) {
      this.localScores[this.week.id] = entry
      saveScores(this.localScores)
    }
    const best = this.localScores[this.week.id]
    if (!this.connected) {
      if (isBetter) {
        this.pending.push(best)
        savePending(this.pending)
      }
      this.emitEntries('offline-submit')
      this.onToast?.('Çevrimdışısın; skor cihazına kaydedildi ve bağlanınca gönderilecek.', 'warn')
      return best
    }
    if (isBetter || !this.remote.some((item) => item.id === best.id && item.score >= best.score)) {
      this.publishRaw(best)
      this.remote = mergeEntries(this.remote, [{ ...best, source: 'online' }])
      this.cacheRemote()
    }
    this.emitEntries('submit')
    this.onToast?.('Skor haftalık sıralamaya gönderildi.', 'success')
    return best
  }

  setName(name) {
    const clean = sanitizeName(name, this.profile.name)
    this.profile = { ...this.profile, name: clean }
    saveProfile(this.profile)
    const own = this.localScores[this.week.id]
    if (own) {
      own.name = clean
      this.localScores[this.week.id] = own
      saveScores(this.localScores)
      if (this.connected) this.publishRaw(own)
    }
    this.emitEntries('name')
    return clean
  }
}
