import { Game, countBits } from './game.js'
import { BoardRenderer } from './renderer.js'
import { Leaderboard } from './leaderboard.js'
import { AudioEngine } from './audio.js'
import { getWeekInfo, getWeeklyLevels, formatCountdown } from './season.js'
import { CAMPAIGN_LEVELS } from './data/campaign.js'
import {
  loadCampaign,
  saveCampaign,
  loadSettings,
  saveSettings,
  sanitizeName,
} from './storage.js'

const $ = (id) => document.getElementById(id)

const TIPS = [
  'Buz üzerinde tek bir hamle seni birkaç kare kaydırabilir. Duvarları hesaba kat.',
  'Nöbetçiler her turda hareket eder; bekleme de bir tur harcar.',
  'Çatlak taşlar arkanda çöker. Geri dönüş yolunu kapatmamaya çalış.',
  'Alev kapıları iki turda bir yanar. Bir tur bekleyip söndüğünde geçebilirsin.',
  'Anahtar bütün geçitleri açar. Önce anahtarı al, sonra kilidi düşün.',
  'Ardışık kor toplamak zinciri büyütür. Her halka ekstra puan getirir.',
  'Hedef hamle sayısının altında kalırsan verimlilik puanı kazanırsın.',
  'Geri almak puan kaybettirir; ama bir canı kaybetmekten çok daha iyidir.',
  'Haftalık seferde üç canın var. Can biterse sefer biter ve skorun gönderilir.',
  'Skorun her hafta Pazartesi 00:00 UTC’de sıfırlanır. Yeni labirentler seni bekler.',
]

const HELP_HTML = `
  <div class="help-grid">
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">↑</span>
      <div><h4>Tur tabanlı</h4><p>Her yön, kaydırma veya dokunma bir tur harcar. Duvara çarpmak tur harcamaz. Bekleme de bir turdur.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">✦</span>
      <div><h4>Korlar ve ocak</h4><p>Bütün korları topla; ocak ancak ondan sonra açılır. Yanan ocağa ulaşınca bölüm biter.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">≈</span>
      <div><h4>Buz</h4><p>Buzun üstünde durmazsın; ta ki önünde bir engel olana kadar kayarsın.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">◎</span>
      <div><h4>Portal</h4><p>İki portal birbirine bağlıdır. Üzerine bastığında aynı tur içinde diğerine geçersin.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">⌁</span>
      <div><h4>Çatlak zemin</h4><p>Üzerinden geçtiğin çatlak taş çöker. Geri dönüş yolun kapanabilir.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">⌃</span>
      <div><h4>Alev kapısı</h4><p>Kızgın alevler iki turda bir yanar. Yanarken geçemezsin; sönmesini bekle.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">⚿</span>
      <div><h4>Anahtar ve geçit</h4><p>Anahtarı aldığında bütün geçitler açılır. Geçitler anahtar olmadan duvar gibidir.</p></div>
    </div>
    <div class="help-item">
      <span class="help-icon" aria-hidden="true">◉</span>
      <div><h4>Nöbetçi</h4><p>Kırmızı nöbetçiler her turda bir kare ilerler. Bulundukları kareye girersen korun söner.</p></div>
    </div>
  </div>
  <div class="help-score">
    <strong>Puanlama:</strong> 300 taban + kor başına 75 + hedefin altındaki her hamle için 30
    + hedefte bitirme 200 + zincir başına 40 + kusursuz rota 150. Her geri alma 20 puan düşer.
    Haftalık toplamdan her can kaybı 50 puan düşer.
    <br /><br />
    <strong>Haftalık sefer:</strong> Herkes için aynı beş bölüm, üç can. Bölümü geçtiğinde sıradaki açılır;
    canın biterse sefer biter. En yüksek skorun haftalık çevrimiçi sıralamaya gönderilir.
  </div>
`

const els = {
  intro: $('intro'),
  introSeason: $('intro-season'),
  introCountdown: $('intro-countdown'),
  introWeekly: $('intro-weekly'),
  introCampaign: $('intro-campaign'),
  introHelp: $('intro-help'),
  seasonLabel: $('season-label'),
  seasonCountdown: $('season-countdown'),
  netStatus: $('net-status'),
  netLabel: $('net-label'),
  soundBtn: $('sound-btn'),
  helpBtn: $('help-btn'),
  modePill: $('mode-pill'),
  levelIndex: $('level-index'),
  levelName: $('level-name'),
  levelSub: $('level-sub'),
  turnCount: $('turn-count'),
  moveCount: $('move-count'),
  cansStat: $('cans-stat'),
  cansValue: $('cans-value'),
  boardWrap: $('board-wrap'),
  board: $('board'),
  chainBadge: $('chain-badge'),
  chainValue: $('chain-value'),
  boardHint: $('board-hint'),
  objectiveEmber: $('objective-ember'),
  emberCount: $('ember-count'),
  emberTotal: $('ember-total'),
  objectiveExit: $('objective-exit'),
  exitLabel: $('exit-label'),
  undoBtn: $('undo-btn'),
  restartBtn: $('restart-btn'),
  dpad: $('dpad'),
  missionTitle: $('mission-title'),
  scorePreview: $('score-preview'),
  missionEmbers: $('mission-embers'),
  missionEmberCount: $('mission-ember-count'),
  missionExit: $('mission-exit'),
  missionExitState: $('mission-exit-state'),
  missionPar: $('mission-par'),
  missionParValue: $('mission-par-value'),
  chainMeterValue: $('chain-meter-value'),
  chainMeterFill: $('chain-meter-fill'),
  levelDots: $('level-dots'),
  lbWeek: $('lb-week'),
  tabWeekly: $('tab-weekly'),
  tabCampaign: $('tab-campaign'),
  leaderboardList: $('leaderboard-list'),
  lbLegend: document.querySelector('.lb-legend'),
  lbSync: $('lb-sync'),
  lbSyncLabel: $('lb-sync-label'),
  refreshLb: $('refresh-lb'),
  tipText: $('tip-text'),
  nameBtn: $('name-btn'),
  modalRoot: $('modal-root'),
  toastRoot: $('toast-root'),
}

const nf = new Intl.NumberFormat('tr-TR')

