/**
 * Deterministic labyrinth generator + validator.
 *
 * A level is generated as a perfect maze, sprinkled with embers, then a
 * feature is added only when the BFS solver can still finish the level.
 * Generated levels are saved as plain ASCII so they are easy to inspect.
 */

import {
  parseLevel,
  solveLevel,
  step,
  createState,
  hashString,
  mulberry32,
  DIRS,
  cellChar,
  ICE,
  PORTAL_A,
  PORTAL_B,
  CRACKED,
  FLAME,
  KEY,
  GATE,
  WALL,
  FLOOR,
  EMBER,
  START,
  EXIT,
  sentryPosition,
} from './rules.js'

export const LEVEL_NAMES = [
  'Köz Yolu',
  'Kırık Fener',
  'Buz Çatlağı',
  'Sessiz Geçit',
  'Kül Bahçesi',
  'Alev Kapısı',
  'Kayıp Anahtar',
  'Gölge Kovuğu',
  'Son Ocak',
  'Duman Halkası',
  'Kor Çukuru',
  'Yankı Odası',
  'Sönük Yıldız',
  'Demir Perde',
  'Gece Feneri',
  'Kıvılcım Yolu',
  'Köz Labirenti',
  'Bekçi Geçidi',
  'Küllenen Yol',
  'Fenerin Sırrı',
]

const DIMS = {
  1: [7, 7],
  2: [9, 7],
  3: [9, 9],
  4: [9, 9],
  5: [11, 9],
  6: [11, 9],
  7: [11, 11],
  8: [11, 11],
  9: [13, 11],
  10: [13, 11],
}

function blankGrid(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(WALL))
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

function carveMaze(rng, width, height) {
  const grid = blankGrid(width, height)
  const stack = [[1, 1]]
  grid[1][1] = FLOOR
  const dirs = [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ]
  while (stack.length) {
    const [r, c] = stack[stack.length - 1]
    const options = []
    for (const [dr, dc] of dirs) {
      const nr = r + dr
      const nc = c + dc
      if (nr > 0 && nc > 0 && nr < height - 1 && nc < width - 1 && grid[nr][nc] === WALL) {
        options.push([nr, nc, r + dr / 2, c + dc / 2])
      }
    }
    if (!options.length) {
      stack.pop()
      continue
    }
    const [nr, nc, wr, wc] = options[Math.floor(rng() * options.length)]
    grid[wr][wc] = FLOOR
    grid[nr][nc] = FLOOR
    stack.push([nr, nc])
  }

  // A few loops make the maze feel less like a single corridor.
  const loopChance = 0.075
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      if (grid[r][c] !== WALL) continue
      const vertical = r % 2 === 1 && c % 2 === 0 && r > 1 && r < height - 2
      const horizontal = r % 2 === 0 && c % 2 === 1 && c > 1 && c < width - 2
      if ((vertical || horizontal) && rng() < loopChance) grid[r][c] = FLOOR
    }
  }
  return grid
}

function toRows(grid) {
  return grid.map((row) => row.join(''))
}

function openCells(grid) {
  const cells = []
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (grid[r][c] !== WALL) cells.push([r, c])
    }
  }
  return cells
}

function neighbors(grid, r, c) {
  const result = []
  for (const [dr, dc] of Object.values(DIRS)) {
    const nr = r + dr
    const nc = c + dc
    if (nr >= 0 && nc >= 0 && nr < grid.length && nc < grid[0].length && grid[nr][nc] !== WALL) {
      result.push([nr, nc])
    }
  }
  return result
}

function bfs(grid, start) {
  const height = grid.length
  const width = grid[0].length
  const dist = new Map()
  const key = (r, c) => r * width + c
  const queue = [start]
  dist.set(key(...start), 0)
  let head = 0
  while (head < queue.length) {
    const [r, c] = queue[head++]
    const d = dist.get(key(r, c))
    for (const [nr, nc] of neighbors(grid, r, c)) {
      const k = key(nr, nc)
      if (dist.has(k)) continue
      dist.set(k, d + 1)
      queue.push([nr, nc])
    }
  }
  return dist
}

