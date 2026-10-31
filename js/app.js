import { generateWeek, traceBeam, isSolved, nearestSolution } from './puzzle.js'
import {
  getWeekInfo,
  previousWeekKey,
  formatCountdown,
  formatDuration,
  weekSeed,
} from './week.js'
import {
  WeeklyLeague,
  getProfile,
  saveProfile,
  normalizeName,
  avatarFor,
  initialsFor,
  getLocalEntries,
} from './leaderboard.js'
import { createBoardRenderer } from './renderer.js'
import { audio } from './audio.js'
import { CONFIG } from './config.js'

const LEVEL_TITLES = [
  'İlk Kırılma',
  'Ayna Bahçesi',
  'Sessiz Koridor',
  'Kırık Spektrum',
  'Gölge Prizması',
  'Son Işın',
]

const SCORE = {
  base: 400,
  crystal: 120,
  turn: 140,
  perfect: 300,
  streak: 50,
  hint: 150,
}

const RUN_KEY = 'prisma.run.v3'
const MAX_LEVELS = 6
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
const numberFormat = new Intl.NumberFormat('tr-TR')

const $ = (id) => document.getElementById(id)
const state = {
  phase: 'start',
  week: null,
  levelsWeek: '',
  levels: [],
  levelIndex: 0,
  puzzle: null,
  orientations: [],
  angles: [],
  angleAnims: [],
  turns: 0,
  hintIndex: -1,
  hintPenalty: 0,
  streak: 0,
  totalScore: 0,
  totalCrystals: 0,
  levelResults: [],
  levelStart: 0,
  elapsedBase: 0,
  sessionStart: 0,
  finalTime: 0,
  finalResult: null,
  solved: false,
  solvedAt: 0,
  trace: null,
  prevLit: [],
  beamProgress: 1,
  beamChangedAt: 0,
  particles: [],
  shake: 0,
  hovered: null,
  cursor: { x: 4, y: 4 },
  showCursor: false,
  displayScore: 0,
  lastDisplayScore: -1,
  scoreDeltaTimer: 0,
  pending: null,
  submitted: false,
  submittedRank: null,
  runWeek: '',
  runLeague: null,
  profile: null,
  league: null,
  savedRun: null,
  modal: null,
  leagueReturnStart: false,
  toastTimer: 0,
  boardToastTimer: 0,
  cursorHideTimer: 0,
  startTimer: 0,
  budgetWarned: false,
  confetti: [],
  fxDirty: false,
  lastFrame: performance.now(),
  lastTickSecond: 0,
}

let renderer = null
let fx = null
let fxCtx = null
let lastHudSecond = 0

/* ---------------------------------- Boot ----------------------------------- */

function init() {
  state.week = getWeekInfo()
  state.levelsWeek = state.week.key
  state.levels = generateWeek(weekSeed(state.week.key, CONFIG.weekSalt))
  state.profile = getProfile()
  state.league = makeLeague(state.week.key)

  $('playerName').value = state.profile.name || ''
  document.body.classList.toggle('muted', audio.muted)
  $('soundBtn').setAttribute('aria-label', audio.muted ? 'Sesi aç' : 'Sesi kapat')

  renderer = createBoardRenderer($('board'))
  fx = $('fxCanvas')
  fxCtx = fx.getContext('2d')
  resizeFx()

  loadSavedRun()
  hydrateStart()
  renderWeekLabels()
  updateCountdownText()
  renderMiniBoard()
  renderStartTop3()
  buildDots()
  bindEvents()
  requestAnimationFrame(loop)

  if (CONFIG.leaderboardApi) {
    state.league.refresh().then(() => {
      renderMiniBoard()
      renderStartTop3()
    }).catch(() => {})
  }

  setInterval(tick, 1000)
  if (new URLSearchParams(window.location.search).has('debug')) exposeDebug()
}

function makeLeague(weekKey) {
  return new WeeklyLeague({
    weekKey,
    playerId: state.profile?.id || getProfile().id,
    apiBase: CONFIG.leaderboardApi,
  })
}

function activeLeague() {
  if (state.phase === 'playing' && state.runWeek && state.runWeek !== state.week.key && state.runLeague) {
    return state.runLeague
  }
  return state.league
}

function loadSavedRun() {
  try {
    const saved = JSON.parse(localStorage.getItem(RUN_KEY) || 'null')
    if (!saved || saved.version !== 3) return
    if (saved.weekKey !== state.week.key || saved.levelIndex >= MAX_LEVELS) {
      localStorage.removeItem(RUN_KEY)
      return
    }
    state.savedRun = saved
  } catch {
    localStorage.removeItem(RUN_KEY)
  }
}

/* ------------------------------- Start screen ------------------------------ */

function hydrateStart() {
  const week = state.week
  $('startWeekNum').textContent = `${week.week}. HAFTA`
  $('startWeekRange').textContent = week.range
  $('panelWeek').textContent = String(week.week).padStart(2, '0')
  if (!$('playerName').value && state.profile.name) $('playerName').value = state.profile.name

  const saved = state.savedRun
  if (saved) {
    const prefix = saved.pending ? 'Bölüm sonucu hazır' : `Bölüm ${saved.levelIndex + 1} / ${MAX_LEVELS}`
    $('startBtnLabel').textContent = 'Devam Et'
    $('resumeHint').textContent = `${prefix} · ${formatScore(saved.totalScore)} puan · kaldığın yerden sürdür.`
    $('newRunBtn').hidden = false
  } else {
    $('startBtnLabel').textContent = 'Haftayı Oyna'
    $('resumeHint').textContent = 'Her hafta aynı altı bulmaca. Herkes aynı tahtada yarışır.'
    $('newRunBtn').hidden = true
  }
  renderStartTop3()
}

function hideStartScreen() {
  const screen = $('startScreen')
  screen.classList.add('is-leaving')
  $('gameLayout').setAttribute('aria-hidden', 'false')
  $('gameLayout').removeAttribute('inert')
  document.querySelector('.topbar')?.removeAttribute('inert')
  clearTimeout(state.startTimer)
  state.startTimer = setTimeout(() => {
    screen.hidden = true
  }, 620)
}

function showStartScreen() {
  clearTimeout(state.startTimer)
  const screen = $('startScreen')
  screen.hidden = false
  screen.classList.add('is-leaving')
  // Force a frame so the entrance transition always runs after a long session.
  requestAnimationFrame(() => screen.classList.remove('is-leaving'))
  $('gameLayout').setAttribute('aria-hidden', 'true')
  $('gameLayout').setAttribute('inert', '')
  document.querySelector('.topbar')?.setAttribute('inert', '')
  state.phase = 'start'
  state.sessionStart = 0
  state.puzzle = null
  state.pending = null
  state.solved = false
  state.modal = null
  $('modalRoot').hidden = true
  $('modalCard').innerHTML = ''
  document.body.classList.remove('no-scroll')
  hydrateStart()
  renderMiniBoard()
  renderWeekLabels()
  updateCountdownText()
  window.scrollTo(0, 0)
}