let week = getWeekInfo()
let weeklyLevels = getWeeklyLevels(week.id)
let campaign = loadCampaign()
let settings = loadSettings()
let activeTab = 'weekly'
let introVisible = true
let modalOpen = false
let activeModal = null
let previousFocus = null
let lastLeaderboard = null
let lastRunEnd = null
let tipIndex = 0
let announcedOnline = false
let lastToast = { message: '', at: 0 }

const submittedRuns = new Set()

let audio
let renderer
let game
let leaderboard

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function el(tag, className = '', text = null) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== null) node.textContent = text
  return node
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatScore(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return nf.format(Math.max(0, Math.round(number)))
}

function plural(value, singular, pluralForm) {
  return Number(value) === 1 ? singular : pluralForm
}

function updateScrollLock() {
  document.body.classList.toggle('modal-open', modalOpen)
  document.body.classList.toggle('intro-open', introVisible)
}

function showToast(message, kind = 'info') {
  if (!message) return
  const now = Date.now()
  if (lastToast.message === message && now - lastToast.at < 1800) return
  lastToast = { message, at: now }

  const icons = { success: '✓', warn: '!', season: '✦', info: '✦' }
  const toast = el('div', `toast is-${kind}`)
  const icon = el('span', 'toast-icon', icons[kind] || '✦')
  icon.setAttribute('aria-hidden', 'true')
  const text = el('span', '', message)
  toast.append(icon, text)
  els.toastRoot.append(toast)

  while (els.toastRoot.children.length > 3) {
    els.toastRoot.firstElementChild?.remove()
  }

  setTimeout(() => {
    toast.classList.add('is-leaving')
    setTimeout(() => toast.remove(), 280)
  }, 4200)
}

/* ------------------------------------------------------------------ */
/* Intro                                                               */
/* ------------------------------------------------------------------ */

function showIntro({ settle = false } = {}) {
  introVisible = true
  els.intro.classList.remove('is-hidden')
  els.intro.removeAttribute('aria-hidden')
  updateScrollLock()

  if (settle) {
    // Keep the opening CTA inert until the entrance animation and first layout
    // pass finish, so a fast tap cannot land on a still-settling target.
    els.introWeekly.disabled = true
    setTimeout(() => {
      els.introWeekly.disabled = false
      if (introVisible) els.introWeekly.focus({ preventScroll: true })
    }, 900)
  } else {
    requestAnimationFrame(() => {
      if (introVisible) els.introWeekly.focus({ preventScroll: true })
    })
  }
}

function hideIntro() {
  introVisible = false
  els.intro.classList.add('is-hidden')
  els.intro.setAttribute('aria-hidden', 'true')
  updateScrollLock()
}

/* ------------------------------------------------------------------ */
/* Season clock                                                        */
/* ------------------------------------------------------------------ */

function updateSeasonLabels() {
  const now = new Date()
  els.seasonLabel.textContent = week.label
  els.seasonCountdown.textContent = formatCountdown(week.end.getTime() - now.getTime())
  els.introSeason.textContent = `SEZON ${week.week} · ${week.seasonName.toUpperCase()} · HAFTALIK MEYDAN OKUMA`
  els.introCountdown.textContent = `Yeni sezona ${formatCountdown(week.end.getTime() - now.getTime())}`
  els.lbWeek.textContent = activeTab === 'campaign' ? 'YEREL' : week.id
}

function adoptWeek(info) {
  week = info
  weeklyLevels = getWeeklyLevels(week.id)
  updateSeasonLabels()
  renderLeaderboard()
}

function tick() {
  updateSeasonLabels()
  const info = getWeekInfo()
  if (info.id === week.id) return

  adoptWeek(info)
  if (game?.run?.mode === 'weekly' && game.run.weekId !== week.id) {
    if (introVisible) {
      game.startWeekly(weeklyLevels, week.id)
      renderer.setGame(game)
    } else {
      showToast('Yeni hafta başladı. Sefer sıfırlandı.', 'season')
      startWeekly({ quiet: true })
    }
  }
}

/* ------------------------------------------------------------------ */
/* Game session                                                        */
/* ------------------------------------------------------------------ */

function startWeekly({ quiet = false } = {}) {
  const info = getWeekInfo()
  if (info.id !== week.id) {
    week = info
    weeklyLevels = getWeeklyLevels(week.id)
  }
  closeModal({ silent: true })
  hideIntro()
  lastRunEnd = null
  game.startWeekly(weeklyLevels, week.id)
  renderer.setGame(game)
  syncLevelUI()
  updateSeasonLabels()
  if (!quiet) showToast('Haftalık sefer başladı · 5 bölüm, 3 can.', 'success')
}

function startCampaignAt(index) {
  const def = CAMPAIGN_LEVELS[index]
  if (!def) return
  campaign = loadCampaign()
  if (index + 1 > campaign.unlocked) {
    showToast('Bu bölüm henüz kilitli. Önceki bölümü tamamla.', 'warn')
    return
  }
  closeModal({ silent: true })
  hideIntro()
  lastRunEnd = null
  game.startCampaign(def, index, CAMPAIGN_LEVELS.length)
  renderer.setGame(game)
  syncLevelUI()
  updateSeasonLabels()
  showToast(`${pad2(index + 1)} / ${pad2(CAMPAIGN_LEVELS.length)} · ${def.name}`, 'info')
}

function canControl() {
  return !introVisible && !modalOpen && Boolean(game?.playing)
}

function handleDirection(direction) {
  if (!canControl()) return
  if (!settings.muted) audio.ensure()
  game.move(direction)
}

function handleTap(cell) {
  if (!canControl() || !game.level || !game.state) return
  const width = game.level.width
  const pr = Math.floor(game.state.pos / width)
  const pc = game.state.pos % width
  if (cell.r === pr && cell.c === pc) {
    handleDirection('wait')
    return
  }
  const dr = cell.r - pr
  const dc = cell.c - pc
  if (Math.abs(dr) + Math.abs(dc) !== 1) return
  handleDirection(dr === -1 ? 'up' : dr === 1 ? 'down' : dc === 1 ? 'right' : 'left')
}

function handleUndo() {
  if (!canControl()) return
  game.undo()
}

