const PREFIX = 'korlabirent.v1'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(`${PREFIX}.${key}`)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(`${PREFIX}.${key}`, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function createId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    // ignore
  }
  return `spark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function sanitizeName(value, fallback = 'Gezgin') {
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
  if (cleaned.length < 2) return fallback
  return cleaned
}

export function loadProfile() {
  const stored = read('profile', null)
  if (stored && typeof stored.id === 'string' && stored.id.length >= 6) {
    return {
      id: stored.id,
      name: sanitizeName(stored.name, 'Gezgin'),
      createdAt: Number(stored.createdAt) || Date.now(),
    }
  }
  const profile = {
    id: createId(),
    name: 'Gezgin',
    createdAt: Date.now(),
  }
  write('profile', profile)
  return profile
}

export function saveProfile(profile) {
  return write('profile', profile)
}

export function loadScores() {
  const stored = read('scores', {})
  return stored && typeof stored === 'object' ? stored : {}
}

export function saveScores(scores) {
  return write('scores', scores)
}

export function loadRemoteCache() {
  const stored = read('remote-cache', {})
  return stored && typeof stored === 'object' ? stored : {}
}

export function saveRemoteCache(cache) {
  return write('remote-cache', cache)
}

export function loadPending() {
  const stored = read('pending', [])
  return Array.isArray(stored) ? stored : []
}

export function savePending(pending) {
  return write('pending', pending)
}

export function loadCampaign() {
  const stored = read('campaign', null)
  if (stored && typeof stored === 'object') {
    return {
      unlocked: Math.max(1, Number(stored.unlocked) || 1),
      best: stored.best && typeof stored.best === 'object' ? stored.best : {},
      completed: Array.isArray(stored.completed) ? stored.completed : [],
    }
  }
  return { unlocked: 1, best: {}, completed: [] }
}

export function saveCampaign(campaign) {
  return write('campaign', campaign)
}

export function loadSettings() {
  const stored = read('settings', {})
  return {
    muted: Boolean(stored?.muted),
    reduceMotion: Boolean(stored?.reduceMotion),
  }
}

export function saveSettings(settings) {
  return write('settings', settings)
}
