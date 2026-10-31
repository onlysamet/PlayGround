import {
  parseLevel,
  createState,
  cloneState,
  step,
  computeLevelScore,
} from './rules.js'

const WEEKLY_CANS = 3
const DEATH_PENALTY = 50

export class Game {
  constructor({ onEvent } = {}) {
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {}
    this.level = null
    this.state = null
    this.run = null
    this.undoStack = []
    this.undoCount = 0
    this.levelDeaths = 0
    this.levelResult = null
    this.levelStartedAt = 0
    this.moveLog = []
  }

  emit(type, detail = {}) {
    this.onEvent({ type, ...detail })
  }

  startWeekly(levels, weekId) {
    this.run = {
      mode: 'weekly',
      weekId,
      levels,
      index: 0,
      scores: [],
      cans: WEEKLY_CANS,
      deaths: 0,
      total: 0,
      status: 'playing',
      startedAt: Date.now(),
    }
    this.startLevel(0)
  }

  startCampaign(levelDef, index, total = 1) {
    this.run = {
      mode: 'campaign',
      weekId: null,
      levels: [levelDef],
      index,
      total,
      scores: [],
      cans: Infinity,
      deaths: 0,
      totalScore: 0,
      status: 'playing',
      startedAt: Date.now(),
    }
    this.startLevel(0)
    // Campaign runs hold one level in `levels`, but the visible chapter index
    // is the position in the full campaign. startLevel() resets run.index to 0,
    // so restore the chapter index after the level has been prepared.
    this.run.index = index
  }

  startLevel(index) {
    if (!this.run) return
    const def = this.run.levels[index]
    if (!def) return
    this.run.index = index
    this.level = parseLevel(def)
    this.state = createState(this.level)
    this.undoStack = []
    this.undoCount = 0
    this.levelDeaths = 0
    this.levelResult = null
    this.levelStartedAt = Date.now()
    this.moveLog = []
    this.emit('levelstart', { level: this.level, state: cloneState(this.state), run: this.run })
  }

  get playing() {
    return Boolean(this.state && this.state.status === 'playing')
  }

  get cans() {
    return this.run?.mode === 'weekly' ? this.run.cans : Infinity
  }

  pushSnapshot() {
    this.undoStack.push({
      state: cloneState(this.state),
      undoCount: this.undoCount,
    })
    if (this.undoStack.length > 80) this.undoStack.shift()
  }

  move(action) {
    if (!this.playing) return null
    const before = cloneState(this.state)
    this.pushSnapshot()
    const result = step(this.level, this.state, action)
    if (!result.ok) {
      this.undoStack.pop()
      this.emit('bump', { action, reason: result.reason, state: cloneState(this.state) })
      return result
    }

    this.state = result.state
    this.moveLog.push(action)

    this.emit('move', {
      action,
      from: before.pos,
      to: this.state.pos,
      path: result.path,
      teleported: result.teleported,
      state: cloneState(this.state),
    })

    for (const index of result.collected) {
      this.emit('ember', {
        index,
        total: this.level.emberCells.length,
        collected: countBits(this.state.embers),
        chain: this.state.chain,
      })
    }
    if (!before.key && this.state.key) {
      this.emit('key', { index: this.level.keyCells[0], state: cloneState(this.state) })
    }
    if (this.state.status === 'playing' && this.state.chain > 1) {
      this.emit('chain', { chain: this.state.chain, state: cloneState(this.state) })
    }

    if (result.died) {
      this.handleDeath()
      return result
    }
    if (result.won) {
      this.handleWin()
      return result
    }
    this.emit('state', { state: cloneState(this.state), run: this.run })
    return result
  }

  wait() {
    return this.move('wait')
  }

  handleDeath() {
    this.levelDeaths += 1
    if (this.run) this.run.deaths += 1
    this.undoStack = []
    const detail = {
      reason: this.state.deathReason || 'sentry',
      state: cloneState(this.state),
      level: this.level,
      cans: this.cans,
      run: this.run,
    }
    if (this.run?.mode === 'weekly') {
      this.run.cans = Math.max(0, this.run.cans - 1)
      detail.cans = this.run.cans
      if (this.run.cans <= 0) {
        this.finishRun('out-of-cans')
      }
    }
    this.emit('death', detail)
  }

  handleWin() {
    const breakdown = computeLevelScore(this.level, this.state, { undoCount: this.undoCount })
    this.levelResult = {
      level: this.level,
      state: cloneState(this.state),
      breakdown,
      undoCount: this.undoCount,
      deaths: this.levelDeaths,
    }
    this.emit('win', {
      ...this.levelResult,
      run: this.run,
      isLast: this.run?.mode === 'weekly' ? this.run.index >= this.run.levels.length - 1 : true,
    })
  }

  nextLevel() {
    if (!this.run || !this.levelResult) return null
    if (this.run.mode === 'weekly') {
      this.run.scores.push({
        levelId: this.level.id,
        name: this.level.name,
        score: this.levelResult.breakdown.total,
        moves: this.state.moves,
        optimal: this.level.optimal,
        breakdown: this.levelResult.breakdown,
      })
      this.run.total = this.run.scores.reduce((sum, entry) => sum + entry.score, 0)
      const next = this.run.index + 1
      if (next >= this.run.levels.length) {
        this.finishRun('complete')
        return null
      }
      this.startLevel(next)
      return next
    }

    this.run.scores.push({
      levelId: this.level.id,
      name: this.level.name,
      score: this.levelResult.breakdown.total,
      moves: this.state.moves,
      optimal: this.level.optimal,
      breakdown: this.levelResult.breakdown,
    })
    const next = this.run.index + 1
    this.emit('campaign-next', { next, total: this.run.total, result: this.levelResult })
    return next
  }

  retryLevel() {
    if (!this.run) return
    this.startLevel(this.run.index)
  }

  restartLevel({ costCan = true } = {}) {
    if (!this.run) return false
    if (this.run.mode === 'weekly' && costCan) {
      this.run.cans = Math.max(0, this.run.cans - 1)
      if (this.run.cans <= 0) {
        this.finishRun('out-of-cans')
        return false
      }
    }
    this.startLevel(this.run.index)
    return true
  }

  undo() {
    if (!this.playing || !this.undoStack.length) return false
    const snapshot = this.undoStack.pop()
    this.state = snapshot.state
    this.undoCount = Math.max(this.undoCount, snapshot.undoCount) + 1
    this.emit('undo', { state: cloneState(this.state), undoCount: this.undoCount })
    this.emit('state', { state: cloneState(this.state), run: this.run })
    return true
  }

  finishRun(reason = 'complete') {
    if (!this.run) return
    this.run.status = reason
    const raw = this.run.scores.reduce((sum, entry) => sum + entry.score, 0)
    const penalty = this.run.mode === 'weekly' ? this.run.deaths * DEATH_PENALTY : 0
    this.run.total = Math.max(0, raw - penalty)
    this.run.penalty = penalty
    this.emit('runend', {
      run: this.run,
      reason,
      total: this.run.total,
      penalty,
      scores: this.run.scores,
    })
  }

  get scorePreview() {
    if (!this.level || !this.state) return null
    return computeLevelScore(this.level, this.state, { undoCount: this.undoCount })
  }

  get collectedEmbers() {
    return this.state ? countBits(this.state.embers) : 0
  }

  get totalEmbers() {
    return this.level ? this.level.emberCells.length : 0
  }
}

export function countBits(value) {
  let count = 0
  let v = value
  while (v) {
    v &= v - 1
    count++
  }
  return count
}