function startGame({ fresh = false } = {}) {
  audio.unlock()
  const name = normalizeName($('playerName').value)
  if (name.length < 2) {
    $('playerName').classList.add('invalid')
    $('playerName').focus()
    showToast('En az 2 karakterlik bir oyuncu adı gir.', 'warn')
    audio.error()
    return
  }
  $('playerName').classList.remove('invalid')
  state.profile.name = name
  saveProfile({ id: state.profile.id, name })
  audio.click()
  hideStartScreen()

  if (!fresh && state.savedRun) {
    resumeRun(state.savedRun)
  } else {
    if (fresh) {
      localStorage.removeItem(RUN_KEY)
      state.savedRun = null
    }
    newRun()
  }
}

/* --------------------------------- Game run -------------------------------- */

function ensureLevels() {
  if (state.levelsWeek !== state.week.key) {
    state.levels = generateWeek(weekSeed(state.week.key, CONFIG.weekSalt))
    state.levelsWeek = state.week.key
  }
}

function newRun() {
  ensureLevels()
  state.phase = 'playing'
  state.runWeek = state.week.key
  state.runLeague = state.league
  state.levelIndex = 0
  state.totalScore = 0
  state.totalCrystals = 0
  state.levelResults = []
  state.streak = 0
  state.elapsedBase = 0
  state.sessionStart = performance.now()
  state.finalTime = 0
  state.finalResult = null
  state.submitted = false
  state.submittedRank = null
  state.pending = null
  state.displayScore = 0
  state.lastDisplayScore = -1
  state.modal = null
  document.body.classList.remove('no-scroll')
  $('modalRoot').hidden = true
  $('modalCard').innerHTML = ''
  $('gameLayout').setAttribute('aria-hidden', 'false')
  loadLevel(0)
  showBoardToast('Aynalara dokun · ışını kristallere taşı', '', 3600)
}

function resumeRun(saved) {
  ensureLevels()
  state.phase = 'playing'
  state.runWeek = saved.weekKey
  state.runLeague = saved.weekKey === state.week.key ? state.league : makeLeague(saved.weekKey)
  state.levelIndex = Math.max(0, Math.min(MAX_LEVELS - 1, saved.levelIndex || 0))
  state.totalScore = Number(saved.totalScore) || 0
  state.totalCrystals = Number(saved.totalCrystals) || 0
  state.levelResults = Array.isArray(saved.levelResults) ? saved.levelResults : []
  state.streak = Number(saved.streak) || 0
  state.elapsedBase = Number(saved.elapsedMs) || 0
  state.sessionStart = performance.now()
  state.pending = saved.pending || null
  state.displayScore = state.totalScore
  state.lastDisplayScore = -1
  $('gameLayout').setAttribute('aria-hidden', 'false')
  loadLevel(state.levelIndex, saved.current || null)
  const savedPending = saved.pending && saved.current?.solved ? saved.pending : null
  if (savedPending) {
    state.solved = true
    state.solvedAt = performance.now()
    state.beamProgress = 1
    updateHUD()
    saveRun()
    setTimeout(() => showLevelResult(savedPending, true), 520)
  } else {
    showToast(`Tur devam ediyor · Bölüm ${state.levelIndex + 1}`, '')
  }
}

function loadLevel(index, savedCurrent = null) {
  state.levelIndex = index
  state.puzzle = state.levels[index]
  const puzzle = state.puzzle
  const usableSaved = savedCurrent && Array.isArray(savedCurrent.orientations)
    && savedCurrent.orientations.length === puzzle.mirrors.length
  state.orientations = usableSaved
    ? savedCurrent.orientations.map((value) => value & 1)
    : puzzle.initialOrientations.slice()
  state.turns = usableSaved ? Math.max(0, Number(savedCurrent.turns) || 0) : 0
  state.hintPenalty = usableSaved ? Math.max(0, Number(savedCurrent.hintPenalty) || 0) : 0
  state.hintIndex = usableSaved && Number.isInteger(savedCurrent.hintIndex) ? savedCurrent.hintIndex : -1
  state.angles = state.orientations.map((orientation) => (orientation ? 45 : -45))
  state.angleAnims = []
  state.solved = false
  state.solvedAt = 0
  state.pending = null
  state.budgetWarned = false
  state.particles = []
  state.shake = 0
  state.hovered = null
  state.showCursor = false
  state.cursor = { x: Math.floor(puzzle.w / 2), y: Math.floor(puzzle.h / 2) }
  state.trace = traceBeam(puzzle, state.orientations)
  state.prevLit = state.trace.lit.slice()
  state.beamProgress = 0
  state.beamChangedAt = performance.now()
  state.levelStart = performance.now()
  lastHudSecond = 0
  $('levelEyebrow').textContent = `BÖLÜM ${String(index + 1).padStart(2, '0')}`
  $('levelTitle').textContent = LEVEL_TITLES[index] || `Bölüm ${index + 1}`
  buildDots()
  updateHUD()
  saveRun()
  requestAnimationFrame(() => {
    renderer.resize()
    if (state.phase === 'playing' && window.matchMedia?.('(pointer: fine)').matches) {
      $('board').focus({ preventScroll: true })
    }
  })
}

function runElapsed(now = performance.now()) {
  if (!state.sessionStart) return state.elapsedBase
  return state.elapsedBase + (now - state.sessionStart)
}

function currentTimeText() {
  const ms = state.phase === 'runComplete' ? state.finalTime : runElapsed()
  return formatDuration(ms, true)
}

function updateHUD() {
  if (!state.puzzle) return
  const puzzle = state.puzzle
  const lit = state.trace?.lit.length || 0
  const total = puzzle.crystals.length
  const done = state.solved
  const activeHint = state.hintIndex >= 0

  $('levelNow').textContent = String(state.levelIndex + 1)
  $('turnStat').textContent = `${state.turns} / ${puzzle.budget}`
  $('crystalStat').textContent = `${lit} / ${total}`
  $('parStat').textContent = String(puzzle.par)
  $('streakStat').textContent = `×${state.streak}`
  $('chipTurns').textContent = `Tur ${state.turns}`
  $('chipCrystals').textContent = `${lit}/${total} kristal`
  $('mTurns').textContent = String(state.turns)
  $('mCrystals').textContent = `${lit}/${total}`
  $('statusText').textContent = done
    ? 'Kristaller uyandı · bölüm tamam'
    : lit > 0
      ? `${lit} kristal uyanık · ${total - lit} kaldı`
      : 'Işını kristallere ulaştır'

  const orb = $('statusOrb')
  orb.classList.toggle('done', done)
  orb.classList.toggle('warn', !done && state.turns > puzzle.budget)

  const hintLabel = activeHint ? 'İpucu açık' : 'İpucu <span class="penalty">−150</span>'
  $('hintBtn').innerHTML = hintLabel
  $('hintBtn').disabled = done || activeHint
  $('mHintBtn').disabled = done || activeHint
  $('resetBtn').disabled = done
  $('mResetBtn').disabled = done

  $('board').setAttribute(
    'aria-label',
    `${LEVEL_TITLES[state.levelIndex] || 'Bölüm'}. ${puzzle.mirrors.length} ayna, ${total} kristal. ${lit} kristal uyanık. ${state.turns}. tur.`,
  )
  $('srLive').textContent = `${lit} / ${total} kristal uyanık. ${state.turns}. tur.`

  buildDots()
  updateTimeText()
}

