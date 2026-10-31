import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseLevel,
  createState,
  step,
  solveLevel,
  computeLevelScore,
  stateKey,
  sentryAt,
} from '../src/rules.js'
import { getWeekInfo, getWeeklyLevels } from '../src/season.js'
import { CAMPAIGN_LEVELS } from '../src/data/campaign.js'
import { WEEKLY_POOL } from '../src/data/weekly-pool.js'

function level(rows, extra = {}) {
  return parseLevel({ rows, ...extra })
}

function play(levelDef, actions) {
  let state = createState(levelDef)
  for (const action of actions) {
    const result = step(levelDef, state, action)
    if (!result.ok) return { state, result }
    state = result.state
  }
  return { state, result: null }
}

test('basic movement collects embers and wins on the exit', () => {
  const l = level(['#######', '#S.*.E#', '#######'])
  const solution = solveLevel(l)
  assert.equal(solution.solved, true)
  assert.equal(solution.optimal, 4)
  const { state } = play(l, solution.actions)
  assert.equal(state.status, 'won')
  assert.equal(state.embers, 0b1)
})

test('walls block without consuming a turn', () => {
  const l = level(['#####', '#S.E#', '#####'])
  const state = createState(l)
  const result = step(l, state, 'up')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'blocked')
  assert.equal(state.moves, 0)
})

test('ice slides until the next tile is blocked', () => {
  const l = level(['#######', '#SII.E#', '#######'])
  const solution = solveLevel(l)
  assert.equal(solution.solved, true)
  assert.equal(solution.optimal, 2)
  const first = play(l, ['right'])
  assert.equal(first.state.pos, 11)
  const second = play(l, ['right', 'right'])
  assert.equal(second.state.status, 'won')
})

test('portals teleport in the same turn', () => {
  const l = level([
    '#######',
    '#S.P..#',
    '#..#..#',
    '#..Q.E#',
    '#######',
  ])
  const solution = solveLevel(l)
  assert.equal(solution.solved, true)
  const { state } = play(l, solution.actions)
  assert.equal(state.status, 'won')
})

test('cracked floors crumble behind the player', () => {
  const l = level(['#######', '#S~..E#', '#######'])
  const first = step(l, createState(l), 'right')
  assert.equal(first.ok, true)
  assert.equal(first.state.pos, 9)
  assert.equal(first.state.crumbled, 0)
  const second = step(l, first.state, 'right')
  assert.equal(second.ok, true)
  assert.equal(second.state.crumbled, 1)
  const back = step(l, second.state, 'left')
  assert.equal(back.ok, false)
  assert.equal(back.reason, 'blocked')
})

test('flame gates block on even turns and can be waited out', () => {
  const l = level(['#######', '#S^.E.#', '#######'])
  const blocked = step(l, createState(l), 'right')
  assert.equal(blocked.ok, false)
  const solution = solveLevel(l)
  assert.equal(solution.solved, true)
  assert.equal(solution.actions[0], 'wait')
  const { state } = play(l, solution.actions)
  assert.equal(state.status, 'won')
})

test('sentries move after the player and can extinguish the spark', () => {
  const l = level(['#######', '#S.E..#', '#######'], {
    sentries: [{ path: [[1, 1], [1, 2]], mode: 'pingpong', startIndex: 1 }],
  })
  const state = createState(l)
  assert.equal(sentryAt(l, state, 9), l.sentries[0])
  const result = step(l, state, 'wait')
  assert.equal(result.ok, true)
  assert.equal(result.died, true)
})

test('key opens every gate', () => {
  const l = level([
    '#######',
    '#S.KG.#',
    '#....E#',
    '#######',
  ])
  const solution = solveLevel(l)
  assert.equal(solution.solved, true)
  const { state } = play(l, solution.actions)
  assert.equal(state.status, 'won')
  assert.equal(state.key, true)
})

test('level score rewards efficiency, chains and a perfect route', () => {
  const l = level(['#######', '#S.*.E#', '#######'])
  l.optimal = 4
  l.par = 6
  const state = createState(l)
  state.moves = 4
  state.maxChain = 1
  const score = computeLevelScore(l, state, { undoCount: 1 })
  assert.equal(score.total, 300 + 75 + 2 * 30 + 200 + 40 + 150 - 20)
  assert.equal(score.perfect, 150)
  assert.equal(score.penalty, 20)
})

test('state keys are stable and include the turn phase', () => {
  const l = level(['#######', '#S^.E.#', '#######'])
  const state = createState(l)
  const key = stateKey(l, state)
  assert.equal(key, stateKey(l, { ...state }))
  const waited = step(l, state, 'wait').state
  assert.notEqual(key, stateKey(l, waited))
})

test('ISO week boundaries are correct', () => {
  assert.equal(getWeekInfo(new Date('2026-10-31T12:00:00Z')).id, '2026-W44')
  assert.equal(getWeekInfo(new Date('2026-01-01T12:00:00Z')).id, '2026-W01')
  assert.equal(getWeekInfo(new Date('2025-12-29T12:00:00Z')).id, '2026-W01')
  const week = getWeekInfo(new Date('2026-10-31T12:00:00Z'))
  assert.equal(week.start.toISOString(), '2026-10-26T00:00:00.000Z')
  assert.equal(week.end.toISOString(), '2026-11-02T00:00:00.000Z')
})

test('campaign levels are valid and solvable', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 12)
  for (const def of CAMPAIGN_LEVELS) {
    const l = parseLevel(def)
    const solution = solveLevel(l, { maxStates: 400000 })
    assert.equal(solution.solved, true, `${def.name} must be solvable`)
    assert.equal(solution.optimal, def.optimal, `${def.name} optimal mismatch`)
    assert.ok(def.par >= def.optimal)
  }
})

test('weekly selection is deterministic, unique and solvable', () => {
  const week = getWeekInfo(new Date('2026-10-31T12:00:00Z'))
  const a = getWeeklyLevels(week.id)
  const b = getWeeklyLevels(week.id)
  assert.equal(a.length, 5)
  assert.deepEqual(a.map((l) => l.id), b.map((l) => l.id))
  assert.equal(new Set(a.map((l) => l.id)).size, 5)
  for (const def of a) {
    const l = parseLevel(def)
    const solution = solveLevel(l, { maxStates: 400000 })
    assert.equal(solution.solved, true, `${def.name} must be solvable after transform`)
    assert.equal(solution.optimal, def.optimal, `${def.name} transform changed the optimum`)
  }
})

test('weekly pool has enough variety and no broken levels', () => {
  assert.ok(WEEKLY_POOL.length >= 80)
  const features = new Set(WEEKLY_POOL.flatMap((level) => level.features))
  for (const feature of ['ice', 'portal', 'cracked', 'flame', 'key', 'sentry']) {
    assert.ok(features.has(feature), `pool should include ${feature}`)
  }
})