function routeLength(grid, start, embers, exit) {
  const points = [start, ...embers, exit]
  const keys = points.map(([r, c]) => r * grid[0].length + c)
  const matrices = points.map((point) => bfs(grid, point))
  const distance = (i, j) => matrices[i].get(keys[j])
  let best = Infinity
  let bestOrder = embers.map((_, i) => i)
  const indices = embers.map((_, i) => i)
  const permute = (prefix, remaining) => {
    if (!remaining.length) {
      let total = 0
      let cursor = 0
      for (const index of prefix) {
        total += distance(cursor, index + 1)
        cursor = index + 1
      }
      total += distance(cursor, points.length - 1)
      if (total < best) {
        best = total
        bestOrder = [...prefix]
      }
      return
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i]
      permute([...prefix, next], [...remaining.slice(0, i), ...remaining.slice(i + 1)])
    }
  }
  if (indices.length <= 6) {
    permute([], indices)
  } else {
    // Greedy fallback for very large ember counts.
    const remaining = new Set(indices)
    let cursor = 0
    let total = 0
    while (remaining.size) {
      let bestIndex = null
      let bestDist = Infinity
      for (const index of remaining) {
        const d = distance(cursor, index + 1)
        if (d < bestDist) {
          bestDist = d
          bestIndex = index
        }
      }
      total += bestDist
      cursor = bestIndex + 1
      remaining.delete(bestIndex)
    }
    total += distance(cursor, points.length - 1)
    best = total
  }
  return { length: best, order: bestOrder }
}

function placeEmbers(grid, start, exit, difficulty, rng) {
  const distanceFromStart = bfs(grid, start)
  const distanceFromExit = bfs(grid, exit)
  const width = grid[0].length
  const key = (r, c) => r * width + c
  const direct = distanceFromStart.get(key(...exit)) || 1
  const wanted = Math.min(6, 3 + Math.floor(difficulty / 3))
  const candidates = openCells(grid).filter(([r, c]) => {
    if ((r === start[0] && c === start[1]) || (r === exit[0] && c === exit[1])) return false
    const ds = distanceFromStart.get(key(r, c))
    const de = distanceFromExit.get(key(r, c))
    return ds >= 2 && de >= 1
  })
  const deadEnds = candidates.filter(([r, c]) => neighbors(grid, r, c).length === 1)
  const pool = [...deadEnds, ...shuffle([...candidates], rng)]

  let best = null
  for (let attempt = 0; attempt < 26; attempt++) {
    shuffle(pool, rng)
    const picked = []
    for (const cell of pool) {
      if (picked.length >= wanted) break
      if (picked.some(([r, c]) => Math.abs(r - cell[0]) + Math.abs(c - cell[1]) < 2)) continue
      if (Math.abs(cell[0] - start[0]) + Math.abs(cell[1] - start[1]) < 2) continue
      if (Math.abs(cell[0] - exit[0]) + Math.abs(cell[1] - exit[1]) < 2) continue
      picked.push(cell)
    }
    if (picked.length < 2) continue
    const route = routeLength(grid, start, picked, exit)
    const ratio = route.length / Math.max(1, direct)
    const score = Math.abs(ratio - 1.75) + (picked.length < wanted ? 0.5 : 0)
    if (!best || score < best.score) best = { embers: picked, route, score, ratio }
  }
  return best
}

function actionsToPath(level, actions) {
  let state = createState(level)
  const path = [state.pos]
  for (const action of actions) {
    const result = step(level, state, action)
    if (!result.ok) break
    path.push(...result.path)
    state = result.state
    if (state.status !== 'playing') break
  }
  return { path, state }
}

function tryLevel(grid, { sentries = [], par = 0 } = {}) {
  try {
    const def = { rows: toRows(grid), sentries }
    const level = parseLevel(def)
    const solution = solveLevel(level, { maxStates: 220000 })
    if (!solution.solved) return null
    level.optimal = solution.optimal
    level.par = par || Math.max(1, Math.min(4, Math.round(solution.optimal * 0.1)))
    return { level, solution, sentryDefs: sentries }
  } catch {
    return null
  }
}

function findStraightSegments(grid, length, { plainOnly = false } = {}) {
  const segments = []
  const height = grid.length
  const width = grid[0].length
  const allowed = new Set([FLOOR, ICE])
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      if (!allowed.has(grid[r][c])) continue
      // Horizontal
      if (c + length <= width - 1) {
        let ok = true
        for (let i = 0; i < length; i++) {
          const ch = grid[r][c + i]
          if (!allowed.has(ch)) {
            ok = false
            break
          }
          if (plainOnly && (grid[r - 1][c + i] !== WALL || grid[r + 1][c + i] !== WALL)) {
            ok = false
            break
          }
        }
        if (ok) segments.push({ cells: Array.from({ length }, (_, i) => [r, c + i]), dir: 'h' })
      }
      // Vertical
      if (r + length <= height - 1) {
        let ok = true
        for (let i = 0; i < length; i++) {
          const ch = grid[r + i][c]
          if (!allowed.has(ch)) {
            ok = false
            break
          }
          if (plainOnly && (grid[r + i][c - 1] !== WALL || grid[r + i][c + 1] !== WALL)) {
            ok = false
            break
          }
        }
        if (ok) segments.push({ cells: Array.from({ length }, (_, i) => [r + i, c]), dir: 'v' })
      }
    }
  }
  return segments
}

