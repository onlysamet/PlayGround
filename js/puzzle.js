/*
 * PRISMA — deterministic weekly light-puzzle generator.
 *
 * A puzzle is a grid with one emitter, a number of rotatable mirrors and a set
 * of crystals. The beam passes through crystals (charging them) and reflects
 * from mirrors. Every weekly puzzle is produced from a stable seed so every
 * player receives the same board during the same UTC week.
 */

export const DIRS = { R: [1, 0], D: [0, 1], L: [-1, 0], U: [0, -1] }
const LEFT = { R: 'U', U: 'L', L: 'D', D: 'R' }
const RIGHT = { R: 'D', D: 'L', L: 'U', U: 'R' }
const REFLECT = {
  0: { R: 'U', U: 'R', L: 'D', D: 'L' }, // "/"
  1: { R: 'D', D: 'R', L: 'U', U: 'L' }, // "\"
}

export function hash32(value) {
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
  return function next() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRng(seed) {
  const next = mulberry32(hash32(seed))
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (a, b) => a + Math.floor(next() * (b - a + 1)),
    bool: (p = 0.5) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
      }
      return out
    },
  }
}

export function popcount(n) {
  let c = 0
  while (n) {
    n &= n - 1
    c++
  }
  return c
}

export function traceBeam(puzzle, orientations) {
  const mirrorAt = new Map()
  puzzle.mirrors.forEach((m, i) => mirrorAt.set(m.y * puzzle.w + m.x, i))
  const crystalAt = new Map()
  puzzle.crystals.forEach((c, i) => crystalAt.set(c.y * puzzle.w + c.x, i))
  const walls = new Set(puzzle.walls.map((w) => w.y * puzzle.w + w.x))

  let { x, y, dir } = puzzle.emitter
  const points = [{ x, y }]
  const lit = []
  const seen = new Set()
  let loop = false

  for (let step = 0; step < 400; step++) {
    const state = `${x},${y},${dir}`
    if (seen.has(state)) {
      loop = true
      break
    }
    seen.add(state)

    const d = DIRS[dir]
    x += d[0]
    y += d[1]
    points.push({ x, y })

    if (x < 0 || y < 0 || x >= puzzle.w || y >= puzzle.h) break
    const cell = y * puzzle.w + x
    if (walls.has(cell)) break

    const mi = mirrorAt.get(cell)
    if (mi !== undefined) dir = REFLECT[orientations[mi] & 1][dir]

    const ci = crystalAt.get(cell)
    if (ci !== undefined && !lit.includes(ci)) lit.push(ci)
  }

  return { points, lit, loop }
}

export function isSolved(puzzle, orientations) {
  return traceBeam(puzzle, orientations).lit.length === puzzle.crystals.length
}

export function enumerateSolutions(puzzle) {
  const total = 1 << puzzle.mirrors.length
  const solutions = []
  for (let mask = 0; mask < total; mask++) {
    const orientations = []
    for (let i = 0; i < puzzle.mirrors.length; i++) orientations.push((mask >> i) & 1)
    const trace = traceBeam(puzzle, orientations)
    if (trace.lit.length === puzzle.crystals.length) solutions.push(mask)
  }
  return solutions
}

/* Pick a solution mask reachable with the fewest mirror rotations. */
export function nearestSolution(puzzle, orientations) {
  let mask = 0
  orientations.forEach((o, i) => {
    if (o & 1) mask |= 1 << i
  })
  let best = null
  let bestDistance = Infinity
  for (const solution of puzzle.solutions || []) {
    const distance = popcount(mask ^ solution)
    if (distance < bestDistance) {
      bestDistance = distance
      best = solution
    }
  }
  return best === null ? null : { mask: best, distance: bestDistance }
}

