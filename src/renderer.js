import {
  WALL,
  FLOOR,
  EMBER,
  EXIT,
  START,
  ICE,
  PORTAL_A,
  PORTAL_B,
  CRACKED,
  FLAME,
  KEY,
  GATE,
  VOID,
  DIRS,
  cellChar,
  isFlameActive,
  sentryPosition,
  hashString,
} from './rules.js'

const TAU = Math.PI * 2

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function hash2(r, c) {
  return (hashString(`${r}:${c}`) % 1000) / 1000
}

export class BoardRenderer {
  constructor(canvas, { onSwipe, onHover, onTap } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.onSwipe = onSwipe
    this.onHover = onHover
    this.onTap = onTap
    this.game = null
    this.level = null
    this.state = null
    this.cssWidth = 0
    this.cssHeight = 0
    this.dpr = 1
    this.cell = 0
    this.offsetX = 0
    this.offsetY = 0
    this.hover = null
    this.staticCanvas = document.createElement('canvas')
    this.staticCtx = this.staticCanvas.getContext('2d')
    this.staticKey = ''
    this.particles = []
    this.dust = []
    this.sprite = { r: 0, c: 0, fromR: 0, fromC: 0, toR: 0, toC: 0, t: 1, queue: [] }
    this.trail = []
    this.shakeUntil = 0
    this.shakeStrength = 0
    this.flash = 0
    this.winGlow = 0
    this.pointer = null
    this.running = true
    this.lastFrame = 0
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas.parentElement || canvas)
    this.bindPointer()
    this.resize()
    this.loop = this.loop.bind(this)
    requestAnimationFrame(this.loop)
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value)
  }

  setGame(game) {
    this.game = game
    this.setLevel(game.level, game.state)
  }

  setLevel(level, state) {
    this.level = level
    this.state = state
    this.staticKey = ''
    this.particles = []
    this.trail = []
    this.winGlow = 0
    if (level && state) {
      const width = level.width
      const r = Math.floor(state.pos / width)
      const c = state.pos % width
      this.sprite = { r, c, fromR: r, fromC: c, toR: r, toC: c, t: 1, queue: [] }
      this.trail = [{ r, c, age: 0 }]
      this.ensureDust()
      this.cell = 0
      this.resize()
    }
  }

  updateState(state) {
    this.state = state
  }

  animateMove({ from, to, path, teleported }) {
    if (!this.level) return
    const width = this.level.width
    const fromR = Math.floor(from / width)
    const fromC = from % width
    const queue = (path && path.length ? path : [to]).map((index) => ({
      r: Math.floor(index / width),
      c: index % width,
    }))
    // Avoid drawing a line across the board on a portal jump.
    if (teleported) {
      this.spawnBurst(from, '#b48cff', 14, 0.6)
      this.spawnBurst(to, '#7af7ff', 18, 0.9)
      const destination = queue[queue.length - 1] || { r: fromR, c: fromC }
      this.sprite = {
        r: destination.r,
        c: destination.c,
        fromR: destination.r,
        fromC: destination.c,
        toR: destination.r,
        toC: destination.c,
        t: 1,
        queue: [],
        teleported: true,
      }
      this.trail = []
      return
    }
    this.sprite = {
      r: fromR,
      c: fromC,
      fromR,
      fromC,
      toR: queue[0]?.r ?? fromR,
      toC: queue[0]?.c ?? fromC,
      t: 0,
      queue,
      teleported,
    }
  }

  burstAt(index, color = '#ffb35c', count = 12, power = 1) {
    if (!this.level || index === undefined) return
    const width = this.level.width
    this.spawnBurst(index, color, count, power)
  }

  spawnBurst(index, color, count = 12, power = 1) {
    const width = this.level.width
    const r = Math.floor(index / width)
    const c = index % width
    const x = this.offsetX + (c + 0.5) * this.cell
    const y = this.offsetY + (r + 0.5) * this.cell
    const amount = this.reducedMotion ? Math.floor(count / 2) : count
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * TAU
      const speed = (0.6 + Math.random() * 2.2) * power
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.4,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.55,
        size: 1.2 + Math.random() * 2.8,
        color,
        gravity: 0.02,
      })
    }
  }

  shake(strength = 7, duration = 320) {
    if (this.reducedMotion) return
    this.shakeStrength = strength
    this.shakeUntil = performance.now() + duration
  }

  flashScreen(color = 'rgba(255,70,80,0.25)') {
    this.flash = 1
    this.flashColor = color
  }

  win() {
    this.winGlow = 1
    if (this.level) {
      const width = this.level.width
      const r = Math.floor(this.level.exit / width)
      const c = this.level.exit % width
      for (let i = 0; i < 30; i++) {
        this.spawnBurst(this.level.exit, i % 2 ? '#7af7ff' : '#ffb35c', 2, 1.6)
      }
      this.trail = []
      this.sprite.r = r
      this.sprite.c = c
    }
  }

  ensureDust() {
    if (this.dust.length) return
    for (let i = 0; i < 64; i++) {
      this.dust.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.00008,
        vy: -0.00004 - Math.random() * 0.00008,
        size: 0.6 + Math.random() * 1.8,
        alpha: 0.12 + Math.random() * 0.4,
        phase: Math.random() * TAU,
      })
    }
  }

  resize() {
    const parent = this.canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const width = Math.max(240, Math.floor(rect.width))
    const height = Math.max(240, Math.floor(rect.height))
    if (width === this.cssWidth && height === this.cssHeight && this.cell) return
    this.cssWidth = width
    this.cssHeight = height
    this.dpr = Math.min(2.5, globalThis.devicePixelRatio || 1)
    this.canvas.width = Math.floor(width * this.dpr)
    this.canvas.height = Math.floor(height * this.dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.staticCanvas.width = this.canvas.width
    this.staticCanvas.height = this.canvas.height
    this.computeMetrics()
    this.staticKey = ''
  }

  computeMetrics() {
    if (!this.level) {
      this.cell = 0
      return
    }
    const padding = Math.max(10, Math.min(this.cssWidth, this.cssHeight) * 0.025)
    this.cell = Math.floor(
      Math.min(
        (this.cssWidth - padding * 2) / this.level.width,
        (this.cssHeight - padding * 2) / this.level.height,
      ),
    )
    const boardWidth = this.cell * this.level.width
    const boardHeight = this.cell * this.level.height
    this.offsetX = Math.floor((this.cssWidth - boardWidth) / 2)
    this.offsetY = Math.floor((this.cssHeight - boardHeight) / 2)
  }

  bindPointer() {
    const canvas = this.canvas
    const getCell = (event) => {
      if (!this.level || !this.cell) return null
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const c = Math.floor((x - this.offsetX) / this.cell)
      const r = Math.floor((y - this.offsetY) / this.cell)
      if (r < 0 || c < 0 || r >= this.level.height || c >= this.level.width) return null
      return { r, c, index: r * this.level.width + c }
    }
    let down = null
    canvas.addEventListener('pointerdown', (event) => {
      down = { x: event.clientX, y: event.clientY, at: performance.now() }
      canvas.setPointerCapture?.(event.pointerId)
    })
    canvas.addEventListener('pointermove', (event) => {
      const cell = getCell(event)
      this.hover = cell
      this.onHover?.(cell)
      if (down) {
        const dx = event.clientX - down.x
        const dy = event.clientY - down.y
        if (Math.hypot(dx, dy) > 18) {
          down.swiped = true
        }
      }
    })
    canvas.addEventListener('pointerleave', () => {
      this.hover = null
      this.onHover?.(null)
    })
    canvas.addEventListener('pointerup', (event) => {
      if (!down) return
      const dx = event.clientX - down.x
      const dy = event.clientY - down.y
      const distance = Math.hypot(dx, dy)
      if (distance > 28) {
        const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
        this.onSwipe?.(direction)
      } else if (performance.now() - down.at < 450) {
        const cell = getCell(event)
        if (cell) this.onTap?.(cell)
      }
      down = null
    })
    canvas.addEventListener('pointercancel', () => {
      down = null
    })
  }

  loop(time) {
    if (!this.running) return
    this.lastFrame = time
    this.update(time)
    this.draw(time)
    requestAnimationFrame(this.loop)
  }

  update(time) {
    if (this.state) this.updateSprite()
    const dt = Math.min(0.05, (time - (this.prevTime || time)) / 1000)
    this.prevTime = time
    for (const particle of this.particles) {
      particle.life += dt
      particle.x += particle.vx * dt * 60
      particle.y += particle.vy * dt * 60
      particle.vy += particle.gravity
      particle.vx *= 0.985
    }
    this.particles = this.particles.filter((particle) => particle.life < particle.maxLife)
    for (const trail of this.trail) trail.age += dt
    this.trail = this.trail.filter((trail) => trail.age < 0.5).slice(-14)
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3)
    if (this.winGlow > 0) this.winGlow = Math.max(0, this.winGlow - dt * 0.55)
    for (const dust of this.dust) {
      dust.x += dust.vx * dt * 60
      dust.y += dust.vy * dt * 60
      if (dust.y < -0.05) dust.y = 1.05
      if (dust.x < -0.05) dust.x = 1.05
      if (dust.x > 1.05) dust.x = -0.05
    }
  }

  updateSprite() {
    const sprite = this.sprite
    if (!sprite.queue.length) return
    const speed = this.reducedMotion ? 0.25 : 0.075
    sprite.t += speed
    if (sprite.t >= 1) {
      sprite.r = sprite.toR
      sprite.c = sprite.toC
      sprite.queue.shift()
      if (sprite.queue.length) {
        sprite.fromR = sprite.r
        sprite.fromC = sprite.c
        sprite.toR = sprite.queue[0].r
        sprite.toC = sprite.queue[0].c
        sprite.t = 0
      } else {
        sprite.t = 1
      }
      this.trail.push({ r: sprite.r, c: sprite.c, age: 0 })
    }
  }

  cellCenter(r, c) {
    return {
      x: this.offsetX + (c + 0.5) * this.cell,
      y: this.offsetY + (r + 0.5) * this.cell,
    }
  }

  draw(time) {
    const ctx = this.ctx
    if (!this.level || !this.cell) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight)
    ctx.save()
    if (performance.now() < this.shakeUntil) {
      const amount = this.shakeStrength
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount)
    }

    this.drawBackdrop(time)
    this.ensureStatic()
    ctx.drawImage(this.staticCanvas, 0, 0, this.cssWidth, this.cssHeight)
    this.drawDynamic(time)

    if (this.flash > 0) {
      ctx.fillStyle = this.flashColor || 'rgba(255,70,80,0.25)'
      ctx.globalAlpha = this.flash * 0.7
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight)
      ctx.globalAlpha = 1
    }
    if (this.winGlow > 0) {
      const gradient = ctx.createRadialGradient(
        this.offsetX + this.cell * this.level.width * 0.5,
        this.offsetY + this.cell * this.level.height * 0.5,
        0,
        this.offsetX + this.cell * this.level.width * 0.5,
        this.offsetY + this.cell * this.level.height * 0.5,
        this.cell * this.level.width * 0.75,
      )
      gradient.addColorStop(0, `rgba(255,190,90,${0.14 * this.winGlow})`)
      gradient.addColorStop(1, 'rgba(255,190,90,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight)
    }
    ctx.restore()
  }

  drawBackdrop(time) {
    const ctx = this.ctx
    const gradient = ctx.createRadialGradient(
      this.cssWidth * 0.5,
      this.cssHeight * 0.45,
      this.cell * 0.2,
      this.cssWidth * 0.5,
      this.cssHeight * 0.5,
      Math.max(this.cssWidth, this.cssHeight) * 0.8,
    )
    gradient.addColorStop(0, '#101c2a')
    gradient.addColorStop(0.55, '#0a121d')
    gradient.addColorStop(1, '#05080e')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight)

    const glow = ctx.createRadialGradient(
      this.cssWidth * 0.5,
      this.cssHeight * 0.35,
      0,
      this.cssWidth * 0.5,
      this.cssHeight * 0.35,
      this.cssWidth * 0.55,
    )
    glow.addColorStop(0, 'rgba(255,150,60,0.055)')
    glow.addColorStop(0.55, 'rgba(70,220,200,0.025)')
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight)

    for (const dust of this.dust) {
      const alpha = dust.alpha * (0.55 + 0.45 * Math.sin(time * 0.0012 + dust.phase))
      ctx.fillStyle = `rgba(255,190,120,${alpha})`
      ctx.beginPath()
      ctx.arc(dust.x * this.cssWidth, dust.y * this.cssHeight, dust.size, 0, TAU)
      ctx.fill()
    }
  }

  ensureStatic() {
    const key = `${this.level.id || this.level.rows.join('')}|${this.state?.crumbled ?? 0}|${this.cssWidth}x${this.cssHeight}|${this.cell}`
    if (key === this.staticKey) return
    this.staticKey = key
    const ctx = this.staticCtx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight)
    this.drawStatic(ctx)
  }

  drawStatic(ctx) {
    const { level, cell } = this
    const width = level.width
    const height = level.height
    // Floor bed
    roundRectPath(
      ctx,
      this.offsetX - cell * 0.16,
      this.offsetY - cell * 0.16,
      width * cell + cell * 0.32,
      height * cell + cell * 0.32,
      cell * 0.22,
    )
    ctx.fillStyle = '#05090f'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,180,90,0.12)'
    ctx.lineWidth = 1
    ctx.stroke()

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const index = r * width + c
        const ch = cellChar(level, index)
        if (ch === WALL) continue
        this.drawFloor(ctx, r, c, index, ch)
      }
    }
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const index = r * width + c
        if (cellChar(level, index) === WALL) this.drawWall(ctx, r, c)
      }
    }
    // Static accents that sit on top of the floor.
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const index = r * width + c
        const ch = cellChar(level, index)
        if (ch === ICE) this.drawIceBase(ctx, r, c)
        if (ch === CRACKED) {
          const bit = level.crackedIndex.get(index)
          const crumbled = bit !== undefined && (this.state.crumbled & (1 << bit))
          if (crumbled) this.drawHole(ctx, r, c)
          else this.drawCracks(ctx, r, c)
        }
        if (ch === EXIT) this.drawExitBase(ctx, r, c)
      }
    }

    // Corner marks
    const corners = [
      [this.offsetX - cell * 0.24, this.offsetY - cell * 0.24, 1, 1],
      [this.offsetX + width * cell + cell * 0.24, this.offsetY - cell * 0.24, -1, 1],
      [this.offsetX - cell * 0.24, this.offsetY + height * cell + cell * 0.24, 1, -1],
      [this.offsetX + width * cell + cell * 0.24, this.offsetY + height * cell + cell * 0.24, -1, -1],
    ]
    ctx.strokeStyle = 'rgba(255,177,88,0.5)'
    ctx.lineWidth = 2
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath()
      ctx.moveTo(x, y + sy * cell * 0.18)
      ctx.lineTo(x, y)
      ctx.lineTo(x + sx * cell * 0.18, y)
      ctx.stroke()
    }
  }

  drawFloor(ctx, r, c, index, ch) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    const inset = Math.max(1, cell * 0.035)
    const size = cell - inset * 2
    const n = hash2(r, c)
    const warm = ch === START || ch === EXIT
    const top = warm ? 32 + n * 8 : 22 + n * 7
    const bottom = warm ? 20 + n * 6 : 14 + n * 5
    const gradient = ctx.createLinearGradient(x, y, x, y + cell)
    gradient.addColorStop(0, `rgb(${top + 6},${top + 14},${top + 22})`)
    gradient.addColorStop(1, `rgb(${bottom},${bottom + 9},${bottom + 17})`)
    roundRectPath(ctx, x + inset, y + inset, size, size, cell * 0.14)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.strokeStyle = warm ? 'rgba(255,180,90,0.16)' : 'rgba(140,190,210,0.08)'
    ctx.lineWidth = 1
    ctx.stroke()

    // Stone speckles
    ctx.fillStyle = `rgba(255,255,255,${0.018 + n * 0.02})`
    for (let i = 0; i < 3; i++) {
      const hx = x + inset + ((hash2(r + i, c * 3 + i) * 0.78 + 0.1) * size)
      const hy = y + inset + ((hash2(r * 3 + i, c + i) * 0.78 + 0.1) * size)
      ctx.fillRect(hx, hy, 1.2, 1.2)
    }
    if (warm) {
      const glow = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell * 0.5)
      glow.addColorStop(0, 'rgba(255,175,80,0.08)')
      glow.addColorStop(1, 'rgba(255,175,80,0)')
      ctx.fillStyle = glow
      ctx.fillRect(x, y, cell, cell)
    }
  }

  drawWall(ctx, r, c) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    const inset = Math.max(1, cell * 0.04)
    const size = cell - inset * 2
    const depth = cell * 0.18
    const n = hash2(r, c)
    // Side face
    roundRectPath(ctx, x + inset, y + inset + depth, size, size - depth, cell * 0.1)
    ctx.fillStyle = '#070b12'
    ctx.fill()
    // Top face
    const gradient = ctx.createLinearGradient(x, y, x, y + cell)
    gradient.addColorStop(0, `rgb(${34 + n * 12},${47 + n * 12},${64 + n * 12})`)
    gradient.addColorStop(1, `rgb(${17 + n * 8},${25 + n * 8},${36 + n * 8})`)
    roundRectPath(ctx, x + inset, y + inset, size, size - depth, cell * 0.1)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(160,205,225,0.11)'
    ctx.lineWidth = 1
    ctx.stroke()
    // Highlight
    ctx.strokeStyle = 'rgba(220,245,255,0.09)'
    ctx.beginPath()
    ctx.moveTo(x + inset + cell * 0.16, y + inset + 1)
    ctx.lineTo(x + inset + size - cell * 0.16, y + inset + 1)
    ctx.stroke()
    if (n > 0.72) {
      ctx.strokeStyle = 'rgba(255,170,80,0.13)'
      ctx.beginPath()
      ctx.moveTo(x + cell * 0.32, y + cell * 0.34)
      ctx.lineTo(x + cell * 0.5, y + cell * 0.52)
      ctx.lineTo(x + cell * 0.43, y + cell * 0.66)
      ctx.stroke()
    }
  }

  drawIceBase(ctx, r, c) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    const inset = cell * 0.09
    const gradient = ctx.createLinearGradient(x, y, x + cell, y + cell)
    gradient.addColorStop(0, 'rgba(90,235,255,0.22)')
    gradient.addColorStop(0.5, 'rgba(40,150,190,0.16)')
    gradient.addColorStop(1, 'rgba(120,250,255,0.1)')
    roundRectPath(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.1)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(150,250,255,0.32)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.strokeStyle = 'rgba(220,255,255,0.2)'
    ctx.beginPath()
    ctx.moveTo(x + cell * 0.26, y + cell * 0.7)
    ctx.lineTo(x + cell * 0.44, y + cell * 0.3)
    ctx.lineTo(x + cell * 0.58, y + cell * 0.58)
    ctx.stroke()
  }

  drawCracks(ctx, r, c) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = Math.max(1, cell * 0.03)
    ctx.beginPath()
    ctx.moveTo(x + cell * 0.25, y + cell * 0.3)
    ctx.lineTo(x + cell * 0.45, y + cell * 0.5)
    ctx.lineTo(x + cell * 0.38, y + cell * 0.72)
    ctx.moveTo(x + cell * 0.45, y + cell * 0.5)
    ctx.lineTo(x + cell * 0.72, y + cell * 0.42)
    ctx.lineTo(x + cell * 0.8, y + cell * 0.6)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,170,80,0.12)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  drawHole(ctx, r, c) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    const inset = cell * 0.1
    const gradient = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell * 0.6)
    gradient.addColorStop(0, '#000000')
    gradient.addColorStop(0.7, '#03060b')
    gradient.addColorStop(1, 'rgba(8,14,22,0.2)')
    roundRectPath(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.12)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,170,80,0.14)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  drawExitBase(ctx, r, c) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    ctx.save()
    ctx.translate(x + cell / 2, y + cell / 2)
    const w = cell * 0.54
    const h = cell * 0.68
    ctx.beginPath()
    ctx.moveTo(-w / 2, h / 2)
    ctx.lineTo(-w / 2, -h / 4)
    ctx.arc(0, -h / 4, w / 2, Math.PI, 0)
    ctx.lineTo(w / 2, h / 2)
    ctx.closePath()
    ctx.fillStyle = '#03060a'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,178,84,0.28)'
    ctx.lineWidth = Math.max(1, cell * 0.035)
    ctx.stroke()
    ctx.restore()
  }

  drawDynamic(time) {
    const ctx = this.ctx
    const { level, cell } = this
    const width = level.width
    const height = level.height
    const allEmbers = level.emberCells.length === 0 || this.state.embers === (1 << level.emberCells.length) - 1

    // Exit aura
    const ex = level.exit
    const er = Math.floor(ex / width)
    const ec = ex % width
    this.drawExit(ctx, er, ec, allEmbers, time)

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const index = r * width + c
        const ch = cellChar(level, index)
        if (ch === EMBER) {
          const bit = level.emberIndex.get(index)
          if (!(this.state.embers & (1 << bit))) this.drawEmber(ctx, r, c, index, time)
        } else if (ch === PORTAL_A || ch === PORTAL_B) {
          this.drawPortal(ctx, r, c, ch, time)
        } else if (ch === FLAME) {
          this.drawFlame(ctx, r, c, time)
        } else if (ch === KEY) {
          if (!this.state.key) this.drawKey(ctx, r, c, time)
        } else if (ch === GATE) {
          this.drawGate(ctx, r, c, this.state.key, time)
        }
      }
    }

    // Patrol hints under sentries
    for (const sentry of level.sentries) {
      for (const index of sentry.path) {
        const r = Math.floor(index / width)
        const c = index % width
        const x = this.offsetX + (c + 0.5) * cell
        const y = this.offsetY + (r + 0.5) * cell
        ctx.fillStyle = 'rgba(255,80,90,0.14)'
        ctx.beginPath()
        ctx.arc(x, y, Math.max(1.2, cell * 0.045), 0, TAU)
        ctx.fill()
      }
    }
    for (const sentry of level.sentries) {
      const index = sentryPosition(sentry, this.state.turn)
      const r = Math.floor(index / width)
      const c = index % width
      this.drawSentry(ctx, r, c, time)
    }

    this.drawPlayer(ctx, time)
    this.drawParticles(ctx)
    if (this.hover && this.state.status === 'playing') {
      const { r, c } = this.hover
      const x = this.offsetX + c * cell
      const y = this.offsetY + r * cell
      ctx.strokeStyle = 'rgba(255,200,120,0.45)'
      ctx.lineWidth = 1.5
      roundRectPath(ctx, x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.14)
      ctx.stroke()
    }
  }

  drawEmber(ctx, r, c, index, time) {
    const cell = this.cell
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell
    const pulse = 0.85 + Math.sin(time * 0.004 + index) * 0.15
    const radius = cell * 0.14 * pulse
    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.42)
    glow.addColorStop(0, 'rgba(255,230,160,0.55)')
    glow.addColorStop(0.35, 'rgba(255,150,60,0.26)')
    glow.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.42, 0, TAU)
    ctx.fill()
    const core = ctx.createRadialGradient(x - radius * 0.2, y - radius * 0.3, 0, x, y, radius * 1.4)
    core.addColorStop(0, '#fffdf2')
    core.addColorStop(0.35, '#ffd479')
    core.addColorStop(1, '#ff7b1f')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, TAU)
    ctx.fill()
    // four-point glint
    ctx.strokeStyle = 'rgba(255,245,210,0.75)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x - radius * 2.1, y)
    ctx.lineTo(x + radius * 2.1, y)
    ctx.moveTo(x, y - radius * 2.1)
    ctx.lineTo(x, y + radius * 2.1)
    ctx.stroke()
  }

  drawExit(ctx, r, c, open, time) {
    const cell = this.cell
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell
    if (!open) {
      ctx.fillStyle = 'rgba(255,150,60,0.25)'
      ctx.beginPath()
      ctx.arc(x, y, cell * 0.06, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,180,90,0.18)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(x, y, cell * 0.24, 0, TAU)
      ctx.stroke()
      return
    }
    const pulse = 0.8 + Math.sin(time * 0.0035) * 0.2
    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.65)
    glow.addColorStop(0, `rgba(255,220,150,${0.7 * pulse})`)
    glow.addColorStop(0.35, `rgba(255,150,60,${0.35 * pulse})`)
    glow.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.65, 0, TAU)
    ctx.fill()
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(time * 0.0005)
    ctx.strokeStyle = 'rgba(255,225,170,0.85)'
    ctx.lineWidth = Math.max(1.2, cell * 0.035)
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.arc(0, 0, cell * (0.22 + i * 0.055), i * 2.1, i * 2.1 + 1.7)
      ctx.stroke()
    }
    ctx.restore()
    const core = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.18)
    core.addColorStop(0, '#fffdf5')
    core.addColorStop(0.4, '#ffd98f')
    core.addColorStop(1, 'rgba(255,120,40,0.2)')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.18 * pulse, 0, TAU)
    ctx.fill()
  }

  drawPortal(ctx, r, c, ch, time) {
    const cell = this.cell
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell
    const color = ch === PORTAL_A ? '#b98cff' : '#78f6ff'
    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.5)
    glow.addColorStop(0, ch === PORTAL_A ? 'rgba(180,120,255,0.3)' : 'rgba(90,240,255,0.28)')
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.5, 0, TAU)
    ctx.fill()
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(time * (ch === PORTAL_A ? 0.0012 : -0.0012))
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.8
    ctx.lineWidth = Math.max(1.2, cell * 0.035)
    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.22, 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.3, 0.6, 2.5)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.3, 3.7, 5.6)
    ctx.stroke()
    ctx.restore()
    ctx.fillStyle = 'rgba(5,8,14,0.85)'
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.15, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.8
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.15, 0, TAU)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  drawFlame(ctx, r, c, time) {
    const cell = this.cell
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell
    const active = isFlameActive(this.level, this.state)
    // grate
    ctx.fillStyle = 'rgba(20,16,18,0.85)'
    roundRectPath(ctx, x - cell * 0.24, y - cell * 0.12, cell * 0.48, cell * 0.3, cell * 0.08)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,140,60,0.35)'
    ctx.lineWidth = 1
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.moveTo(x + i * cell * 0.11, y - cell * 0.08)
      ctx.lineTo(x + i * cell * 0.11, y + cell * 0.14)
      ctx.stroke()
    }
    if (!active) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.3)
      glow.addColorStop(0, 'rgba(255,120,40,0.28)')
      glow.addColorStop(1, 'rgba(255,120,40,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, cell * 0.3, 0, TAU)
      ctx.fill()
      return
    }
    const sway = Math.sin(time * 0.008 + r * 2 + c) * cell * 0.04
    const gradient = ctx.createLinearGradient(x, y + cell * 0.18, x, y - cell * 0.34)
    gradient.addColorStop(0, 'rgba(255,90,30,0.95)')
    gradient.addColorStop(0.5, 'rgba(255,190,80,0.95)')
    gradient.addColorStop(1, 'rgba(255,250,220,0.95)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(x - cell * 0.18, y + cell * 0.18)
    ctx.quadraticCurveTo(x - cell * 0.3 + sway, y - cell * 0.05, x - cell * 0.04 + sway, y - cell * 0.34)
    ctx.quadraticCurveTo(x + cell * 0.04 + sway, y - cell * 0.16, x + cell * 0.1 + sway, y - cell * 0.05)
    ctx.quadraticCurveTo(x + cell * 0.24 + sway, y + cell * 0.02, x + cell * 0.18, y + cell * 0.18)
    ctx.closePath()
    ctx.fill()
    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.5)
    glow.addColorStop(0, 'rgba(255,160,60,0.35)')
    glow.addColorStop(1, 'rgba(255,120,40,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.5, 0, TAU)
    ctx.fill()
  }

  drawKey(ctx, r, c, time) {
    const cell = this.cell
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell + Math.sin(time * 0.004 + r) * cell * 0.02
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-0.5)
    const scale = cell * 0.22
    ctx.strokeStyle = '#ffd58a'
    ctx.fillStyle = '#ffd58a'
    ctx.lineWidth = Math.max(1.4, cell * 0.045)
    ctx.beginPath()
    ctx.arc(-scale * 0.55, 0, scale * 0.4, 0, TAU)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(-scale * 0.15, 0)
    ctx.lineTo(scale * 1.1, 0)
    ctx.moveTo(scale * 0.72, 0)
    ctx.lineTo(scale * 0.72, scale * 0.36)
    ctx.moveTo(scale * 0.96, 0)
    ctx.lineTo(scale * 0.96, scale * 0.26)
    ctx.stroke()
    ctx.restore()
  }

  drawGate(ctx, r, c, open, time) {
    const cell = this.cell
    const x = this.offsetX + c * cell
    const y = this.offsetY + r * cell
    ctx.save()
    if (open) {
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = 'rgba(255,210,140,0.6)'
      ctx.lineWidth = Math.max(1, cell * 0.04)
      ctx.beginPath()
      ctx.moveTo(x + cell * 0.12, y + cell * 0.2)
      ctx.lineTo(x + cell * 0.12, y + cell * 0.8)
      ctx.moveTo(x + cell * 0.88, y + cell * 0.2)
      ctx.lineTo(x + cell * 0.88, y + cell * 0.8)
      ctx.stroke()
      ctx.restore()
      return
    }
    const gradient = ctx.createLinearGradient(x, y, x, y + cell)
    gradient.addColorStop(0, '#7a5a30')
    gradient.addColorStop(1, '#3b2a16')
    ctx.strokeStyle = gradient
    ctx.lineWidth = Math.max(1.4, cell * 0.05)
    for (let i = 0; i < 4; i++) {
      const bx = x + cell * (0.25 + i * 0.17)
      ctx.beginPath()
      ctx.moveTo(bx, y + cell * 0.16)
      ctx.lineTo(bx, y + cell * 0.84)
      ctx.stroke()
    }
    ctx.lineWidth = Math.max(1.2, cell * 0.04)
    ctx.beginPath()
    ctx.moveTo(x + cell * 0.18, y + cell * 0.32)
    ctx.lineTo(x + cell * 0.82, y + cell * 0.32)
    ctx.moveTo(x + cell * 0.18, y + cell * 0.68)
    ctx.lineTo(x + cell * 0.82, y + cell * 0.68)
    ctx.stroke()
    ctx.restore()
  }

  drawSentry(ctx, r, c, time) {
    const cell = this.cell
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell + Math.sin(time * 0.004 + r * 2) * cell * 0.03
    const pulse = 0.8 + Math.sin(time * 0.006) * 0.2
    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.5)
    glow.addColorStop(0, `rgba(255,50,70,${0.28 * pulse})`)
    glow.addColorStop(1, 'rgba(255,30,50,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.5, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#0b0a10'
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.26, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,80,100,0.55)'
    ctx.lineWidth = Math.max(1, cell * 0.03)
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.26, 0, TAU)
    ctx.stroke()
    // eye
    ctx.fillStyle = `rgba(255,70,90,${0.9 * pulse})`
    ctx.beginPath()
    ctx.ellipse(x, y, cell * 0.13, cell * 0.075, 0, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#fff1e0'
    ctx.beginPath()
    ctx.arc(x + cell * 0.03, y, cell * 0.035, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#17050a'
    ctx.beginPath()
    ctx.arc(x + cell * 0.03, y, cell * 0.016, 0, TAU)
    ctx.fill()
  }

  drawPlayer(ctx, time) {
    const sprite = this.sprite
    const cell = this.cell
    const t = easeOutCubic(Math.min(1, sprite.t))
    const r = lerp(sprite.fromR, sprite.toR, t)
    const c = lerp(sprite.fromC, sprite.toC, t)
    const bob = Math.sin(time * 0.005) * cell * 0.025
    const x = this.offsetX + (c + 0.5) * cell
    const y = this.offsetY + (r + 0.5) * cell + bob

    for (const trail of this.trail) {
      const tx = this.offsetX + (trail.c + 0.5) * cell
      const ty = this.offsetY + (trail.r + 0.5) * cell
      const alpha = Math.max(0, 0.22 * (1 - trail.age / 0.5))
      ctx.fillStyle = `rgba(120,250,235,${alpha})`
      ctx.beginPath()
      ctx.arc(tx, ty, cell * 0.11 * (1 - trail.age), 0, TAU)
      ctx.fill()
    }

    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * 0.55)
    glow.addColorStop(0, 'rgba(160,255,245,0.5)')
    glow.addColorStop(0.4, 'rgba(90,240,220,0.2)')
    glow.addColorStop(1, 'rgba(60,200,190,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.55, 0, TAU)
    ctx.fill()

    const core = ctx.createRadialGradient(x - cell * 0.04, y - cell * 0.05, 0, x, y, cell * 0.16)
    core.addColorStop(0, '#ffffff')
    core.addColorStop(0.4, '#c9fff6')
    core.addColorStop(0.75, '#6ff5de')
    core.addColorStop(1, '#2bb7a7')
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.16, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(x, y, cell * 0.16, 0, TAU)
    ctx.stroke()

    // two tiny eyes keep the spark readable at small sizes
    ctx.fillStyle = '#0a2a28'
    ctx.beginPath()
    ctx.arc(x - cell * 0.045, y - cell * 0.01, cell * 0.022, 0, TAU)
    ctx.arc(x + cell * 0.045, y - cell * 0.01, cell * 0.022, 0, TAU)
    ctx.fill()
  }

  drawParticles(ctx) {
    for (const particle of this.particles) {
      const alpha = Math.max(0, 1 - particle.life / particle.maxLife)
      ctx.globalAlpha = alpha
      ctx.fillStyle = particle.color
      ctx.beginPath()
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}