function confirmRestart() {
  if (!game?.run || introVisible) return
  if (game.run.mode === 'campaign') {
    startCampaignAt(game.run.index)
    return
  }
  if (modalOpen) return
  openModal({
    eyebrow: 'SEFER',
    title: 'Bölümü sıfırla?',
    subtitle: 'Bu işlem bir can harcar. Kalan canın sefer boyunca korunur.',
    content: (() => {
      const note = el('div', 'modal-note')
      note.textContent = `Kalan can: ${game.cans} · Can kaybı cezası: her can için 50 puan`
      return note
    })(),
    actions: [
      {
        label: 'Vazgeç',
        className: 'btn btn-soft',
      },
      {
        label: 'Sıfırla',
        className: 'btn btn-danger',
        onClick: () => {
          closeModal({ silent: true })
          const ok = game.restartLevel({ costCan: true })
          if (ok) {
            showToast(`Bölüm sıfırlandı · ${game.cans} can kaldı.`, game.cans <= 1 ? 'warn' : 'info')
          }
        },
      },
    ],
    dismissible: true,
  })
}

function handleRestart() {
  if (!game?.run || introVisible) return
  if (game.run.mode === 'campaign') {
    startCampaignAt(game.run.index)
    return
  }
  confirmRestart()
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function updateHUD(state = game?.state) {
  if (!game?.level || !state) return
  const level = game.level
  const totalEmbers = level.emberCells.length
  const collected = countBits(state.embers)
  const allEmbers = totalEmbers === 0 || state.embers === (1 << totalEmbers) - 1
  const atExit = state.pos === level.exit
  const won = state.status === 'won'
  const isWeekly = game.run?.mode === 'weekly'

  els.turnCount.textContent = String(state.turn)
  els.moveCount.textContent = String(state.moves)
  els.cansValue.textContent = isWeekly ? String(game.cans) : '∞'
  els.cansStat.classList.toggle('is-low', isWeekly && game.cans <= 1)

  els.emberCount.textContent = String(collected)
  els.emberTotal.textContent = String(totalEmbers)
  els.objectiveEmber.classList.toggle('is-done', allEmbers)
  els.objectiveExit.classList.toggle('is-open', allEmbers)
  els.exitLabel.textContent = allEmbers ? 'Ocak açık' : 'Ocak kapalı'

  els.missionEmberCount.textContent = `${collected}/${totalEmbers}`
  els.missionEmbers.classList.toggle('is-done', allEmbers)
  els.missionExitState.textContent = allEmbers ? 'açık' : 'kilitli'
  els.missionExit.classList.toggle('is-done', won || (allEmbers && atExit))
  els.missionParValue.textContent = String(level.par)
  els.missionPar.classList.toggle('is-done', won && state.moves <= level.par)

  const preview = game.scorePreview
  els.scorePreview.textContent = formatScore(preview?.total || 0)

  els.chainValue.textContent = String(state.chain)
  els.chainMeterValue.textContent = String(state.chain)
  els.chainMeterFill.style.width = `${Math.min(100, state.chain * 20)}%`
  els.chainBadge.classList.toggle('is-visible', state.chain > 1 && state.status === 'playing')

  els.undoBtn.disabled = !game.undoStack.length || state.status !== 'playing'
  els.restartBtn.disabled = !game.run
  els.boardHint.classList.toggle('is-hidden', state.moves > 0)
  els.boardWrap.classList.toggle('is-dead', state.status === 'dead')
}

function syncLevelUI() {
  const run = game?.run
  const level = game?.level
  if (!run || !level) return
  const isCampaign = run.mode === 'campaign'

  els.modePill.textContent = isCampaign ? 'KAMPANYA' : 'HAFTALIK'
  els.modePill.classList.toggle('is-campaign', isCampaign)
  els.levelName.textContent = level.name
  const intro = level.intro || 'Korları topla. Ocağı uyandır. Karanlıktan çık.'
  els.levelSub.textContent = level.weeklyLabel ? `${level.weeklyLabel} · ${intro}` : intro
  els.levelIndex.textContent = isCampaign
    ? `${pad2(run.index + 1)} / ${pad2(CAMPAIGN_LEVELS.length)}`
    : `${pad2(run.index + 1)} / ${pad2(run.levels.length)}`
  els.tipText.textContent = intro
  renderLevelDots()
  updateHUD()
}

function renderLevelDots() {
  if (!els.levelDots) return
  els.levelDots.replaceChildren()
  const run = game?.run
  if (!run) return

  if (run.mode === 'campaign') {
    CAMPAIGN_LEVELS.forEach((def, index) => {
      const dot = el('span', 'level-dot')
      if (campaign.completed.includes(def.id)) dot.classList.add('is-done')
      if (index === run.index) dot.classList.add('is-current')
      if (index + 1 > campaign.unlocked) dot.classList.add('is-locked')
      dot.title = `${index + 1}. ${def.name}`
      els.levelDots.append(dot)
    })
    return
  }

  const total = run.levels.length
  for (let index = 0; index < total; index++) {
    const dot = el('span', 'level-dot')
    if (index < run.index) dot.classList.add('is-done')
    if (index === run.index) dot.classList.add('is-current')
    dot.title = `${index + 1}. bölüm`
    els.levelDots.append(dot)
  }
}

/* ------------------------------------------------------------------ */
/* Leaderboard                                                         */
/* ------------------------------------------------------------------ */

function updateSyncLabel() {
  if (!leaderboard) return
  const status = leaderboard.lastStatus
  const online = status === 'online'
  const syncing = status === 'syncing' || status === 'connecting'
  els.lbSync.classList.toggle('is-online', online && activeTab === 'weekly')
  els.lbSync.classList.toggle('is-syncing', syncing && activeTab === 'weekly')

  if (activeTab === 'campaign') {
    els.lbSyncLabel.textContent = 'Cihaz kaydı'
    return
  }
  if (status === 'online') els.lbSyncLabel.textContent = 'Canlı sıralama'
  else if (status === 'syncing') els.lbSyncLabel.textContent = 'Eşitleniyor…'
  else if (status === 'connecting') els.lbSyncLabel.textContent = 'Bağlanıyor…'
  else if (status === 'reconnecting') els.lbSyncLabel.textContent = 'Tekrar deneniyor…'
  else els.lbSyncLabel.textContent = 'Yerel kayıt'
}

function leaderboardRow(entry, rank) {
  const row = el('div', 'lb-row')
  if (rank <= 3) row.classList.add(`rank-${rank}`)
  const isGhost = entry.bot || entry.source === 'ghost'
  if (isGhost) row.classList.add('is-ghost')
  if (entry.id === leaderboard.profile.id) row.classList.add('is-player')

  const rankNode = el('span', 'lb-rank', String(rank))
  const main = el('div', 'lb-main')
  const name = el('span', 'lb-name', entry.name || 'Gezgin')
  const meta = el('span', 'lb-meta')
  if (isGhost) {
    meta.textContent = 'referans rakip'
  } else if (entry.source === 'online') {
    meta.textContent = `${entry.levels || 0}/5 bölüm · ${entry.moves || 0} hamle · çevrimiçi`
  } else {
    meta.textContent = `${entry.levels || 0}/5 bölüm · ${entry.moves || 0} hamle · yerel`
  }
  main.append(name, meta)

  const score = el('span', 'lb-score', formatScore(entry.score))
  row.append(rankNode, main, score)
  row.title = `${entry.name} · ${formatScore(entry.score)} puan`
  return row
}

function renderLeaderboard() {
  if (!leaderboard) return
  els.tabWeekly.classList.toggle('is-active', activeTab === 'weekly')
  els.tabCampaign.classList.toggle('is-active', activeTab === 'campaign')
  els.tabWeekly.setAttribute('aria-selected', String(activeTab === 'weekly'))
  els.tabCampaign.setAttribute('aria-selected', String(activeTab === 'campaign'))
  els.lbWeek.textContent = activeTab === 'campaign' ? 'YEREL' : leaderboard.week.id
  els.leaderboardList.replaceChildren()

  if (activeTab === 'campaign') {
    campaign = loadCampaign()
    CAMPAIGN_LEVELS.forEach((def, index) => {
      const locked = index + 1 > campaign.unlocked
      const best = campaign.best[def.id]
      const completed = campaign.completed.includes(def.id)
      const row = el('div', 'lb-row')
      if (locked) row.classList.add('is-locked')
      if (game?.run?.mode === 'campaign' && game.run.index === index) row.classList.add('is-player')
      if (index < 3) row.classList.add(`rank-${index + 1}`)

      const rank = el('span', 'lb-rank', String(index + 1))
      const main = el('div', 'lb-main')
      const name = el('span', 'lb-name', def.name)
      const meta = el('span', 'lb-meta')
      if (locked) meta.textContent = 'kilitli'
      else if (best) meta.textContent = `${completed ? 'tamamlandı' : 'oynanıyor'} · ${best.moves} hamle`
      else meta.textContent = 'henüz oynanmadı'
      main.append(name, meta)
      const score = el('span', 'lb-score', best ? formatScore(best.score) : '—')
      row.append(rank, main, score)
      els.leaderboardList.append(row)
    })

    els.lbLegend.innerHTML = 'Kampanya ilerlemesi ve en iyi puanlar bu cihazda saklanır.'
    updateSyncLabel()
    return
  }

  const entries = leaderboard.entries
  const player = leaderboard.playerEntry
  const playerRank = leaderboard.playerRank
  const top = entries.slice(0, 12)
  top.forEach((entry, index) => {
    els.leaderboardList.append(leaderboardRow(entry, index + 1))
  })

  if (player && playerRank && playerRank > top.length) {
    els.leaderboardList.append(leaderboardRow(player, playerRank))
  }

  if (!player) {
    const empty = el('div', 'lb-empty')
    empty.textContent = 'Henüz haftalık skorun yok. Seferi tamamlayınca burada görünecek.'
    els.leaderboardList.append(empty)
  }

  els.lbLegend.innerHTML =
    '<span class="legend-ghost" aria-hidden="true">◇</span> Hayalet skorlar sezonun referans rakipleridir.'
  updateSyncLabel()
}

function handleEntries(payload) {
  lastLeaderboard = payload
  if (payload?.week?.id && payload.week.id !== week.id) {
    adoptWeek(payload.week)
    if (game?.run?.mode === 'weekly' && game.run.weekId !== week.id) {
      if (introVisible) {
        game.startWeekly(weeklyLevels, week.id)
        renderer.setGame(game)
      } else {
        showToast('Yeni hafta başladı. Sefer sıfırlandı.', 'season')
        startWeekly({ quiet: true })
      }
    }
  }
  renderLeaderboard()
}

function handleStatus(status, detail = {}) {
  const online = status === 'online'
  const connecting = status === 'connecting' || status === 'syncing' || status === 'reconnecting'
  els.netStatus.classList.toggle('is-online', online || status === 'syncing')
  els.netStatus.classList.toggle('is-connecting', connecting && status !== 'syncing')
  els.netStatus.classList.toggle('is-offline', !online && !connecting)

  const labels = {
    online: 'Çevrimiçi',
    syncing: 'Eşitleniyor',
    connecting: 'Bağlanıyor',
    reconnecting: 'Tekrar deniyor',
    offline: 'Yerel',
  }
  els.netLabel.textContent = labels[status] || 'Yerel'
  els.netStatus.title = detail.broker
    ? `Haftalık sıralama bağlantısı · ${detail.broker}`
    : 'Haftalık sıralama bağlantısı'

  if (online) announcedOnline = true
  updateSyncLabel()
}

/* ------------------------------------------------------------------ */
/* Modal infrastructure                                                */
/* ------------------------------------------------------------------ */

function openModal({
  eyebrow = '',
  title = '',
  subtitle = '',
  content = null,
  actions = [],
  dismissible = true,
  wide = false,
  className = '',
  onClose = null,
}) {
  closeModal({ silent: true })
  modalOpen = true
  previousFocus = document.activeElement
  updateScrollLock()

  const backdrop = el('div', 'modal-backdrop')
  const dialog = el('div', `modal${wide ? ' is-wide' : ''}${className ? ` ${className}` : ''}`)
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  if (title) dialog.setAttribute('aria-label', title)

  const head = el('div', 'modal-head')
  if (eyebrow) head.append(el('span', 'eyebrow', eyebrow))
  if (title) head.append(el('h2', '', title))
  if (subtitle) head.append(el('p', 'modal-sub', subtitle))

  if (dismissible) {
    const close = el('button', 'modal-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Kapat')
    close.addEventListener('click', () => closeModal())
    head.append(close)
  }
  dialog.append(head)

  if (content) {
    const body = el('div', 'modal-content')
    if (typeof content === 'string') body.innerHTML = content
    else body.append(content)
    dialog.append(body)
  }

  if (actions.length) {
    const actionRow = el('div', 'modal-actions')
    for (const action of actions) {
      const button = el('button', action.className || 'btn btn-soft', action.label)
      button.type = 'button'
      if (action.disabled) button.disabled = true
      button.addEventListener('click', () => {
        audio.play('click')
        const before = activeModal
        const result = action.onClick?.({ close: () => closeModal() })
        if (action.close !== false && result !== false && activeModal === before) {
          closeModal()
        }
      })
      actionRow.append(button)
    }
    dialog.append(actionRow)
  }

  backdrop.append(dialog)
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop && dismissible) closeModal()
  })
  backdrop.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const focusables = [...dialog.querySelectorAll('button, input, [href], select, textarea')].filter(
      (node) => !node.disabled && node.offsetParent !== null,
    )
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })

  els.modalRoot.append(backdrop)
  activeModal = { backdrop, dialog, onClose, dismissible }
  requestAnimationFrame(() => backdrop.classList.add('is-open'))

  setTimeout(() => {
    const target = dialog.querySelector('[autofocus]') || dialog.querySelector('.modal-actions .btn') || dialog.querySelector('input')
    target?.focus({ preventScroll: true })
  }, 40)
}