function buildDots() {
  const holder = $('levelDots')
  if (holder.children.length !== MAX_LEVELS) {
    holder.innerHTML = ''
    for (let i = 0; i < MAX_LEVELS; i++) {
      const dot = document.createElement('span')
      dot.className = 'level-dot'
      holder.appendChild(dot)
    }
  }
  Array.from(holder.children).forEach((dot, index) => {
    dot.classList.toggle('done', index < state.levelIndex || (index === state.levelIndex && state.solved))
    dot.classList.toggle('current', index === state.levelIndex && !state.solved)
  })
}

function updateTimeText() {
  const text = currentTimeText()
  $('timeStat').textContent = text
  $('mTime').textContent = text
}

function syncScoreText() {
  const value = Math.round(state.displayScore)
  if (value === state.lastDisplayScore) return
  state.lastDisplayScore = value
  $('scoreValue').textContent = formatScore(value)
  $('mScore').textContent = formatScore(value)
}

/* --------------------------------- Actions --------------------------------- */

function mirrorIndexAt(cell) {
  return state.puzzle.mirrors.findIndex((mirror) => mirror.x === cell.x && mirror.y === cell.y)
}

function rotateMirror(index, fromKeyboard = false) {
  if (state.phase !== 'playing' || state.solved || !state.puzzle) return
  if (index < 0 || index >= state.puzzle.mirrors.length) return
  const before = state.trace?.lit.slice() || []
  const oldOrientation = state.orientations[index]
  state.orientations[index] = oldOrientation ? 0 : 1
  state.turns += 1
  if (state.hintIndex === index) state.hintIndex = -1
  const fromAngle = state.angles[index] ?? (oldOrientation ? 45 : -45)
  state.angles[index] = fromAngle + 90
  state.angleAnims[index] = {
    from: fromAngle,
    to: fromAngle + 90,
    start: performance.now(),
    duration: reduceMotion ? 1 : 190,
  }
  state.trace = traceBeam(state.puzzle, state.orientations)
  state.prevLit = before
  state.beamProgress = 0
  state.beamChangedAt = performance.now()
  if (fromKeyboard) showCursor()

  audio.rotate()
  const newlyLit = state.trace.lit.filter((crystal) => !before.includes(crystal))
  newlyLit.forEach((crystal, indexInList) => {
    spawnCrystalBurst(state.puzzle.crystals[crystal], 14 + indexInList * 3)
    audio.crystal(indexInList)
    if (newlyLit.length > 1) {
      setTimeout(() => audio.crystal(indexInList + 2), indexInList * 90)
    }
  })

  if (state.trace.lit.length > before.length) {
    showBoardToast(`${state.trace.lit.length} / ${state.puzzle.crystals.length} kristal uyanık`, '', 1200)
  }

  if (!state.budgetWarned && state.turns > state.puzzle.budget) {
    state.budgetWarned = true
    showToast('Tur bütçesi aşıldı · verimlilik bonusu kapandı', 'warn')
  }

  updateHUD()
  saveRun()

  if (isSolved(state.puzzle, state.orientations)) solveLevel()
  else if (state.turnTimer) clearTimeout(state.turnTimer)
}

function resetLevel() {
  if (state.phase !== 'playing' || state.solved || !state.puzzle) return
  const puzzle = state.puzzle
  state.streak = 0
  state.turns = 0
  state.orientations = puzzle.initialOrientations.slice()
  state.angles = state.orientations.map((orientation) => (orientation ? 45 : -45))
  state.angleAnims = []
  state.hintIndex = -1
  state.orientations.forEach((_, index) => {
    state.angleAnims[index] = {
      from: state.angles[index] - 90,
      to: state.angles[index],
      start: performance.now(),
      duration: reduceMotion ? 1 : 260,
    }
  })
  state.trace = traceBeam(puzzle, state.orientations)
  state.prevLit = state.trace.lit.slice()
  state.beamProgress = 0
  state.beamChangedAt = performance.now()
  state.particles = []
  state.budgetWarned = false
  state.solved = false
  audio.reset()
  showToast('Bölüm sıfırlandı · seri bozuldu', 'warn')
  updateHUD()
  saveRun()
}

function useHint() {
  if (state.phase !== 'playing' || state.solved || !state.puzzle || state.hintIndex >= 0) return
  const nearest = nearestSolution(state.puzzle, state.orientations)
  if (!nearest) return
  const candidates = []
  for (let i = 0; i < state.orientations.length; i++) {
    const target = (nearest.mask >> i) & 1
    if (state.orientations[i] !== target) candidates.push(i)
  }
  if (!candidates.length) return
  const index = candidates[Math.floor(Math.random() * candidates.length)]
  state.hintIndex = index
  state.hintPenalty += SCORE.hint
  audio.hint()
  showToast('İpucu: parlayan aynayı döndür · −150 puan', 'warn', 3000)
  updateHUD()
  saveRun()
}

function solveLevel() {
  if (state.solved || state.phase !== 'playing' || !state.puzzle) return
  state.solved = true
  state.solvedAt = performance.now()
  state.beamProgress = 1
  const puzzle = state.puzzle
  const crystals = puzzle.crystals.length
  const efficiency = Math.max(0, puzzle.budget - state.turns)
  const perfect = state.turns <= puzzle.par
  const nextStreak = state.streak + 1
  const streakBonus = nextStreak * SCORE.streak
  const breakdown = [
    { label: 'Bölüm temeli', value: SCORE.base },
    { label: `Kristaller (${crystals})`, value: crystals * SCORE.crystal },
    { label: `Verimlilik (${efficiency} tur)`, value: efficiency * SCORE.turn },
  ]
  if (perfect) breakdown.push({ label: 'Kusursuz çözüm', value: SCORE.perfect })
  breakdown.push({ label: `Seri bonusu (×${nextStreak})`, value: streakBonus })
  if (state.hintPenalty > 0) breakdown.push({ label: 'İpucu', value: -state.hintPenalty, negative: true })
  const raw = breakdown.reduce((sum, row) => sum + row.value, 0)
  const score = Math.max(0, Math.round(raw))

  state.streak = nextStreak
  state.totalScore += score
  state.totalCrystals += crystals
  const stars = perfect ? 3 : state.turns <= puzzle.budget ? 2 : 1
  const result = {
    levelIndex: state.levelIndex,
    title: LEVEL_TITLES[state.levelIndex] || `Bölüm ${state.levelIndex + 1}`,
    score,
    stars,
    turns: state.turns,
    par: puzzle.par,
    budget: puzzle.budget,
    crystals,
    timeMs: Math.max(0, performance.now() - state.levelStart),
    streak: nextStreak,
    breakdown,
  }
  state.levelResults.push(result)
  state.pending = result
  state.shake = reduceMotion ? 0 : 9
  spawnWinBurst()
  audio.win()
  showBoardToast('Bölüm tamamlandı', '', 1600)
  $('scoreValue').classList.remove('bump')
  void $('scoreValue').offsetWidth
  $('scoreValue').classList.add('bump')
  updateHUD()
  saveRun()

  setTimeout(() => {
    if (state.phase === 'playing' && state.solved && state.pending === result) {
      showLevelResult(result, false)
    }
  }, reduceMotion ? 420 : 1120)
}

