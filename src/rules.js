/**
 * Kor Labirenti — deterministic turn rules.
 *
 * The same module powers the browser game and the level validator in Node.
 * Everything here is pure: a state is a small plain object and step() returns
 * a new state instead of mutating the input.
 */

export const WALL = '#'
export const FLOOR = '.'
export const EMBER = '*'
export const EXIT = 'E'
export const START = 'S'
export const ICE = 'I'
export const PORTAL_A = 'P'
export const PORTAL_B = 'Q'
export const CRACKED = '~'
export const FLAME = '^'
export const KEY = 'K'
export const GATE = 'G'
export const VOID = 'V'

export const DIRS = {
  up: [-1, 0],
  right: [0, 1],
  down: [1, 0],
  left: [0, -1],
}

export const ACTION_LABELS = {
  up: 'yukarı',
  right: 'sağ',
  down: 'aşağı',
  left: 'sol',
  wait: 'bekle',
}

const PORTALS = new Set([PORTAL_A, PORTAL_B])
const BLOCKING = new Set([WALL, VOID])

function lcm(a, b) {
  if (!a || !b) return 1
  let x = a
  let y = b
  while (y) {
    const t = x % y
    x = y
    y = t
  }
  return (a * b) / x
}

export function hashString(value) {
  let h = 2166136261 >>> 0
  const text = String(value)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Convert an ASCII level definition into the metadata used by the rules.
 * rows are strings; sentries are {path:[[row,col],...], mode:'loop'|'pingpong'}.
 */
export function parseLevel(def) {
  if (!def || !Array.isArray(def.rows) || def.rows.length < 3) {
    throw new Error('Level needs at least three rows')
  }
  const rows = def.rows.map((row) => String(row))
  const height = rows.length
  const width = rows[0].length
  if (!width || rows.some((row) => row.length !== width)) {
    throw new Error(`Level ${def.id || '(unnamed)'} is not rectangular`)
  }

  const emberCells = []
  const emberIndex = new Map()
  const crackedCells = []
  const crackedIndex = new Map()
  const flameCells = []
  const keyCells = []
  const gateCells = []
  const portalCells = []
  let start = -1
  let exit = -1

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const ch = rows[r][c]
      const idx = r * width + c
      if (ch === START) {
        if (start >= 0) throw new Error('Level has more than one start')
        start = idx
      } else if (ch === EXIT) {
        if (exit >= 0) throw new Error('Level has more than one exit')
        exit = idx
      } else if (ch === EMBER) {
        emberIndex.set(idx, emberCells.length)
        emberCells.push(idx)
      } else if (ch === CRACKED) {
        crackedIndex.set(idx, crackedCells.length)
        crackedCells.push(idx)
      } else if (ch === FLAME) {
        flameCells.push(idx)
      } else if (ch === KEY) {
        keyCells.push(idx)
      } else if (ch === GATE) {
        gateCells.push(idx)
      } else if (PORTALS.has(ch)) {
        portalCells.push(idx)
      }
    }
  }

  if (start < 0) throw new Error('Level has no start')
  if (exit < 0) throw new Error('Level has no exit')
  if (portalCells.length !== 0 && portalCells.length !== 2) {
    throw new Error('Level needs zero or exactly two portal tiles')
  }

  let period = 1
  if (flameCells.length) period = lcm(period, 2)

  const sentries = (def.sentries || []).map((sentry, index) => {
    if (!Array.isArray(sentry.path) || sentry.path.length < 2) {
      throw new Error(`Sentry ${index} needs a path of at least two cells`)
    }
    const path = sentry.path.map(([r, c]) => {
      if (r < 0 || c < 0 || r >= height || c >= width) {
        throw new Error(`Sentry ${index} leaves the board`)
      }
      const ch = rows[r][c]
      if (ch === WALL || ch === VOID) {
        throw new Error(`Sentry ${index} walks through a wall`)
      }
      return r * width + c
    })
    const mode = sentry.mode === 'loop' ? 'loop' : 'pingpong'
    const length = mode === 'loop' ? path.length : 2 * (path.length - 1)
    period = lcm(period, length)
    return {
      path,
      mode,
      startIndex: Math.max(0, Math.min(path.length - 1, Number(sentry.startIndex) || 0)),
    }
  })

  const level = {
    ...def,
    rows,
    width,
    height,
    start,
    exit,
    emberCells,
    emberIndex,
    crackedCells,
    crackedIndex,
    flameCells,
    keyCells,
    gateCells,
    portalCells,
    portalMap: portalCells.length === 2 ? new Map([[portalCells[0], portalCells[1]], [portalCells[1], portalCells[0]]]) : new Map(),
    sentries,
    period,
    flamePhase: Number(def.flamePhase) || 0,
    par: Number(def.par) || 0,
    optimal: Number(def.optimal) || 0,
  }
  return level
}