function closeModal({ silent = false } = {}) {
  const modal = activeModal
  if (!modal) return
  activeModal = null
  modalOpen = false
  modal.backdrop.remove()
  updateScrollLock()
  if (!silent) modal.onClose?.()
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus({ preventScroll: true })
  }
  previousFocus = null
}

/* ------------------------------------------------------------------ */
/* Modals: help / name / campaign                                      */
/* ------------------------------------------------------------------ */

function showHelpModal() {
  openModal({
    eyebrow: 'NASIL OYNANIR',
    title: 'Karanlıkta yolunu bul.',
    subtitle: 'Sıra tabanlı bir bulmaca: her hamle bir tur, her tur yeni bir tehlike.',
    content: HELP_HTML,
    actions: [{ label: 'Anladım', className: 'btn btn-primary' }],
    dismissible: true,
    wide: true,
  })
}

function showNameModal({ onDone = null } = {}) {
  const form = el('div', 'name-form')
  const label = el('label', '', 'Sıralamada görünecek ad')
  label.setAttribute('for', 'name-input')
  const input = document.createElement('input')
  input.id = 'name-input'
  input.type = 'text'
  input.maxLength = 14
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = leaderboard.profile.name
  input.setAttribute('autofocus', '')
  const hint = el('span', 'form-hint', '2–14 karakter. Türkçe harfler ve boşluk kullanabilirsin.')
  const error = el('div', 'form-error')
  form.append(label, input, hint, error)

  const save = () => {
    const clean = sanitizeName(input.value, '')
    if (!clean || clean.length < 2) {
      error.textContent = 'En az 2 karakterlik bir ad gir.'
      input.focus()
      return false
    }
    leaderboard.setName(clean)
    renderLeaderboard()
    showToast(`Adın "${clean}" olarak güncellendi.`, 'success')
    closeModal()
    return true
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    }
  })

  openModal({
    eyebrow: 'KİMLİK',
    title: 'Adını yaz.',
    subtitle: 'Haftalık sıralamada diğer oyuncular bu adı görür.',
    content: form,
    actions: [
      {
        label: 'Kaydet',
        className: 'btn btn-primary',
        onClick: save,
        close: false,
      },
      { label: 'Vazgeç', className: 'btn btn-soft' },
    ],
    dismissible: true,
    onClose: () => onDone?.(),
  })
}