function saveRun() {
  if (state.phase !== 'playing' || !state.puzzle) return
  try {
    const payload = {
      version: 3,
      weekKey: state.runWeek || state.week.key,
      levelIndex: state.levelIndex,
      totalScore: state.totalScore,
      totalCrystals: state.totalCrystals,
      streak: state.streak,
      elapsedMs: Math.round(runElapsed()),
      levelResults: state.levelResults,
      submitted: state.submitted,
      submittedRank: state.submittedRank,
      current: {
        turns: state.turns,
        orientations: state.orientations,
        hintIndex: state.hintIndex,
        hintPenalty: state.hintPenalty,
        solved: state.solved,
      },
      pending: state.pending,
      savedAt: Date.now(),
    }
    localStorage.setItem(RUN_KEY, JSON.stringify(payload))
    state.savedRun = payload
  } catch {
    // A full or unavailable localStorage should never interrupt play.
  }
}

async function advanceLevel() {
  closeModal(true)
  if (state.phase !== 'playing') return
  state.pending = null
  if (state.levelIndex + 1 >= MAX_LEVELS) {
    await finishRun()
    return
  }
  loadLevel(state.levelIndex + 1)
  state.showCursor = false
  audio.click()
}

async function finishRun() {
  if (state.phase !== 'playing') return
  const timeMs = runElapsed()
  state.finalTime = timeMs
  state.elapsedBase = timeMs
  state.sessionStart = 0
  state.phase = 'runComplete'
  state.pending = null
  state.finalResult = {
    score: state.totalScore,
    timeMs,
    rank: null,
    mode: 'local',
    status: 'saving',
    improved: false,
  }
  localStorage.removeItem(RUN_KEY)
  state.savedRun = null
  showToast('Skor kaydediliyor…', '')
  const league = state.runLeague || state.league
  try {
    const result = await league.submit({
      name: state.profile.name || 'Gezgin',
      score: state.totalScore,
      timeMs,
      levels: MAX_LEVELS,
      crystals: state.totalCrystals,
    })
    if (state.runWeek === state.week.key) state.league = league
    state.submitted = true
    state.submittedRank = result.rank
    state.finalResult = {
      score: state.totalScore,
      timeMs,
      rank: result.rank,
      mode: result.mode,
      status: result.status,
      improved: result.improved,
    }
    showRunComplete(state.finalResult)
    renderMiniBoard()
    renderStartTop3()
    burstConfetti(120)
    audio.submit()
  } catch {
    state.finalResult = {
      score: state.totalScore,
      timeMs,
      rank: null,
      mode: 'local',
      status: 'offline',
    }
    showRunComplete(state.finalResult)
    showToast('Skor yerel lige kaydedildi', 'warn')
  }
}

/* ---------------------------------- Modals --------------------------------- */

function openModal(html, { className = '', type = 'generic', dismissible = true, onMount = null } = {}) {
  const root = $('modalRoot')
  root.hidden = false
  const card = $('modalCard')
  card.className = `modal-card ${className}`.trim()
  card.innerHTML = html
  card.setAttribute('aria-label', type === 'league' ? 'Haftalık lig' : 'PRISMA')
  document.body.classList.add('no-scroll')
  state.modal = { type, dismissible }
  requestAnimationFrame(() => {
    const focusTarget = card.querySelector('[data-autofocus]') || card.querySelector('button, input')
    focusTarget?.focus({ preventScroll: true })
  })
  onMount?.(card)
  return card
}

function closeModal(force = false) {
  if ($('modalRoot').hidden) return
  if (!force && state.modal && !state.modal.dismissible) return
  const returnStart = state.leagueReturnStart
  $('modalRoot').hidden = true
  $('modalCard').innerHTML = ''
  document.body.classList.remove('no-scroll')
  state.modal = null
  state.leagueReturnStart = false
  if (returnStart && state.phase === 'runComplete') showStartScreen()
}

function showHelp() {
  audio.click()
  const html = `
    <div class="modal-top">
      <div class="modal-title-wrap">
        <div class="modal-eyebrow">PRISMA · NASIL OYNANIR</div>
        <h2 id="modalTitle">Üç adımda ışığı çöz.</h2>
        <p class="modal-sub">Sıra tabanlı bir bulmaca: her ayna dönüşü bir tur. Amaç tüm kristalleri aynı anda uyandırmak.</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-close-modal aria-label="Kapat">${closeIcon()}</button>
    </div>
    <div class="help-grid">
      <div class="help-card">
        <div class="help-icon">↻</div>
        <h3>Aynayı döndür</h3>
        <p>Aynaya dokun veya imleci taşıyıp <b>Enter</b>'a bas. Her dönüş bir tur sayılır.</p>
      </div>
      <div class="help-card amber">
        <div class="help-icon">⌁</div>
        <h3>Işını taşı</h3>
        <p>Kaynaktan çıkan ışın aynalarda yansır. Kristaller ışığı geçirir, bu yüzden tek ışınla hepsini uyandırabilirsin.</p>
      </div>
      <div class="help-card magenta">
        <div class="help-icon">◈</div>
        <h3>Hepsini uyandır</h3>
        <p>Tüm kristaller aynı anda parlarsa bölüm biter. Altı bölümün toplamı haftalık skorunu belirler.</p>
      </div>
    </div>
    <div class="help-list">
      <div class="help-line"><span class="help-num">01</span><span><b>Az tur, çok puan.</b> Tur bütçesinin altında kaldığın her tur <b>+140</b> verimlilik puanı kazandırır.</span></div>
      <div class="help-line"><span class="help-num">02</span><span><b>Kristaller.</b> Her kristal <b>+120</b>. Bölüm temeli <b>+400</b>.</span></div>
      <div class="help-line"><span class="help-num">03</span><span><b>Kusursuz çözüm.</b> Par turunda bitirirsen <b>+300</b>. Her bölüm serisi <b>+50</b> daha ekler.</span></div>
      <div class="help-line"><span class="help-num">04</span><span><b>İpucu.</b> Bir aynanın doğru yönünü gösterir, <b>−150</b> puan. Sıfırlama seriyi bozar.</span></div>
      <div class="help-line"><span class="help-num">05</span><span><b>Haftalık lig.</b> Her pazartesi 00:00 UTC'de yeni altı bulmaca ve yeni sıralama başlar. Eşit puanda daha hızlı oyuncu öndedir.</span></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" type="button" data-close-modal data-autofocus>Anladım</button>
    </div>`
  openModal(html, { className: 'wide', type: 'help', dismissible: true })
}