export function cellChar(level, index) {
  if (!Number.isInteger(index) || index < 0 || index >= level.width * level.height) return WALL
  return level.rows[Math.floor(index / level.width)][index % level.width]
}

export function createState(level) {
  return {
    pos: level.start,
    embers: 0,
    key: false,
    crumbled: 0,
    turn: 0,
    moves: 0,
    chain: 0,
    maxChain: 0,
    status: 'playing',
    deathReason: '',
  }
}

export function cloneState(state) {
  return {
    pos: state.pos,
    embers: state.embers,
    key: state.key,
    crumbled: state.crumbled,
    turn: state.turn,
    moves: state.moves,
    chain: state.chain,
    maxChain: state.maxChain,
    status: state.status,
    deathReason: state.deathReason || '',
  }
}

export function isFlameActive(level, state) {
  if (!level.flameCells.length) return false
  return (state.turn + level.flamePhase) % 2 === 0
}

export function sentryPosition(sentry, turn) {
  const length = sentry.path.length
  if (sentry.mode === 'loop') {
    return sentry.path[(sentry.startIndex + turn) % length]
  }
  const period = 2 * (length - 1)
  const t = (sentry.startIndex + turn) % period
  const i = t < length ? t : period - t
  return sentry.path[i]
}

export function sentryAt(level, state, index) {
  for (const sentry of level.sentries) {
    if (sentryPosition(sentry, state.turn) === index) return sentry
  }
  return null
}

export function isBlocked(level, state, index, { ignoreSentries = false } = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= level.width * level.height) return true
  const ch = cellChar(level, index)
  if (BLOCKING.has(ch)) return true
  if (ch === GATE && !state.key) return true
  if (ch === FLAME && isFlameActive(level, state)) return true
  const cracked = level.crackedIndex.get(index)
  if (cracked !== undefined && (state.crumbled & (1 << cracked))) return true
  if (!ignoreSentries && sentryAt(level, state, index)) return true
  return false
}

function collectAt(level, state, index, collected) {
  const ember = level.emberIndex.get(index)
  if (ember === undefined) return false
  const bit = 1 << ember
  if (state.embers & bit) return false
  state.embers |= bit
  collected.push(index)
  return true
}

function crumbleAt(level, state, index) {
  const cracked = level.crackedIndex.get(index)
  if (cracked === undefined) return false
  const bit = 1 << cracked
  if (state.crumbled & bit) return false
  state.crumbled |= bit
  return true
}

function advanceTurn(level, state) {
  state.turn += 1
  state.moves += 1
}

function finishMove(level, state, finalPos, collected, path, teleported) {
  const allEmbers = level.emberCells.length === 0 || state.embers === (1 << level.emberCells.length) - 1
  if (allEmbers && finalPos === level.exit) {
    state.turn += 1
    state.moves += 1
    state.status = 'won'
    return { ok: true, state, path, collected, teleported, won: true, died: false }
  }

  advanceTurn(level, state)

  const sentry = sentryAt(level, state, finalPos)
  if (sentry) {
    state.status = 'dead'
    state.deathReason = 'sentry'
    return { ok: true, state, path, collected, teleported, won: false, died: true }
  }

  return { ok: true, state, path, collected, teleported, won: false, died: false }
}

/**
 * Move one turn. Returns ok:false for a bump that should not consume a turn.
 */
export function step(level, state, action) {
  if (!state || state.status !== 'playing') {
    return { ok: false, state, reason: 'over', path: [], collected: [], teleported: false }
  }
  if (action === 'wait') return waitTurn(level, state)

  const dir = DIRS[action]
  if (!dir) return { ok: false, state, reason: 'unknown-action', path: [], collected: [], teleported: false }

  const [dr, dc] = dir
  const width = level.width
  const offset = dr * width + dc
  const next = state.pos + offset
  if (isBlocked(level, state, next)) {
    return { ok: false, state, reason: 'blocked', path: [], collected: [], teleported: false }
  }

  const working = cloneState(state)
  const path = []
  const collected = []
  let current = next
  let teleported = false

  // Leave the tile we are standing on; cracked stone crumbles behind us.
  crumbleAt(level, working, state.pos)

  const visit = (index) => {
    path.push(index)
    collectAt(level, working, index, collected)
    if (cellChar(level, index) === KEY) working.key = true
  }

  visit(current)

  // Ice carries the spark until the next cell is blocked.
  while (cellChar(level, current) === ICE) {
    const ahead = current + offset
    if (isBlocked(level, working, ahead)) break
    current = ahead
    visit(current)
    if (PORTALS.has(cellChar(level, current))) break
  }

  // Portals are one-way links within the same turn.
  if (PORTALS.has(cellChar(level, current))) {
    const destination = level.portalMap.get(current)
    if (destination !== undefined) {
      const destinationChar = cellChar(level, destination)
      const sentry = sentryAt(level, working, destination)
      if (sentry) {
        // Stepping into an occupied portal is fatal, not a teleport.
        path.push(destination)
        working.pos = destination
        working.moves += 1
        working.turn += 1
        working.status = 'dead'
        working.deathReason = 'sentry'
        return { ok: true, state: working, path, collected, teleported: false, won: false, died: true }
      }
      if (destinationChar !== WALL && destinationChar !== VOID) {
        crumbleAt(level, working, current)
        current = destination
        visit(current)
        teleported = true
      }
    }
  }

  // Every cracked tile crossed on the way (except the final one) is gone.
  for (const index of path) {
    if (index !== current) crumbleAt(level, working, index)
  }

  if (collected.length) {
    working.chain += 1
    if (working.chain > working.maxChain) working.maxChain = working.chain
  } else {
    working.chain = 0
  }
  working.pos = current

  return finishMove(level, working, current, collected, path, teleported)
}