function showCampaignModal({ fromIntro = false, onClose = null } = {}) {
  campaign = loadCampaign()
  const content = el('div')
  const progress = el('div', 'campaign-progress')
  const count = el('strong', '', `${campaign.completed.length}/${CAMPAIGN_LEVELS.length}`)
  progress.append(count, el('span', '', 'tamamlandı'))
  const track = el('div', 'progress-track')
  const fill = el('span')
  fill.style.width = `${Math.round((campaign.completed.length / CAMPAIGN_LEVELS.length) * 100)}%`
  track.append(fill)
  progress.append(track)
  content.append(progress)

  const grid = el('div', 'level-grid')
  CAMPAIGN_LEVELS.forEach((def, index) => {
    const locked = index + 1 > campaign.unlocked
    const best = campaign.best[def.id]
    const completed = campaign.completed.includes(def.id)
    const button = el('button', 'level-card')
    button.type = 'button'
    button.disabled = locked
    if (completed) button.classList.add('is-complete')
    if (locked) button.classList.add('is-locked')
    if (game?.run?.mode === 'campaign' && game.run.index === index) button.classList.add('is-current')
    button.append(el('span', 'level-card-number', `BÖLÜM ${pad2(index + 1)}`))
    button.append(el('span', 'level-card-name', def.name))
    button.append(
      el('span', 'level-card-score', locked ? 'kilitli' : best ? `${formatScore(best.score)} p` : 'oynanmadı'),
    )
    button.title = locked ? 'Önceki bölümü tamamla' : `${def.name} · hedef ${def.par} hamle`
    button.addEventListener('click', () => startCampaignAt(index))
    grid.append(button)
  })
  content.append(grid)

  const note = el('div', 'modal-note')
  note.textContent = 'Kampanya kaydı bu cihazda tutulur. Haftalık skorlar ise çevrimiçi sıralamaya gönderilir.'
  content.append(note)

  openModal({
    eyebrow: 'KAMPANYA',
    title: 'On iki kor, on iki sır.',
    subtitle: 'Bölümleri sırayla aç. Her bölüm yeni bir mekaniği tanıtır.',
    content,
    actions: [
      {
        label: 'Haftalık Meydan Okuma',
        className: 'btn btn-primary',
        onClick: () => startWeekly(),
      },
      { label: 'Kapat', className: 'btn btn-soft' },
    ],
    dismissible: true,
    wide: true,
    onClose: () => {
      if (fromIntro) showIntro()
      onClose?.()
    },
  })
}