function showLevelResult(result, restored = false) {
  if (!result) return
  const stars = [1, 2, 3].map((number) => `<span class="result-star ${number <= result.stars ? 'on' : ''}">★</span>`).join('')
  const rows = result.breakdown.map((row) => `
    <div class="breakdown-row ${row.negative ? 'negative' : ''}">
      <span>${escapeHtml(row.label)}</span>
      <strong>${row.value > 0 ? '+' : ''}${formatScore(row.value)}</strong>
    </div>`).join('')
  const last = result.levelIndex + 1 >= MAX_LEVELS
  const html = `
    <div class="modal-top">
      <div class="modal-title-wrap">
        <div class="modal-eyebrow">BÖLÜM ${String(result.levelIndex + 1).padStart(2, '0')} / ${MAX_LEVELS} TAMAMLANDI</div>
        <h2 id="modalTitle">${escapeHtml(result.title)}</h2>
      </div>
    </div>
    <div class="result-stars" aria-label="${result.stars} yıldız">${stars}</div>
    <div class="result-score">
      <small>BÖLÜM PUANI</small>
      <strong>+${formatScore(result.score)}</strong>
    </div>
    <div class="breakdown">${rows}</div>
    <div class="result-meta">
      <span>Tur <b>${result.turns} / ${result.budget}</b></span>
      <span>Par <b>${result.par}</b></span>
      <span>Kristal <b>${result.crystals}</b></span>
      <span>Seri <b>×${result.streak}</b></span>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" type="button" data-next-level data-autofocus>
        ${last ? 'Turu Bitir' : 'Sonraki Bölüm'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </button>
    </div>`
  openModal(html, { className: 'narrow', type: 'level', dismissible: false })
  if (!restored) audio.click()
}

function showRunComplete(result, { confetti = false } = {}) {
  const rank = result.rank
  const rankText = rank ? `#${rank}` : '—'
  const rankClass = rank && rank <= 3 ? 'run-rank gold' : 'run-rank'
  const perfect = state.levelResults.filter((item) => item.stars === 3).length
  const modeText = result.mode === 'remote'
    ? 'Canlı lig'
    : result.status === 'offline'
      ? 'Çevrimdışı kayıt'
      : 'Yerel lig'
  const html = `
    <div class="run-hero">
      <div class="modal-eyebrow">SEZON 01 · ${state.week.week}. HAFTA</div>
      <h2 id="modalTitle">Işık seninle.</h2>
      <div class="run-score"><strong>${formatScore(result.score)}</strong><span>PUAN</span></div>
      <span class="${rankClass}">${rank ? `Haftalık sıralaman ${rankText}` : 'Sıralama hesaplanıyor'}</span>
      <div class="run-meta">
        <span>Süre <b>${formatDuration(result.timeMs, true)}</b></span>
        <span>Kristal <b>${state.totalCrystals}</b></span>
        <span>Kusursuz <b>${perfect} / ${MAX_LEVELS}</b></span>
        <span>${modeText}</span>
      </div>
    </div>
    <div class="submit-panel">
      <label for="finalName">Ligde görünecek ad</label>
      <div class="submit-row">
        <input id="finalName" maxlength="14" value="${escapeAttr(state.profile.name || 'Gezgin')}" autocomplete="nickname" spellcheck="false" />
        <button class="btn btn-outline" type="button" data-update-name>Adı Güncelle</button>
      </div>
      <div class="submit-note">Skorun otomatik kaydedildi. Aynı hafta içinde en iyi skorun geçerli olur. Eşit puanda daha hızlı tur kazanır.</div>
      <div class="share-box">
        <button class="btn btn-soft" type="button" data-share>Sonucu Paylaş</button>
        <button class="btn btn-soft" type="button" data-open-league>Ligi Gör</button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" type="button" data-replay data-autofocus>Tekrar Oyna</button>
    </div>`
  openModal(html, { className: 'narrow', type: 'run', dismissible: false })
  if (confetti) burstConfetti(110)
}

async function openLeaderboard(tab = 'current') {
  if (!state.league) return
  audio.click()
  const current = tab !== 'previous'
  const weekKey = current ? state.week.key : previousWeekKey()
  const league = current ? state.league : null
  let entries
  let modeLabel
  let modeNote
  if (current) {
    entries = state.league.entries()
    modeLabel = state.league.modeLabel
    modeNote = state.league.modeNote
  } else {
    entries = getLocalEntries(weekKey, state.profile.id, true)
    modeLabel = 'Yerel arşiv'
    modeNote = 'Geçen haftanın bu cihazdaki skorları ve haftalık rakipleri.'
  }
  state.leagueReturnStart = state.phase === 'runComplete'
  const card = openModal(leaderboardHtml({
    entries,
    weekKey,
    tab,
    modeLabel,
    modeNote,
    loading: Boolean(current && state.league.apiBase && state.league.status === 'idle'),
  }), { className: 'wide', type: 'league', dismissible: true })

  if (current && state.league.apiBase && state.league.status !== 'ready') {
    state.league.refresh().then(() => {
      if (state.modal?.type !== 'league') return
      // Keep the currently visible tab after the shared board arrives.
      const activeTab = card.querySelector('[data-lb-tab].active')?.dataset.lbTab || 'current'
      openLeaderboard(activeTab)
      renderMiniBoard()
      renderStartTop3()
    }).catch(() => {})
  }
  renderWeekLabels()
  updateCountdownText()
}