function buildPath(rng, width, height, targetMirrors, targetCrystals) {
  const startSide = rng.int(4)
  let x, y, dir
  if (startSide === 0) {
    x = rng.range(1, width - 2)
    y = 0
    dir = 'D'
  } else if (startSide === 1) {
    x = width - 1
    y = rng.range(1, height - 2)
    dir = 'L'
  } else if (startSide === 2) {
    x = rng.range(1, width - 2)
    y = height - 1
    dir = 'U'
  } else {
    x = 0
    y = rng.range(1, height - 2)
    dir = 'R'
  }

  const emitter = { x, y, dir }
  const visited = new Set([y * width + x])
  const path = [{ x, y }]
  const mirrors = []
  let stepsSinceTurn = 0
  let steps = 0
  let exited = false

  while (steps < 44) {
    if (mirrors.length < targetMirrors && path.length > 2 && stepsSinceTurn >= 1 && rng.bool(0.58)) {
      const nextDir = rng.bool() ? LEFT[dir] : RIGHT[dir]
      const delta = DIRS[nextDir]
      const nx = x + delta[0]
      const ny = y + delta[1]
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && !visited.has(ny * width + nx)) {
        const orientation = REFLECT[0][dir] === nextDir ? 0 : 1
        mirrors.push({ x, y, orientation })
        dir = nextDir
        stepsSinceTurn = 0
      }
    }

    const delta = DIRS[dir]
    const nx = x + delta[0]
    const ny = y + delta[1]
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
      exited = true
      break
    }
    if (visited.has(ny * width + nx)) break

    x = nx
    y = ny
    visited.add(y * width + x)
    path.push({ x, y })
    steps++
    stepsSinceTurn++
  }

  if (!exited || mirrors.length < targetMirrors || stepsSinceTurn < 2) return null
  if (path.length < targetMirrors + targetCrystals + 3) return null

  const turnCells = new Set(mirrors.map((m) => m.y * width + m.x))
  const candidates = path.filter((cell, index) => index > 0 && !turnCells.has(cell.y * width + cell.x))
  if (candidates.length < targetCrystals) return null

  const chosen = []
  const pool = candidates.slice()
  for (let i = 0; i < targetCrystals; i++) {
    // Bias towards crystals spread along the path instead of a cluster.
    const index = Math.floor((i + 0.35 + rng.next() * 0.5) * (pool.length / targetCrystals))
    const cell = pool[Math.min(index, pool.length - 1)]
    chosen.push(cell)
    pool.splice(Math.min(index, pool.length - 1), 1)
  }
  const crystals = chosen.sort((a, b) => path.indexOf(a) - path.indexOf(b))

  const walls = []
  const wallChance = rng.range(12, 18) / 100
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const key = cy * width + cx
      if (visited.has(key)) continue
      if (cx === emitter.x && cy === emitter.y) continue
      if (rng.bool(wallChance)) walls.push({ x: cx, y: cy })
    }
  }

  return { emitter, mirrors, crystals, walls }
}

/**
 * Generate one board.
 * opts: { width, height, mirrorCount, crystalCount, minPar, maxPar, slack }
 */
export function generatePuzzle(seed, opts = {}) {
  const {
    width = 9,
    height = 9,
    mirrorCount = 5,
    crystalCount = 3,
    minPar = 3,
    maxPar = 5,
    slack = 2,
  } = opts

  const rng = makeRng(seed)
  for (let attempt = 0; attempt < 140; attempt++) {
    const built = buildPath(rng, width, height, mirrorCount, crystalCount)
    if (!built) continue

    const puzzle = {
      seed,
      w: width,
      h: height,
      emitter: built.emitter,
      mirrors: built.mirrors.map((m) => ({ x: m.x, y: m.y })),
      crystals: built.crystals,
      walls: built.walls,
    }

    const generatedMask = built.mirrors.reduce((mask, m, i) => mask | ((m.orientation & 1) << i), 0)
    const solutions = enumerateSolutions(puzzle)
    if (!solutions.includes(generatedMask)) continue

    const count = puzzle.mirrors.length
    const candidates = []
    for (let mask = 0; mask < 1 << count; mask++) {
      let bestDistance = Infinity
      for (const solution of solutions) {
        const distance = popcount(mask ^ solution)
        if (distance < bestDistance) bestDistance = distance
      }
      if (bestDistance >= minPar && bestDistance <= maxPar) candidates.push({ mask, par: bestDistance })
    }
    if (!candidates.length) continue

    const chosen = rng.pick(candidates)
    const initialOrientations = []
    for (let i = 0; i < count; i++) initialOrientations.push((chosen.mask >> i) & 1)

    puzzle.initialOrientations = initialOrientations
    puzzle.solutions = solutions
    puzzle.par = chosen.par
    puzzle.budget = chosen.par + slack
    return puzzle
  }

  return null
}

export const WEEK_LEVELS = [
  { mirrorCount: 4, crystalCount: 2, minPar: 3, maxPar: 3, slack: 3 },
  { mirrorCount: 4, crystalCount: 2, minPar: 3, maxPar: 4, slack: 3 },
  { mirrorCount: 5, crystalCount: 3, minPar: 4, maxPar: 4, slack: 2 },
  { mirrorCount: 5, crystalCount: 3, minPar: 4, maxPar: 5, slack: 2 },
  { mirrorCount: 6, crystalCount: 3, minPar: 5, maxPar: 6, slack: 2 },
  { mirrorCount: 7, crystalCount: 4, minPar: 6, maxPar: 7, slack: 1 },
]

export function generateWeek(seed) {
  const levels = []
  for (let i = 0; i < WEEK_LEVELS.length; i++) {
    let puzzle = null
    const base = WEEK_LEVELS[i]
    for (let attempt = 0; attempt < 8 && !puzzle; attempt++) {
      puzzle = generatePuzzle(`${seed}:level:${i}:try:${attempt}`, base)
    }
    if (!puzzle) {
      // Very unlikely, but never leave a player with a broken week.
      puzzle = generatePuzzle(`${seed}:fallback:${i}`, {
        ...base,
        minPar: Math.max(2, base.minPar - 1),
        maxPar: base.maxPar + 1,
      })
    }
    if (!puzzle) throw new Error(`Could not generate weekly level ${i + 1}`)
    levels.push(puzzle)
  }
  return levels
}