export function waitTurn(level, state) {
  if (!state || state.status !== 'playing') {
    return { ok: false, state, reason: 'over', path: [], collected: [], teleported: false }
  }
  const working = cloneState(state)
  advanceTurn(level, working)
  const sentry = sentryAt(level, working, working.pos)
  if (sentry) {
    working.status = 'dead'
    working.deathReason = 'sentry'
    return { ok: true, state: working, path: [working.pos], collected: [], teleported: false, won: false, died: true }
  }
  return { ok: true, state: working, path: [working.pos], collected: [], teleported: false, won: false, died: false }
}

export function stateKey(level, state) {
  const turn = level.period > 1 ? state.turn % level.period : 0
  return `${state.pos}|${state.embers}|${state.key ? 1 : 0}|${state.crumbled}|${turn}`
}

export function isSolved(level, state) {
  const total = level.emberCells.length
  const all = total === 0 || state.embers === (1 << total) - 1
  return state.status === 'won' || (all && state.pos === level.exit)
}

/**
 * Breadth-first solver. Returns the shortest action sequence, including waits.
 */
export function solveLevel(level, { maxStates = 350000 } = {}) {
  const start = createState(level)
  if (isSolved(level, start)) {
    return { solved: true, moves: 0, actions: [], optimal: 0, states: 1 }
  }
  const queue = [start]
  let head = 0
  const seen = new Set([stateKey(level, start)])
  const parent = new Map([[stateKey(level, start), { prev: null, action: null }]])
  const actions = Object.keys(DIRS)
  if (level.period > 1) actions.push('wait')

  while (head < queue.length) {
    if (seen.size > maxStates) {
      return { solved: false, moves: Infinity, actions: [], optimal: Infinity, states: seen.size, reason: 'state-limit' }
    }
    const current = queue[head++]
    const currentKey = stateKey(level, current)

    for (const action of actions) {
      const result = step(level, current, action)
      if (!result.ok || result.died) continue
      const next = result.state
      const key = stateKey(level, next)
      if (seen.has(key)) continue
      seen.add(key)
      parent.set(key, { prev: currentKey, action })
      if (result.won || isSolved(level, next)) {
        const path = []
        let cursor = key
        while (cursor) {
          const entry = parent.get(cursor)
          if (!entry || entry.action === null) break
          path.push(entry.action)
          cursor = entry.prev
        }
        path.reverse()
        return { solved: true, moves: next.moves, actions: path, optimal: next.moves, states: seen.size }
      }
      queue.push(next)
    }
  }

  return { solved: false, moves: Infinity, actions: [], optimal: Infinity, states: seen.size, reason: 'exhausted' }
}

export function computeLevelScore(level, state, { undoCount = 0 } = {}) {
  const embers = level.emberCells.length
  const base = 300
  const emberPts = embers * 75
  const par = level.par || state.moves
  const efficiency = Math.max(0, par - state.moves) * 30
  const onPar = state.moves <= par ? 200 : 0
  const chain = state.maxChain * 40
  const perfect = level.optimal && state.moves === level.optimal ? 150 : 0
  const penalty = Math.max(0, undoCount) * 20
  const total = Math.max(0, base + emberPts + efficiency + onPar + chain + perfect - penalty)
  return {
    total,
    base,
    emberPts,
    efficiency,
    onPar,
    chain,
    perfect,
    penalty,
    embers,
    moves: state.moves,
    par,
    maxChain: state.maxChain,
  }
}

export function formatMoves(value) {
  return Number.isFinite(value) ? String(value) : '—'
}