function leaderboardHtml({ entries, weekKey, tab, modeLabel, modeNote, loading }) {
  const top = entries.slice(0, 3)
  const rest = entries.slice(3, 50)
  const selfEntry = entries.find((entry) => entry.self)
  const selfRank = selfEntry ? entries.indexOf(selfEntry) + 1 : null
  const showSelfAfter = selfEntry && !entries.slice(0, 50).includes(selfEntry)
  const week = weekFromKey(weekKey)
  const podium = renderPodium(top)
  const rows = renderLeaderboardRows(rest, 4)
  const selfRow = showSelfAfter ? renderLeaderboardRows([selfEntry], selfRank) : ''
  return `
    <div class="modal-top">
      <div class="modal-title-wrap">
        <div class="modal-eyebrow">HAFTALIK LİG · ${week.label}</div>
        <h2 id="modalTitle">Zirve</h2>
        <p class="modal-sub">Herkes aynı altı bulmacayı oynar. En yüksek toplam skor kazanır; eşit puanda daha hızlı tur öne geçer.</p>
      </div>
      <button class="icon-btn modal-close" type="button" data-close-modal aria-label="Kapat">${closeIcon()}</button>
    </div>
    <div class="lb-head">
      <div class="lb-tabs" role="tablist" aria-label="Lig haftası">
        <button class="lb-tab ${tab === 'current' ? 'active' : ''}" type="button" role="tab" aria-selected="${tab === 'current'}" data-lb-tab="current">Bu hafta</button>
        <button class="lb-tab ${tab === 'previous' ? 'active' : ''}" type="button" role="tab" aria-selected="${tab === 'previous'}" data-lb-tab="previous">Geçen hafta</button>
      </div>
      <div class="lb-countdown">Yeni hafta <b data-countdown>—</b></div>
    </div>
    ${loading ? '<div class="lb-empty"><strong>Lig güncelleniyor…</strong>Canlı sunucudan skorlar alınıyor.</div>' : ''}
    ${entries.length ? `
      <div class="podium">${podium}</div>
      <div class="lb-list">${rows}${selfRow}</div>
    ` : `
      <div class="lb-empty"><strong>Bu hafta henüz skor yok.</strong>İlk ışığı sen yak. Altı bölümü bitir, zirveye yerleş.</div>
    `}
    <div class="lb-foot">
      <span class="mode-pill ${modeLabel === 'Canlı lig' ? 'remote' : ''}">${escapeHtml(modeLabel)}</span>
      <span class="lb-note">${escapeHtml(modeNote)}</span>
    </div>
    ${selfRank ? `<div class="result-meta"><span>Sıralaman <b>#${selfRank}</b></span><span>Skor <b>${formatScore(selfEntry.score)}</b></span><span>Süre <b>${formatDuration(selfEntry.timeMs, true)}</b></span></div>` : ''}
    <div class="modal-actions split">
      <button class="btn btn-soft" type="button" data-lb-refresh>Yenile</button>
      <button class="btn btn-outline" type="button" data-close-modal>Kapat</button>
    </div>`
}

function renderPodium(top) {
  const order = [1, 0, 2].filter((index) => top[index])
  return order.map((index) => {
    const entry = top[index]
    const rank = index + 1
    const cls = rank === 1 ? 'first' : rank === 2 ? 'second' : 'third'
    const color = entry.color || avatarFor(entry.name)
    return `
      <div class="podium-entry ${cls}">
        <div class="podium-medal">#${rank}</div>
        <div class="podium-avatar" style="--a:${color.from};--b:${color.to}">${escapeHtml(color.initials || initialsFor(entry.name))}</div>
        <div class="podium-name">${escapeHtml(entry.name)}${entry.self ? ' <span class="podium-self">SEN</span>' : ''}</div>
        <div class="podium-score">${formatScore(entry.score)}</div>
        <div class="podium-time">${formatDuration(entry.timeMs, true)}</div>
      </div>`
  }).join('')
}

function renderLeaderboardRows(entries, startRank) {
  return entries.map((entry, index) => {
    const color = entry.color || avatarFor(entry.name)
    const rank = startRank + index
    return `
      <div class="lb-row ${entry.self ? 'self' : ''}">
        <span class="lb-rank">${rank}</span>
        <span class="lb-avatar" style="--a:${color.from};--b:${color.to}">${escapeHtml(color.initials || initialsFor(entry.name))}</span>
        <span class="lb-name"><span>${escapeHtml(entry.name)}</span>${entry.self ? '<span class="self-badge">SEN</span>' : ''}</span>
        <span class="lb-score">${formatScore(entry.score)}</span>
        <span class="lb-time">${formatDuration(entry.timeMs, true)}</span>
      </div>`
  }).join('')
}

/* ---------------------------------- Render --------------------------------- */

function renderMiniBoard() {
  const holder = $('miniBoard')
  if (!holder) return
  const league = activeLeague()
  const entries = league.entries().slice(0, 7)
  if (!entries.length) {
    holder.innerHTML = '<div class="lb-empty" style="padding:18px 8px"><strong>Lig boş.</strong>İlk skoru sen gönder.</div>'
  } else {
    holder.innerHTML = entries.map((entry, index) => {
      const color = entry.color || avatarFor(entry.name)
      return `
        <div class="mini-row ${entry.self ? 'self' : ''} top-${index + 1}">
          <span class="mini-rank">${index + 1}</span>
          <span class="mini-avatar" style="--a:${color.from};--b:${color.to}">${escapeHtml(color.initials || initialsFor(entry.name))}</span>
          <span class="mini-name">${escapeHtml(entry.name)}${entry.self ? ' · sen' : ''}</span>
          <span class="mini-score">${formatScore(entry.score)}</span>
        </div>`
    }).join('')
  }

  const rank = league.rank()
  const selfEntry = league.entries().find((entry) => entry.self)
  $('rankValue').textContent = rank ? `#${rank}` : '—'
  $('rankHint').textContent = selfEntry ? `${formatScore(selfEntry.score)} puan · ${formatDuration(selfEntry.timeMs, true)}` : 'Henüz skor yok'
  const pill = $('modePill')
  pill.textContent = league.modeLabel
  pill.classList.toggle('remote', league.mode === 'remote')
}

function renderStartTop3() {
  const holder = $('startTop3')
  if (!holder) return
  const entries = state.league.entries().slice(0, 3)
  if (!entries.length) {
    holder.innerHTML = '<div class="start-top-empty">Bu hafta henüz skor yok. İlk ışığı sen yak.</div>'
    return
  }
  holder.innerHTML = entries.map((entry, index) => {
    const color = entry.color || avatarFor(entry.name)
    return `
      <div class="start-top-row ${entry.self ? 'self' : ''}">
        <span class="mini-rank">${index + 1}</span>
        <span class="mini-avatar" style="--a:${color.from};--b:${color.to}">${escapeHtml(color.initials || initialsFor(entry.name))}</span>
        <span class="mini-name">${escapeHtml(entry.name)}${entry.self ? ' · sen' : ''}</span>
        <span class="mini-score">${formatScore(entry.score)}</span>
      </div>`
  }).join('')
}

function renderWeekLabels() {
  const week = state.week
  $('weekLabel').textContent = `${week.shortLabel} · ${week.year}`
  $('panelWeek').textContent = String(week.week).padStart(2, '0')
  $('startWeekNum').textContent = `${week.week}. HAFTA`
  $('startWeekRange').textContent = week.range
}

/* --------------------------------- Effects --------------------------------- */

function spawnCrystalBurst(cell, count = 18) {
  if (reduceMotion || !cell) return
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.8 + Math.random() * 2.4
    state.particles.push({
      gx: cell.x,
      gy: cell.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.55 + Math.random() * 0.65,
      maxLife: 1.2,
      size: 0.025 + Math.random() * 0.06,
      color: Math.random() > 0.45 ? '255, 95, 220' : '255, 230, 180',
    })
  }
  if (state.particles.length > 240) state.particles.splice(0, state.particles.length - 240)
}

function spawnWinBurst() {
  if (reduceMotion || !state.puzzle) return
  state.puzzle.crystals.forEach((cell, index) => {
    setTimeout(() => spawnCrystalBurst(cell, 26), index * 60)
  })
  spawnCrystalBurst(state.puzzle.emitter, 30)
}

function burstConfetti(count = 100) {
  if (reduceMotion) return
  const colors = ['#58f3ff', '#ff5fdc', '#ffcf70', '#9a7bff', '#6dffb0', '#ffffff']
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0
    state.confetti.push({
      x: fromLeft ? window.innerWidth * 0.12 : window.innerWidth * 0.88,
      y: window.innerHeight * (0.3 + Math.random() * 0.12),
      vx: (fromLeft ? 1 : -1) * (50 + Math.random() * 230),
      vy: -220 - Math.random() * 300,
      size: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 12,
      life: 2.8 + Math.random() * 2.4,
      maxLife: 5.2,
      color: colors[Math.floor(Math.random() * colors.length)],
    })
  }
  state.fxDirty = true
}