/* ------------------------------------------------------------------ */
/* Modals: results                                                     */
/* ------------------------------------------------------------------ */

function breakdownRow(label, value, { penalty = false, total = false } = {}) {
  const row = el('div', `breakdown-row${penalty ? ' is-penalty' : ''}${total ? ' is-total' : ''}`)
  row.append(el('span', '', label))
  const sign = penalty ? '−' : total ? '' : '+'
  row.append(el('span', '', `${sign}${formatScore(value)}`))
  return row
}

function resultHero(score, smallLabel, rightLines) {
  const hero = el('div', 'result-hero')
  const scoreNode = el('div', 'result-score', formatScore(score))
  scoreNode.append(el('small', '', smallLabel))
  const right = el('div', 'result-rank')
  for (const line of rightLines) {
    if (typeof line === 'string') right.append(el('span', '', line))
    else right.append(line)
  }
  hero.append(scoreNode, right)
  return hero
}

function showDeathModal(event) {
  const isWeekly = event.run?.mode === 'weekly'
  const cans = isWeekly ? event.cans : null
  const content = el('div')

  const hero = el('div', 'result-hero')
  const scoreNode = el('div', 'result-score', isWeekly ? String(cans) : '∞')
  scoreNode.append(el('small', '', isWeekly ? 'can kaldı' : 'can sınırı yok'))
  const right = el('div', 'result-rank')
  right.append(el('span', '', isWeekly ? 'Yeniden denemek can harcamaz.' : 'Bölümü baştan deneyebilirsin.'))
  right.append(el('span', '', `${event.level?.name || 'Bölüm'} · ${event.state?.moves || 0} hamle`))
  hero.append(scoreNode, right)
  content.append(hero)

  const note = el('div', 'modal-note')
  note.textContent =
    event.reason === 'sentry'
      ? 'Bir nöbetçi korunu gördü. Rotanı ve bekleme zamanlamanı yeniden düşün.'
      : 'Karanlık seni buldu. Bu bölümdeki ilerleme sıfırlanacak.'
  content.append(note)

  const actions = [
    {
      label: 'Tekrar Dene',
      className: 'btn btn-primary',
      onClick: () => {
        closeModal({ silent: true })
        if (isWeekly) game.retryLevel()
        else startCampaignAt(game.run.index)
      },
    },
  ]

  if (isWeekly) {
    actions.push({
      label: 'Seferi Bitir',
      className: 'btn btn-danger',
      onClick: () => {
        closeModal({ silent: true })
        game.finishRun('retired')
      },
    })
  } else {
    actions.push({
      label: 'Kampanya',
      className: 'btn btn-soft',
      onClick: () => showCampaignModal(),
    })
  }

  openModal({
    eyebrow: isWeekly ? 'CAN KAYBI' : 'BÖLÜM BİTTİ',
    title: 'Kor söndü.',
    subtitle: isWeekly
      ? `Haftalık seferde ${cans} canın kaldı. Dikkatli ol.`
      : 'Kampanyada can sınırı yok; istediğin kadar deneyebilirsin.',
    content,
    actions,
    dismissible: true,
  })
}

function updateCampaignProgress(event) {
  const index = game.run.index
  const def = game.level
  campaign = loadCampaign()
  const completed = new Set(campaign.completed)
  completed.add(def.id)
  campaign.completed = [...completed]
  campaign.unlocked = Math.max(
    campaign.unlocked,
    Math.min(CAMPAIGN_LEVELS.length, index + 2),
  )
  const previous = campaign.best[def.id]
  if (!previous || event.breakdown.total > previous.score) {
    campaign.best[def.id] = {
      score: event.breakdown.total,
      moves: event.state.moves,
      at: Date.now(),
    }
  }
  saveCampaign(campaign)
  renderLevelDots()
  renderLeaderboard()
}

function showWinModal(event) {
  const isWeekly = event.run?.mode === 'weekly'
  const isLast = isWeekly ? event.isLast : game.run.index >= CAMPAIGN_LEVELS.length - 1
  const level = event.level
  const breakdown = event.breakdown

  if (!isWeekly) updateCampaignProgress(event)

  const content = el('div')
  const right = []
  right.push(`${event.state.moves} hamle · hedef ${level.par}`)
  if (breakdown.perfect) right.push('Kusursuz rota')
  else if (event.state.moves <= level.par) right.push('Hedefin altında')
  content.append(resultHero(breakdown.total, 'bölüm puanı', right))

  const rows = el('div', 'breakdown')
  rows.append(breakdownRow('Taban', breakdown.base))
  rows.append(breakdownRow(`Korlar (${breakdown.embers})`, breakdown.emberPts))
  rows.append(breakdownRow('Verimlilik', breakdown.efficiency))
  rows.append(breakdownRow('Hedefte bitirme', breakdown.onPar))
  rows.append(breakdownRow('Zincir', breakdown.chain))
  if (breakdown.perfect) rows.append(breakdownRow('Kusursuz rota', breakdown.perfect))
  if (breakdown.penalty) rows.append(breakdownRow('Geri alma', breakdown.penalty, { penalty: true }))
  rows.append(breakdownRow('Bölüm toplamı', breakdown.total, { total: true }))
  content.append(rows)

  const actions = []
  if (isWeekly) {
    const note = el('div', 'modal-note')
    note.textContent = isLast
      ? 'Bu, seferin son bölümü. Skorunu göndermek için seferi bitir.'
      : `Sıradaki bölüm: ${game.run.levels[game.run.index + 1]?.name || '—'}`
    content.append(note)
    actions.push({
      label: isLast ? 'Seferi Bitir' : 'Sonraki Bölüm',
      className: 'btn btn-primary',
      onClick: () => {
        closeModal({ silent: true })
        game.nextLevel()
      },
    })
  } else {
    const nextIndex = game.run.index + 1
    const hasNext = nextIndex < CAMPAIGN_LEVELS.length
    const note = el('div', 'modal-note')
    if (hasNext && campaign.unlocked > nextIndex) {
      note.textContent = `Yeni bölüm açıldı: ${CAMPAIGN_LEVELS[nextIndex].name}`
    } else if (!hasNext) {
      note.textContent = 'Bütün bölümleri tamamladın. Kampanya senin.'
    } else {
      note.textContent = 'Kampanya ilerlemen kaydedildi.'
    }
    content.append(note)

    if (hasNext) {
      actions.push({
        label: 'Sonraki Bölüm',
        className: 'btn btn-primary',
        onClick: () => {
          closeModal({ silent: true })
          startCampaignAt(nextIndex)
        },
      })
    }
    actions.push({
      label: 'Tekrar Oyna',
      className: 'btn btn-soft',
      onClick: () => {
        closeModal({ silent: true })
        startCampaignAt(game.run.index)
      },
    })
    actions.push({
      label: 'Kampanya',
      className: 'btn btn-ghost',
      onClick: () => showCampaignModal({ onClose: () => showWinModal(event) }),
    })
  }

  openModal({
    eyebrow: isWeekly ? 'BÖLÜM TAMAMLANDI' : 'KAMPANYA',
    title: isLast
      ? isWeekly
        ? 'Son ocak yandı.'
        : 'Kampanya tamamlandı.'
      : 'Ocak uyandı.',
    subtitle: isWeekly
      ? `${game.run.index + 1}. bölüm tamamlandı. Zincirini koru.`
      : `${level.name} tamamlandı. Yeni bir mekanik seni bekliyor.`,
    content,
    actions,
    dismissible: false,
    wide: false,
  })
}