function addIce(grid, base, rng) {
  const segments = findStraightSegments(grid, 3, { plainOnly: true }).filter((segment) =>
    segment.cells.every(([r, c]) => [FLOOR].includes(grid[r][c])),
  )
  shuffle(segments, rng)
  for (const segment of segments.slice(0, 12)) {
    const cells = segment.cells
    const start = Math.max(0, Math.floor(rng() * Math.max(1, cells.length - 1)))
    const take = cells.slice(start, start + 2 + Math.floor(rng() * 2))
    if (take.length < 2) continue
    for (const [r, c] of take) grid[r][c] = ICE
    const result = tryLevel(grid, { par: base.par })
    if (result && result.solution.optimal <= base.solution.optimal + 5) return result
    for (const [r, c] of take) grid[r][c] = FLOOR
  }
  return null
}

function addPortals(grid, base, rng) {
  const cells = openCells(grid).filter(([r, c]) => grid[r][c] === FLOOR)
  const deadEnds = cells.filter(([r, c]) => neighbors(grid, r, c).length === 1)
  if (deadEnds.length < 2) return null
  shuffle(deadEnds, rng)
  for (let i = 0; i < deadEnds.length; i++) {
    for (let j = i + 1; j < deadEnds.length; j++) {
      const a = deadEnds[i]
      const b = deadEnds[j]
      const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
      if (d < 5) continue
      grid[a[0]][a[1]] = PORTAL_A
      grid[b[0]][b[1]] = PORTAL_B
      const result = tryLevel(grid, { par: base.par })
      if (result && result.solution.optimal <= base.solution.optimal + 10) return result
      grid[a[0]][a[1]] = FLOOR
      grid[b[0]][b[1]] = FLOOR
    }
  }
  return null
}

function addCracked(grid, base, rng) {
  const { path } = actionsToPath(base.level, base.solution.actions)
  const candidates = [...new Set(path)].filter((index) => {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    return grid[r][c] === FLOOR && index !== base.level.start && index !== base.level.exit
  })
  shuffle(candidates, rng)
  const chosen = candidates.slice(0, 1 + Math.floor(rng() * 2))
  if (!chosen.length) return null
  for (const index of chosen) {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    grid[r][c] = CRACKED
  }
  const result = tryLevel(grid, { par: base.par })
  if (result) return result
  for (const index of chosen) {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    grid[r][c] = FLOOR
  }
  return null
}

function addFlames(grid, base, rng) {
  const { path } = actionsToPath(base.level, base.solution.actions)
  const candidates = [...new Set(path)].filter((index) => {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    return grid[r][c] === FLOOR && index !== base.level.start && index !== base.level.exit
  })
  shuffle(candidates, rng)
  const count = 1 + Math.floor(rng() * 2)
  const chosen = candidates.slice(0, count)
  if (!chosen.length) return null
  for (const index of chosen) {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    grid[r][c] = FLAME
  }
  const result = tryLevel(grid, { par: base.par })
  if (result) return result
  for (const index of chosen) {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    grid[r][c] = FLOOR
  }
  return null
}

function addKeyGate(grid, base, rng) {
  const { path } = actionsToPath(base.level, base.solution.actions)
  const pathCells = [...new Set(path)]
  const gateCandidates = pathCells.filter((index) => {
    const r = Math.floor(index / base.level.width)
    const c = index % base.level.width
    return grid[r][c] === FLOOR && index !== base.level.start && index !== base.level.exit
  })
  shuffle(gateCandidates, rng)
  const width = base.level.width
  for (const gateIndex of gateCandidates.slice(0, 8)) {
    const gr = Math.floor(gateIndex / width)
    const gc = gateIndex % width
    grid[gr][gc] = GATE
    // Reachability without the gate.
    const blockedGrid = grid.map((row) => [...row])
    blockedGrid[gr][gc] = WALL
    const reachable = bfs(blockedGrid, [Math.floor(base.level.start / width), base.level.start % width])
    const keyCandidates = openCells(blockedGrid).filter(([r, c]) => {
      const idx = r * width + c
      return grid[r][c] === FLOOR && reachable.has(idx) && idx !== base.level.start && idx !== base.level.exit
    })
    shuffle(keyCandidates, rng)
    for (const [kr, kc] of keyCandidates.slice(0, 12)) {
      grid[kr][kc] = KEY
      const result = tryLevel(grid, { par: base.par })
      if (result) return result
      grid[kr][kc] = FLOOR
    }
    grid[gr][gc] = FLOOR
  }
  return null
}