function updateParticles(dt) {
  if (!state.particles.length) return
  for (const particle of state.particles) {
    particle.gx += particle.vx * dt
    particle.gy += particle.vy * dt
    particle.vy += 2.6 * dt
    particle.life -= dt
  }
  state.particles = state.particles.filter((particle) => particle.life > 0)
}

function drawConfetti(dt) {
  if (!fxCtx) return
  if (!state.confetti.length) {
    if (state.fxDirty) {
      fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      state.fxDirty = false
    }
    return
  }
  state.fxDirty = true
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  const gravity = 420
  for (const piece of state.confetti) {
    piece.vy += gravity * dt
    piece.x += piece.vx * dt
    piece.y += piece.vy * dt
    piece.rot += piece.vr * dt
    piece.life -= dt
    const alpha = Math.max(0, Math.min(1, piece.life / 0.7))
    fxCtx.save()
    fxCtx.translate(piece.x, piece.y)
    fxCtx.rotate(piece.rot)
    fxCtx.globalAlpha = alpha
    fxCtx.fillStyle = piece.color
    fxCtx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2)
    fxCtx.restore()
  }
  state.confetti = state.confetti.filter((piece) => piece.life > 0 && piece.y < window.innerHeight + 40)
}

/* ---------------------------------- Frame ---------------------------------- */

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - state.lastFrame) / 1000))
  state.lastFrame = now

  if (state.totalScore !== state.displayScore) {
    state.displayScore += (state.totalScore - state.displayScore) * Math.min(1, dt * 9)
    if (Math.abs(state.totalScore - state.displayScore) < 1) state.displayScore = state.totalScore
  }
  syncScoreText()

  if (state.beamChangedAt) {
    state.beamProgress = reduceMotion ? 1 : Math.min(1, (now - state.beamChangedAt) / 420)
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 34)
  updateParticles(dt)

  if (state.puzzle && state.phase !== 'start') {
    renderer.render({
      puzzle: state.puzzle,
      orientations: state.orientations,
      angles: state.angles,
      angleAnims: state.angleAnims,
      trace: state.trace,
      solved: state.solved,
      solvedAt: state.solvedAt,
      beamProgress: state.beamProgress,
      particles: state.particles,
      shake: state.shake,
      hintIndex: state.hintIndex,
      hovered: state.hovered,
      cursor: state.cursor,
      showCursor: state.showCursor,
    }, now)
  }

  drawConfetti(dt)
  requestAnimationFrame(loop)
}

/* ----------------------------------- Tick ---------------------------------- */

function tick() {
  updateCountdownText()
  checkWeekRollover()
  if (state.phase === 'playing') {
    const second = Math.floor(performance.now() / 1000)
    if (second !== lastHudSecond) {
      lastHudSecond = second
      updateTimeText()
    }
  }
}

function updateCountdownText() {
  const text = formatCountdown(state.week.nextReset.getTime() - Date.now())
  $('weekCountdown').textContent = text
  $('startCountdown').textContent = text
  $('leagueCountdown').textContent = text
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    el.textContent = text
  })
}

function checkWeekRollover() {
  const info = getWeekInfo()
  if (info.key === state.week.key) return
  const previous = state.week
  state.week = info
  state.league = makeLeague(info.key)
  state.league.refresh().then(() => {
    renderMiniBoard()
    renderStartTop3()
  }).catch(() => {})
  if (state.phase === 'start') {
    state.savedRun = null
    localStorage.removeItem(RUN_KEY)
    state.levelsWeek = info.key
    state.levels = generateWeek(weekSeed(info.key, CONFIG.weekSalt))
    hydrateStart()
  }
  renderWeekLabels()
  updateCountdownText()
  if (state.phase === 'playing') {
    showToast(`Yeni hafta başladı. Bu tur ${previous.week}. haftanın ligine kaydedilecek.`, 'warn', 5000)
  }
  if (state.phase === 'runComplete') {
    renderStartTop3()
  }
}

/* ---------------------------------- Events --------------------------------- */

function bindEvents() {
  $('startForm').addEventListener('submit', (event) => {
    event.preventDefault()
    startGame()
  })
  $('playerName').addEventListener('input', () => $('playerName').classList.remove('invalid'))
  $('newRunBtn').addEventListener('click', () => startGame({ fresh: true }))
  $('startHelpBtn').addEventListener('click', showHelp)
  $('helpBtn').addEventListener('click', showHelp)
  $('leagueBtn').addEventListener('click', () => openLeaderboard('current'))
  $('soundBtn').addEventListener('click', toggleSound)
  $('hintBtn').addEventListener('click', useHint)
  $('resetBtn').addEventListener('click', resetLevel)
  $('mHintBtn').addEventListener('click', useHint)
  $('mResetBtn').addEventListener('click', resetLevel)

  const board = $('board')
  board.addEventListener('pointerdown', onBoardPointer)
  board.addEventListener('pointermove', onBoardMove)
  board.addEventListener('pointerleave', () => { state.hovered = null })

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('click', onDocumentClick)
  window.addEventListener('resize', () => {
    renderer.resize()
    resizeFx()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveRun()
  })
  window.addEventListener('pagehide', saveRun)
  document.addEventListener('pointerdown', () => audio.unlock(), { once: true })
}

function onBoardPointer(event) {
  if (state.phase !== 'playing' || !state.puzzle) return
  event.preventDefault()
  audio.unlock()
  const cell = renderer.cellAt(event.clientX, event.clientY, state.puzzle)
  if (!cell) return
  state.cursor = cell
  const index = mirrorIndexAt(cell)
  if (index >= 0) {
    rotateMirror(index, false)
    state.showCursor = false
  } else {
    state.showCursor = true
    showCursor()
    showBoardToast('Bu hücrede ayna yok', 'warn', 1100)
  }
}

function onBoardMove(event) {
  if (state.phase !== 'playing' || !state.puzzle) return
  const cell = renderer.cellAt(event.clientX, event.clientY, state.puzzle)
  if (!cell) {
    state.hovered = null
    return
  }
  state.hovered = mirrorIndexAt(cell) >= 0 ? cell : null
}

function onKeyDown(event) {
  if (!$('modalRoot').hidden) {
    if (event.key === 'Escape' && state.modal?.dismissible) {
      event.preventDefault()
      closeModal()
    }
    return
  }
  if (state.phase === 'start') return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
  if (event.target instanceof Element && event.target.closest('button, a, select, [contenteditable="true"]')) return
  if (state.phase !== 'playing') return

  const key = event.key.toLowerCase()
  if (['arrowup', 'w'].includes(key)) { event.preventDefault(); moveCursor(0, -1) }
  else if (['arrowdown', 's'].includes(key)) { event.preventDefault(); moveCursor(0, 1) }
  else if (['arrowleft', 'a'].includes(key)) { event.preventDefault(); moveCursor(-1, 0) }
  else if (['arrowright', 'd'].includes(key)) { event.preventDefault(); moveCursor(1, 0) }
  else if (key === 'enter' || key === ' ') {
    event.preventDefault()
    const index = mirrorIndexAt(state.cursor)
    if (index >= 0) rotateMirror(index, true)
    else showBoardToast('Bu hücrede ayna yok', 'warn', 1100)
  } else if (key === 'r') {
    event.preventDefault()
    resetLevel()
  } else if (key === 'h') {
    event.preventDefault()
    useHint()
  } else if (key === 'l') {
    event.preventDefault()
    openLeaderboard('current')
  } else if (key === '?' || key === '/') {
    event.preventDefault()
    showHelp()
  }
}