function handleRunEnd(event) {
  lastRunEnd = event
  closeModal({ silent: true })
  updateHUD(game.state)
  const run = event.run
  const runKey = `${run.weekId}:${run.startedAt}`
  let submitted = false

  if (!submittedRuns.has(runKey)) {
    submittedRuns.add(runKey)
    if (event.total > 0 && run.weekId === leaderboard.week.id) {
      leaderboard.submit({
        score: event.total,
        levels: event.scores.length,
        moves: event.scores.reduce((sum, entry) => sum + (entry.moves || 0), 0),
      })
      submitted = true
    } else if (event.total > 0) {
      showToast('Hafta değişti; bu seferin skoru yeni haftaya taşınmadı.', 'warn')
    }
  } else {
    submitted = true
  }

  showFinalModal(event, submitted)
}

function showFinalModal(event, submitted = true) {
  const run = event.run
  const scores = event.scores || []
  const complete = event.reason === 'complete'
  const rank = leaderboard.playerRank
  const content = el('div')

  const right = []
  right.push(`${scores.length}/${run.levels.length} bölüm · ${run.deaths} can kaybı`)
  if (rank) {
    const rankNode = el('strong', '', `#${rank}`)
    const rankLine = el('span')
    rankLine.append(rankNode, document.createTextNode(' haftalık sıralama'))
    right.push(rankLine)
  } else if (event.total > 0) {
    right.push('Skor gönderilemedi')
  } else {
    right.push('Skor oluşmadı')
  }
  content.append(resultHero(event.total, 'haftalık toplam', right))

  const levelResults = el('div', 'level-results')
  scores.forEach((entry, index) => {
    const row = el('div', 'level-result')
    row.append(el('span', 'level-result-index', pad2(index + 1)))
    row.append(el('span', 'level-result-name', entry.name))
    row.append(el('span', 'level-result-score', formatScore(entry.score)))
    levelResults.append(row)
  })
  if (!complete && run.levels[scores.length]) {
    const pending = el('div', 'level-result is-pending')
    pending.append(el('span', 'level-result-index', pad2(scores.length + 1)))
    pending.append(el('span', 'level-result-name', run.levels[scores.length].name))
    pending.append(el('span', 'level-result-score', 'tamamlanmadı'))
    levelResults.append(pending)
  }
  content.append(levelResults)

  const breakdown = el('div', 'breakdown')
  breakdown.append(breakdownRow('Bölüm puanları', scores.reduce((sum, entry) => sum + entry.score, 0)))
  if (event.penalty) {
    breakdown.append(breakdownRow(`Can kaybı cezası (${run.deaths})`, event.penalty, { penalty: true }))
  }
  breakdown.append(breakdownRow('Haftalık toplam', event.total, { total: true }))
  content.append(breakdown)

  const nameLine = el('div', 'modal-note')
  nameLine.append(document.createTextNode('Sıralamada görünen ad: '))
  nameLine.append(el('strong', '', leaderboard.profile.name))
  const edit = el('button', 'link-btn', 'Değiştir')
  edit.type = 'button'
  edit.style.marginLeft = '6px'
  edit.addEventListener('click', () => {
    showNameModal({ onDone: () => showFinalModal(event, submitted) })
  })
  nameLine.append(edit)
  content.append(nameLine)

  if (submitted && event.total > 0) {
    const syncNote = el('div', 'modal-note')
    syncNote.textContent =
      leaderboard.connected
        ? 'Skorun haftalık çevrimiçi sıralamaya gönderildi.'
        : 'Skorun cihazına kaydedildi; bağlantı gelince gönderilecek.'
    content.append(syncNote)
  }

  openModal({
    eyebrow: complete ? 'SEFER TAMAMLANDI' : 'SEFER BİTTİ',
    title: complete ? 'Beş ocak, tek bir kor.' : 'Korlar tükendi.',
    subtitle: complete
      ? 'Haftalık seferi tamamladın. Skorun sıralamaya işlendi.'
      : event.total > 0
        ? 'Canların bitti. Topladığın puanlar sıralamaya gönderildi.'
        : 'Canların bitti. Bu seferde puan toplayamadın.',
    content,
    actions: [
      {
        label: 'Yeni Sefer',
        className: 'btn btn-primary',
        onClick: () => startWeekly(),
      },
      {
        label: 'Kampanya',
        className: 'btn btn-soft',
        onClick: () => showCampaignModal({ onClose: () => showFinalModal(event, submitted) }),
      },
    ],
    dismissible: false,
  })
}