function addSentry(grid, base, rng) {
  const segments = findStraightSegments(grid, 3).filter((segment) =>
    segment.cells.every(([r, c]) => grid[r][c] === FLOOR),
  )
  shuffle(segments, rng)
  for (const segment of segments.slice(0, 22)) {
    const cells = segment.cells.slice(0, 3 + Math.floor(rng() * 3))
    if (cells.length < 3) continue
    const sentry = { path: cells, mode: 'pingpong', startIndex: Math.floor(rng() * cells.length) }
    const result = tryLevel(grid, { sentries: [sentry], par: base.par })
    if (result) return result
  }
  return null
}

function addSecondSentry(grid, base, rng) {
  const segments = findStraightSegments(grid, 3).filter((segment) =>
    segment.cells.every(([r, c]) => grid[r][c] === FLOOR),
  )
  shuffle(segments, rng)
  for (const segment of segments.slice(0, 22)) {
    const cells = segment.cells.slice(0, 3 + Math.floor(rng() * 2))
    if (cells.length < 3) continue
    const sentries = [...(base.sentryDefs || []), { path: cells, mode: 'pingpong', startIndex: Math.floor(rng() * cells.length) }]
    const result = tryLevel(grid, { sentries, par: base.par })
    if (result) return result
  }
  return null
}

/**
 * Generate one validated level. Returns null when this seed cannot produce a
 * clean level (the caller should retry with another seed).
 */
export function generateLevel({ seed = 'seed', difficulty = 1, name = '', id = '' } = {}) {
  const rng = mulberry32(hashString(seed))
  const levelDifficulty = Math.max(1, Math.min(10, difficulty))
  const [width, height] = DIMS[levelDifficulty] || DIMS[5]
  const grid = carveMaze(rng, width, height)
  const cells = openCells(grid)
  if (cells.length < 12) return null

  const start = cells[Math.floor(rng() * Math.min(cells.length, 6))]
  const distances = bfs(grid, start)
  let exit = start
  let farthest = -1
  for (const [r, c] of cells) {
    const d = distances.get(r * width + c) || 0
    if (d > farthest) {
      farthest = d
      exit = [r, c]
    }
  }
  if (farthest < 6) return null

  const picked = placeEmbers(grid, start, exit, levelDifficulty, rng)
  if (!picked || picked.embers.length < 2) return null

  grid[start[0]][start[1]] = START
  grid[exit[0]][exit[1]] = EXIT
  for (const [r, c] of picked.embers) grid[r][c] = EMBER

  let base = tryLevel(grid)
  if (!base) return null

  if (levelDifficulty >= 3) {
    const ice = addIce(grid, base, rng)
    if (ice) base = ice
  }
  if (levelDifficulty >= 4) {
    const portals = addPortals(grid, base, rng)
    if (portals) base = portals
  }
  if (levelDifficulty >= 5) {
    const cracked = addCracked(grid, base, rng)
    if (cracked) base = cracked
  }
  if (levelDifficulty >= 6) {
    const flames = addFlames(grid, base, rng)
    if (flames) base = flames
  }
  if (levelDifficulty >= 7) {
    const keyGate = addKeyGate(grid, base, rng)
    if (keyGate) base = keyGate
  }
  if (levelDifficulty >= 8) {
    const sentry = addSentry(grid, base, rng)
    if (sentry) base = sentry
  }
  if (levelDifficulty >= 10) {
    const second = addSecondSentry(grid, base, rng)
    if (second) base = second
  }

  const final = tryLevel(grid, { sentries: base.sentryDefs || [] })
  if (!final) return null

  const emberCount = final.level.emberCells.length
  const par = Math.max(final.solution.optimal + 1, Math.round(final.solution.optimal * 1.12))
  const featureList = []
  if (grid.flat().includes(ICE)) featureList.push('ice')
  if (grid.flat().includes(PORTAL_A)) featureList.push('portal')
  if (grid.flat().includes(CRACKED)) featureList.push('cracked')
  if (grid.flat().includes(FLAME)) featureList.push('flame')
  if (grid.flat().includes(KEY)) featureList.push('key')
  if (final.level.sentries.length) featureList.push('sentry')

  const nameIndex = (hashString(seed) + levelDifficulty) % LEVEL_NAMES.length
  return {
    id: id || `gen-${seed}`,
    name: name || LEVEL_NAMES[nameIndex],
    rows: toRows(grid),
    par,
    optimal: final.solution.optimal,
    difficulty: levelDifficulty,
    features: featureList,
    embers: emberCount,
    sentries: (final.sentryDefs || []).map((s) => ({
      path: s.path.map(([r, c]) => [r, c]),
      mode: s.mode,
      startIndex: s.startIndex,
    })),
    seed,
  }
}

/**
 * Try a handful of seeds until a valid level is produced.
 */
export function generateStable({ seed, difficulty, name, id, attempts = 12 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateLevel({
      seed: `${seed}::${i}`,
      difficulty,
      name,
      id,
    })
    if (candidate) return candidate
  }
  return null
}