function moveCursor(dx, dy) {
  if (!state.puzzle) return
  state.cursor = {
    x: Math.max(0, Math.min(state.puzzle.w - 1, state.cursor.x + dx)),
    y: Math.max(0, Math.min(state.puzzle.h - 1, state.cursor.y + dy)),
  }
  state.showCursor = true
  showCursor()
}

function showCursor() {
  state.showCursor = true
  clearTimeout(state.cursorHideTimer)
  state.cursorHideTimer = setTimeout(() => { state.showCursor = false }, 4200)
}

function onDocumentClick(event) {
  const open = event.target.closest('[data-open-league]')
  if (open) {
    event.preventDefault()
    openLeaderboard('current')
    return
  }
  const close = event.target.closest('[data-close-modal]')
  if (close) {
    event.preventDefault()
    closeModal()
    return
  }
  const tab = event.target.closest('[data-lb-tab]')
  if (tab) {
    event.preventDefault()
    openLeaderboard(tab.dataset.lbTab || 'current')
    return
  }
  const refresh = event.target.closest('[data-lb-refresh]')
  if (refresh) {
    event.preventDefault()
    refreshLeague()
    return
  }
  const next = event.target.closest('[data-next-level]')
  if (next) {
    event.preventDefault()
    advanceLevel()
    return
  }
  const replay = event.target.closest('[data-replay]')
  if (replay) {
    event.preventDefault()
    replayRun()
    return
  }
  const share = event.target.closest('[data-share]')
  if (share) {
    event.preventDefault()
    shareScore()
    return
  }
  const updateName = event.target.closest('[data-update-name]')
  if (updateName) {
    event.preventDefault()
    updateFinalName(updateName)
  }
}

async function refreshLeague() {
  if (!state.league) return
  showToast('Lig güncelleniyor…', '')
  await state.league.refresh()
  renderMiniBoard()
  renderStartTop3()
  if (state.modal?.type === 'league') {
    const tab = $('modalCard').querySelector('[data-lb-tab].active')?.dataset.lbTab || 'current'
    openLeaderboard(tab)
  }
  showToast(state.league.status === 'offline' ? 'Sunucuya ulaşılamadı · yerel lig' : 'Lig güncellendi', state.league.status === 'offline' ? 'warn' : '')
}

function replayRun() {
  audio.click()
  closeModal(true)
  $('gameLayout').setAttribute('aria-hidden', 'false')
  $('startScreen').hidden = true
  state.phase = 'playing'
  newRun()
}

async function updateFinalName(button) {
  if (!state.finalResult) return
  const input = $('finalName')
  const name = normalizeName(input.value)
  if (name.length < 2) {
    input.classList.add('invalid')
    showToast('En az 2 karakterlik bir ad gir.', 'warn')
    audio.error()
    return
  }
  input.classList.remove('invalid')
  state.profile.name = name
  saveProfile({ id: state.profile.id, name })
  button.disabled = true
  const league = state.runLeague || state.league
  const result = await league.submit({
    name,
    score: state.totalScore,
    timeMs: state.finalTime,
    levels: MAX_LEVELS,
    crystals: state.totalCrystals,
  })
  state.finalResult = {
    ...state.finalResult,
    rank: result.rank,
    mode: result.mode,
    status: result.status,
  }
  showRunComplete(state.finalResult)
  renderMiniBoard()
  renderStartTop3()
  audio.submit()
  showToast('Adın ve skorun güncellendi', '')
}

async function shareScore() {
  if (!state.finalResult) return
  const rank = state.finalResult.rank ? ` · #${state.finalResult.rank}` : ''
  const text = `PRISMA ${state.week.week}. hafta · ${formatScore(state.finalResult.score)} puan${rank}\nIşığı bük, kristalleri uyandır: ${window.location.origin}${window.location.pathname}`
  try {
    if (navigator.share) {
      await navigator.share({ title: 'PRISMA — Haftalık Işık Ligi', text })
      return
    }
    await navigator.clipboard.writeText(text)
    showToast('Sonuç panoya kopyalandı', '')
  } catch (error) {
    if (error?.name === 'AbortError') return
    try {
      await navigator.clipboard.writeText(text)
      showToast('Sonuç panoya kopyalandı', '')
    } catch {
      showToast('Paylaşım desteklenmiyor', 'warn')
    }
  }
}

function toggleSound() {
  audio.unlock()
  const muted = audio.toggle()
  document.body.classList.toggle('muted', muted)
  $('soundBtn').setAttribute('aria-label', muted ? 'Sesi aç' : 'Sesi kapat')
  showToast(muted ? 'Ses kapalı' : 'Ses açık', '')
}

/* ---------------------------------- Utils ---------------------------------- */

function showToast(message, type = '', duration = 2600) {
  const toast = $('toast')
  toast.textContent = message
  toast.className = `toast ${type}`.trim()
  toast.classList.add('show')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => toast.classList.remove('show'), duration)
}

function showBoardToast(message, type = '', duration = 1700) {
  const toast = $('boardToast')
  toast.textContent = message
  toast.className = `board-toast ${type}`.trim()
  toast.classList.add('show')
  clearTimeout(state.boardToastTimer)
  state.boardToastTimer = setTimeout(() => toast.classList.remove('show'), duration)
}

function formatScore(value) {
  return numberFormat.format(Math.round(Number(value) || 0))
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, ' ')
}

function closeIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg>'
}

function weekFromKey(key) {
  const match = /^(\d{4})-W(\d{2})$/.exec(key || '')
  return {
    year: match ? Number(match[1]) : state.week.year,
    week: match ? Number(match[2]) : state.week.week,
    label: match ? `${Number(match[2])}. HAFTA · ${match[1]}` : `${state.week.week}. HAFTA · ${state.week.year}`,
  }
}

function resizeFx() {
  if (!fxCtx) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  fx.width = Math.round(window.innerWidth * dpr)
  fx.height = Math.round(window.innerHeight * dpr)
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function exposeDebug() {
  window.PRISMA_DEBUG = {
    state,
    get levels() { return state.levels },
    rotateMirror,
    advanceLevel,
    newRun,
    openLeaderboard,
    solveCurrent() {
      const puzzle = state.puzzle
      if (!puzzle) return
      const solution = puzzle.solutions[0]
      for (let i = 0; i < puzzle.mirrors.length; i++) {
        const target = (solution >> i) & 1
        if (state.orientations[i] !== target) rotateMirror(i)
      }
    },
    completeRun() {
      const puzzle = state.puzzle
      if (!puzzle) return
      const solution = puzzle.solutions[0]
      for (let i = 0; i < puzzle.mirrors.length; i++) {
        const target = (solution >> i) & 1
        if (state.orientations[i] !== target) rotateMirror(i)
      }
    },
  }
}

init()