/* ------------------------------------------------------------------ */
/* Game events                                                         */
/* ------------------------------------------------------------------ */

function handleGameEvent(event) {
  switch (event.type) {
    case 'levelstart': {
      renderer.setLevel(event.level, event.state)
      els.boardWrap.classList.remove('is-dead')
      syncLevelUI()
      updateHUD(event.state)
      break
    }
    case 'move': {
      renderer.animateMove(event)
      renderer.updateState(event.state)
      audio.play(event.teleported ? 'portal' : 'move')
      updateHUD(event.state)
      break
    }
    case 'bump': {
      audio.play('bump')
      renderer.shake(2.5, 110)
      break
    }
    case 'ember': {
      renderer.burstAt(event.index, '#ffb35c', 14, 1)
      audio.play('ember', { chain: event.chain })
      break
    }
    case 'key': {
      renderer.burstAt(event.index, '#ffd58a', 16, 1.1)
      audio.play('key')
      break
    }
    case 'chain': {
      els.chainValue.textContent = String(event.chain)
      els.chainBadge.classList.add('is-visible')
      break
    }
    case 'death': {
      renderer.flashScreen('rgba(255,60,80,0.22)')
      renderer.shake(9, 380)
      audio.play('death')
      updateHUD(event.state)
      if (!(event.run?.mode === 'weekly' && event.cans <= 0)) {
        showDeathModal(event)
      }
      break
    }
    case 'win': {
      renderer.win()
      audio.play('win')
      updateHUD(event.state)
      showWinModal(event)
      break
    }
    case 'undo': {
      renderer.updateState(event.state)
      audio.play('undo')
      updateHUD(event.state)
      break
    }
    case 'state': {
      renderer.updateState(event.state)
      updateHUD(event.state)
      break
    }
    case 'runend': {
      handleRunEnd(event)
      break
    }
    default:
      break
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function setMutedUI(muted) {
  els.soundBtn.classList.toggle('is-muted', muted)
  els.soundBtn.setAttribute('aria-label', muted ? 'Sesi aç' : 'Sesi kapat')
  els.soundBtn.title = muted ? 'Sesi aç' : 'Sesi kapat'
}

function toggleSound() {
  settings = { ...settings, muted: !settings.muted }
  saveSettings(settings)
  audio.ensure()
  audio.setMuted(settings.muted)
  setMutedUI(settings.muted)
  showToast(settings.muted ? 'Ses kapalı.' : 'Ses açık.', 'info')
}

function setTab(tab) {
  activeTab = tab
  renderLeaderboard()
}

function bindUI() {
  els.introWeekly.addEventListener('click', () => {
    audio.ensure()
    startWeekly({ quiet: true })
  })
  els.introCampaign.addEventListener('click', () => {
    audio.ensure()
    hideIntro()
    showCampaignModal({ fromIntro: true })
  })
  els.introHelp.addEventListener('click', () => showHelpModal())
  els.helpBtn.addEventListener('click', () => showHelpModal())
  els.soundBtn.addEventListener('click', toggleSound)
  els.nameBtn.addEventListener('click', () => showNameModal())

  els.undoBtn.addEventListener('click', handleUndo)
  els.restartBtn.addEventListener('click', handleRestart)

  els.dpad.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]')
    if (!button) return
    audio.play('select')
    handleDirection(button.dataset.action)
  })

  els.tabWeekly.addEventListener('click', () => setTab('weekly'))
  els.tabCampaign.addEventListener('click', () => setTab('campaign'))
  els.refreshLb.addEventListener('click', () => {
    if (activeTab === 'campaign') {
      campaign = loadCampaign()
      renderLeaderboard()
      showToast('Kampanya kayıtları güncellendi.', 'info')
      return
    }
    leaderboard.refresh()
    showToast('Haftalık sıralama yenileniyor…', 'info')
  })

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (modalOpen && activeModal?.dismissible) {
        event.preventDefault()
        closeModal()
      }
      return
    }

    if (modalOpen) return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return

    if (introVisible) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        audio.ensure()
        startWeekly()
      }
      return
    }

    if (event.repeat) return
    const key = event.key.toLowerCase()
    const directions = {
      arrowup: 'up',
      w: 'up',
      arrowdown: 'down',
      s: 'down',
      arrowleft: 'left',
      a: 'left',
      arrowright: 'right',
      d: 'right',
    }

    if (directions[key]) {
      event.preventDefault()
      handleDirection(directions[key])
      return
    }
    if (key === ' ' || key === '.') {
      event.preventDefault()
      handleDirection('wait')
      return
    }
    if (key === 'z') {
      event.preventDefault()
      handleUndo()
      return
    }
    if (key === 'r') {
      event.preventDefault()
      handleRestart()
      return
    }
    if (key === 'm') {
      event.preventDefault()
      toggleSound()
    }
  })

  window.addEventListener('pointerdown', () => {
    if (!settings.muted) audio.ensure()
  })

  window.addEventListener('resize', () => {
    if (modalOpen) {
      // The dialog is height constrained; keeping the scroll lock is enough.
    }
  })
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function init() {
  setMutedUI(settings.muted)
  audio = new AudioEngine({ muted: settings.muted })
  renderer = new BoardRenderer(els.board, {
    onSwipe: handleDirection,
    onTap: handleTap,
  })
  game = new Game({ onEvent: handleGameEvent })
  leaderboard = new Leaderboard({
    onEntries: handleEntries,
    onStatus: handleStatus,
    onToast: showToast,
  })

  bindUI()

  const info = getWeekInfo()
  week = info
  weeklyLevels = getWeeklyLevels(week.id)
  game.startWeekly(weeklyLevels, week.id)
  renderer.setGame(game)
  updateSeasonLabels()
  syncLevelUI()
  updateHUD()
  renderLeaderboard()
  showIntro({ settle: true })
  leaderboard.start()

  setInterval(tick, 1000)
  setInterval(() => {
    if (!introVisible && !modalOpen) {
      tipIndex = (tipIndex + 1) % TIPS.length
      els.tipText.textContent = TIPS[tipIndex]
    }
  }, 11000)
}

init()
