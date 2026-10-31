/* Canvas renderer for the light board. All art is procedural. */

const TAU = Math.PI * 2

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function partialPoints(points, progress) {
  if (points.length < 2 || progress <= 0) return []
  if (progress >= 1) return points
  let total = 0
  const lengths = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    lengths.push(length)
    total += length
  }
  const target = total * progress
  const result = [points[0]]
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const segment = lengths[i - 1]
    if (walked + segment <= target) {
      result.push(points[i])
      walked += segment
      continue
    }
    const remain = target - walked
    const t = segment === 0 ? 0 : remain / segment
    const a = points[i - 1]
    const b = points[i]
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    break
  }
  return result
}

export function createBoardRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true })
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
  const view = { width: 0, height: 0, dpr: 1, pad: 0, cell: 0, inner: 0 }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    const dpr = Math.min(2.25, window.devicePixelRatio || 1)
    if (view.width === width && view.height === height && view.dpr === dpr) return
    view.width = width
    view.height = height
    view.dpr = dpr
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const size = Math.min(width, height)
    view.pad = size * 0.035
    view.inner = size - view.pad * 2
  }

  function geometry(puzzle) {
    resize()
    const size = Math.min(view.width, view.height)
    const pad = view.pad
    const inner = view.inner
    const cell = inner / Math.max(puzzle.w, puzzle.h)
    return { size, pad, inner, cell }
  }

  function cellAt(clientX, clientY, puzzle) {
    const rect = canvas.getBoundingClientRect()
    const { pad, cell } = geometry(puzzle)
    const x = clientX - rect.left
    const y = clientY - rect.top
    const gx = Math.floor((x - pad) / cell)
    const gy = Math.floor((y - pad) / cell)
    if (gx < 0 || gy < 0 || gx >= puzzle.w || gy >= puzzle.h) return null
    return { x: gx, y: gy }
  }

  function centerOf(puzzle, cellInfo, geo) {
    return {
      x: geo.pad + (cellInfo.x + 0.5) * geo.cell,
      y: geo.pad + (cellInfo.y + 0.5) * geo.cell,
    }
  }

  function drawBackground(geo, now) {
    const { pad, inner, cell } = geo
    const radius = Math.min(28, cell * 0.55)
    const boardX = pad
    const boardY = pad
    const boardSize = inner

    const outerGlow = ctx.createRadialGradient(
      boardX + boardSize * 0.5,
      boardY + boardSize * 0.42,
      boardSize * 0.1,
      boardX + boardSize * 0.5,
      boardY + boardSize * 0.5,
      boardSize * 0.72,
    )
    outerGlow.addColorStop(0, 'rgba(66, 210, 255, 0.075)')
    outerGlow.addColorStop(0.55, 'rgba(96, 78, 255, 0.035)')
    outerGlow.addColorStop(1, 'rgba(5, 7, 17, 0)')
    ctx.fillStyle = outerGlow
    ctx.fillRect(0, 0, view.width, view.height)

    roundRect(ctx, boardX - 1, boardY - 1, boardSize + 2, boardSize + 2, radius + 1)
    ctx.fillStyle = 'rgba(3, 6, 16, 0.72)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(112, 150, 255, 0.14)'
    ctx.lineWidth = 1
    ctx.stroke()

    roundRect(ctx, boardX, boardY, boardSize, boardSize, radius)
    const bg = ctx.createLinearGradient(boardX, boardY, boardX + boardSize, boardY + boardSize)
    bg.addColorStop(0, '#081127')
    bg.addColorStop(0.5, '#060b1c')
    bg.addColorStop(1, '#0a0a1d')
    ctx.fillStyle = bg
    ctx.fill()

    ctx.save()
    roundRect(ctx, boardX, boardY, boardSize, boardSize, radius)
    ctx.clip()

    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        const tx = boardX + x * cell
        const ty = boardY + y * cell
        const tone = (x + y) % 2 === 0 ? 0.018 : 0.03
        ctx.fillStyle = `rgba(160, 195, 255, ${tone})`
        roundRect(ctx, tx + cell * 0.045, ty + cell * 0.045, cell * 0.91, cell * 0.91, cell * 0.16)
        ctx.fill()
      }
    }

    ctx.strokeStyle = 'rgba(120, 160, 255, 0.075)'
    ctx.lineWidth = 1
    for (let i = 1; i < 9; i++) {
      ctx.beginPath()
      ctx.moveTo(boardX + i * cell, boardY)
      ctx.lineTo(boardX + i * cell, boardY + boardSize)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(boardX, boardY + i * cell)
      ctx.lineTo(boardX + boardSize, boardY + i * cell)
      ctx.stroke()
    }

    const sweep = (now * 0.000035) % 1
    const sweepGradient = ctx.createLinearGradient(boardX, boardY + boardSize * (sweep - 0.2), boardX + boardSize, boardY + boardSize * (sweep + 0.1))
    sweepGradient.addColorStop(0, 'rgba(94, 243, 255, 0)')
    sweepGradient.addColorStop(0.5, 'rgba(94, 243, 255, 0.028)')
    sweepGradient.addColorStop(1, 'rgba(255, 95, 220, 0)')
    ctx.fillStyle = sweepGradient
    ctx.fillRect(boardX, boardY, boardSize, boardSize)

    ctx.restore()
    return { boardX, boardY, boardSize, radius }
  }

  function drawWalls(puzzle, geo) {
    const { pad, cell } = geo
    for (const wall of puzzle.walls) {
      const x = pad + wall.x * cell + cell * 0.055
      const y = pad + wall.y * cell + cell * 0.055
      const w = cell * 0.89
      const r = cell * 0.16
      roundRect(ctx, x, y, w, w, r)
      const fill = ctx.createLinearGradient(x, y, x + w, y + w)
      fill.addColorStop(0, '#111a35')
      fill.addColorStop(1, '#070a18')
      ctx.fillStyle = fill
      ctx.fill()
      ctx.strokeStyle = 'rgba(126, 156, 255, 0.16)'
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.save()
      roundRect(ctx, x, y, w, w, r)
      ctx.clip()
      ctx.strokeStyle = 'rgba(126, 156, 255, 0.07)'
      ctx.lineWidth = 1
      for (let d = -w; d < w * 2; d += cell * 0.16) {
        ctx.beginPath()
        ctx.moveTo(x + d, y)
        ctx.lineTo(x + d - w, y + w)
        ctx.stroke()
      }
      const sheen = ctx.createLinearGradient(x, y, x, y + w)
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.055)')
      sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)')
      sheen.addColorStop(1, 'rgba(0, 0, 0, 0.22)')
      ctx.fillStyle = sheen
      ctx.fillRect(x, y, w, w)
      ctx.restore()

      if ((wall.x * 7 + wall.y * 13) % 5 === 0) {
        ctx.beginPath()
        ctx.arc(x + w * 0.72, y + w * 0.3, Math.max(1.2, cell * 0.022), 0, TAU)
        ctx.fillStyle = 'rgba(94, 243, 255, 0.42)'
        ctx.fill()
      }
    }
  }

  function drawBeam(puzzle, state, geo, now) {
    const { pad, cell } = geo
    const points = state.trace.points.map((point) => ({
      x: pad + (point.x + 0.5) * cell,
      y: pad + (point.y + 0.5) * cell,
    }))
    const progress = easeOutCubic(Math.max(0, Math.min(1, state.beamProgress)))
    const visible = partialPoints(points, reduceMotion ? 1 : progress)
    if (visible.length < 2) return

    const solved = Boolean(state.solved)
    const color = solved ? '255, 214, 120' : '94, 243, 255'
    const secondary = solved ? '255, 167, 92' : '180, 112, 255'

    ctx.save()
    roundRect(ctx, pad, pad, geo.inner, geo.inner, Math.min(28, cell * 0.55))
    ctx.clip()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const path = () => {
      ctx.beginPath()
      ctx.moveTo(visible[0].x, visible[0].y)
      for (let i = 1; i < visible.length; i++) ctx.lineTo(visible[i].x, visible[i].y)
    }

    ctx.globalCompositeOperation = 'lighter'
    path()
    ctx.strokeStyle = `rgba(${color}, 0.09)`
    ctx.lineWidth = cell * 0.7
    ctx.shadowColor = `rgba(${color}, 0.55)`
    ctx.shadowBlur = cell * 0.7
    ctx.stroke()

    path()
    ctx.strokeStyle = `rgba(${color}, 0.22)`
    ctx.lineWidth = cell * 0.28
    ctx.shadowBlur = cell * 0.45
    ctx.stroke()

    path()
    const gradient = ctx.createLinearGradient(visible[0].x, visible[0].y, visible[visible.length - 1].x, visible[visible.length - 1].y)
    gradient.addColorStop(0, `rgba(${color}, 0.95)`)
    gradient.addColorStop(0.55, 'rgba(246, 251, 255, 0.98)')
    gradient.addColorStop(1, `rgba(${secondary}, 0.95)`)
    ctx.strokeStyle = gradient
    ctx.lineWidth = Math.max(1.6, cell * 0.055)
    ctx.shadowColor = `rgba(${color}, 0.9)`
    ctx.shadowBlur = cell * 0.35
    ctx.stroke()

    path()
    ctx.setLineDash([cell * 0.11, cell * 0.52])
    ctx.lineDashOffset = reduceMotion ? 0 : -(now * 0.11)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.lineWidth = Math.max(1, cell * 0.018)
    ctx.shadowBlur = 0
    ctx.stroke()
    ctx.setLineDash([])

    if (!reduceMotion && !solved) {
      for (const point of visible.slice(1, -1)) {
        const flicker = 0.35 + 0.25 * Math.sin(now * 0.01 + point.x * 0.2)
        ctx.beginPath()
        ctx.arc(point.x, point.y, cell * 0.045, 0, TAU)
        ctx.fillStyle = `rgba(255, 255, 255, ${flicker})`
        ctx.fill()
      }
    }
    ctx.restore()
  }

  function drawCrystal(puzzle, index, state, geo, now) {
    const { cell } = geo
    const c = centerOf(puzzle, puzzle.crystals[index], geo)
    const lit = state.trace.lit.includes(index)
    const pulse = lit && !reduceMotion ? 1 + Math.sin(now * 0.005 + index * 1.7) * 0.07 : 1
    const radius = cell * 0.19 * pulse
    const solved = state.solved

    ctx.save()
    ctx.translate(c.x, c.y)

    if (lit) {
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.55)
      halo.addColorStop(0, solved ? 'rgba(255, 223, 150, 0.5)' : 'rgba(255, 95, 220, 0.38)')
      halo.addColorStop(0.45, solved ? 'rgba(255, 190, 100, 0.14)' : 'rgba(255, 95, 220, 0.12)')
      halo.addColorStop(1, 'rgba(255, 95, 220, 0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(0, 0, cell * 0.55, 0, TAU)
      ctx.fill()
    }

    ctx.rotate(Math.PI / 4)
    ctx.beginPath()
    ctx.moveTo(0, -radius)
    ctx.lineTo(radius, 0)
    ctx.lineTo(0, radius)
    ctx.lineTo(-radius, 0)
    ctx.closePath()
    const fill = ctx.createLinearGradient(-radius, -radius, radius, radius)
    if (lit) {
      fill.addColorStop(0, solved ? '#fff6d7' : '#ffe4fb')
      fill.addColorStop(0.5, solved ? '#ffcf70' : '#ff6bdc')
      fill.addColorStop(1, solved ? '#ff9f43' : '#9a5cff')
    } else {
      fill.addColorStop(0, '#2c1746')
      fill.addColorStop(1, '#130b27')
    }
    ctx.fillStyle = fill
    ctx.shadowColor = lit ? (solved ? 'rgba(255, 207, 112, 0.9)' : 'rgba(255, 95, 220, 0.85)') : 'rgba(255, 95, 220, 0.2)'
    ctx.shadowBlur = lit ? cell * 0.4 : cell * 0.1
    ctx.fill()
    ctx.strokeStyle = lit ? 'rgba(255, 244, 255, 0.9)' : 'rgba(255, 95, 220, 0.38)'
    ctx.lineWidth = Math.max(1, cell * 0.022)
    ctx.stroke()
    ctx.restore()

    if (!lit) {
      ctx.beginPath()
      ctx.arc(c.x, c.y, cell * 0.28, 0, TAU)
      ctx.strokeStyle = 'rgba(255, 95, 220, 0.16)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 5])
      ctx.stroke()
      ctx.setLineDash([])
    } else if (!reduceMotion) {
      const sparkle = (now * 0.002 + index) % 1
      ctx.beginPath()
      ctx.arc(c.x, c.y - cell * (0.32 + sparkle * 0.1), Math.max(1, cell * 0.016 * (1 - sparkle)), 0, TAU)
      ctx.fillStyle = `rgba(255, 255, 255, ${0.65 * (1 - sparkle)})`
      ctx.fill()
    }
  }

  function drawMirror(puzzle, index, state, geo, now) {
    const { cell } = geo
    const mirror = puzzle.mirrors[index]
    const c = centerOf(puzzle, mirror, geo)
    const baseAngle = state.angleAnims?.[index]
    let angle = (state.angles?.[index] ?? 0) * Math.PI / 180
    if (baseAngle) {
      const t = Math.min(1, (now - baseAngle.start) / baseAngle.duration)
      angle = (baseAngle.from + (baseAngle.to - baseAngle.from) * easeInOutCubic(t)) * Math.PI / 180
    }
    const hinted = state.hintIndex === index
    const hovered = state.hovered && state.hovered.x === mirror.x && state.hovered.y === mirror.y
    const solved = state.solved

    if (hinted) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008)
      ctx.beginPath()
      ctx.arc(c.x, c.y, cell * (0.34 + pulse * 0.04), 0, TAU)
      ctx.strokeStyle = `rgba(255, 207, 112, ${0.5 + pulse * 0.35})`
      ctx.lineWidth = Math.max(1.4, cell * 0.025)
      ctx.setLineDash([cell * 0.08, cell * 0.06])
      ctx.lineDashOffset = -now * 0.02
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.save()
    ctx.translate(c.x, c.y)

    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.29, 0, TAU)
    ctx.fillStyle = hovered ? 'rgba(94, 243, 255, 0.09)' : 'rgba(10, 16, 38, 0.65)'
    ctx.fill()

    ctx.rotate(angle)
    const length = cell * 0.31
    const grad = ctx.createLinearGradient(-length, 0, length, 0)
    grad.addColorStop(0, solved ? 'rgba(255, 207, 112, 0.95)' : 'rgba(134, 236, 255, 0.92)')
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.98)')
    grad.addColorStop(1, solved ? 'rgba(255, 160, 80, 0.95)' : 'rgba(154, 123, 255, 0.95)')
    ctx.strokeStyle = grad
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(3, cell * 0.075)
    ctx.shadowColor = solved ? 'rgba(255, 207, 112, 0.8)' : 'rgba(94, 243, 255, 0.7)'
    ctx.shadowBlur = hinted ? cell * 0.45 : cell * 0.25
    ctx.beginPath()
    ctx.moveTo(-length, 0)
    ctx.lineTo(length, 0)
    ctx.stroke()

    ctx.shadowBlur = 0
    ctx.beginPath()
    ctx.arc(-length, 0, Math.max(1.6, cell * 0.045), 0, TAU)
    ctx.arc(length, 0, Math.max(1.6, cell * 0.045), 0, TAU)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.fill()
    ctx.restore()

    ctx.beginPath()
    ctx.arc(c.x, c.y, cell * 0.07, 0, TAU)
    ctx.fillStyle = 'rgba(6, 10, 24, 0.9)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = 1
    ctx.stroke()

    if (hinted) {
      const bob = Math.sin(now * 0.005) * cell * 0.02
      ctx.save()
      ctx.translate(c.x, c.y - cell * 0.55 + bob)
      ctx.beginPath()
      ctx.moveTo(-cell * 0.08, -cell * 0.03)
      ctx.lineTo(cell * 0.08, -cell * 0.03)
      ctx.lineTo(cell * 0.08, cell * 0.035)
      ctx.lineTo(cell * 0.13, cell * 0.035)
      ctx.lineTo(0, cell * 0.15)
      ctx.lineTo(-cell * 0.13, cell * 0.035)
      ctx.lineTo(-cell * 0.08, cell * 0.035)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 207, 112, 0.92)'
      ctx.shadowColor = 'rgba(255, 207, 112, 0.7)'
      ctx.shadowBlur = cell * 0.25
      ctx.fill()
      ctx.restore()
    }
  }

  function drawEmitter(puzzle, state, geo, now) {
    const { cell } = geo
    const c = centerOf(puzzle, puzzle.emitter, geo)
    const solved = state.solved
    const pulse = reduceMotion ? 1 : 1 + Math.sin(now * 0.004) * 0.06

    ctx.save()
    ctx.translate(c.x, c.y)

    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.58)
    halo.addColorStop(0, solved ? 'rgba(255, 214, 120, 0.45)' : 'rgba(94, 243, 255, 0.32)')
    halo.addColorStop(1, 'rgba(94, 243, 255, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.58, 0, TAU)
    ctx.fill()

    ctx.rotate(reduceMotion ? 0 : now * 0.00035)
    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.28 * pulse, 0, TAU)
    ctx.strokeStyle = solved ? 'rgba(255, 214, 120, 0.75)' : 'rgba(94, 243, 255, 0.7)'
    ctx.lineWidth = Math.max(1.5, cell * 0.025)
    ctx.setLineDash([cell * 0.09, cell * 0.07])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.rotate(-(reduceMotion ? 0 : now * 0.00035))

    ctx.beginPath()
    ctx.arc(0, 0, cell * 0.13, 0, TAU)
    const core = ctx.createRadialGradient(-cell * 0.04, -cell * 0.04, 0, 0, 0, cell * 0.16)
    core.addColorStop(0, '#ffffff')
    core.addColorStop(0.35, solved ? '#ffcf70' : '#8ff8ff')
    core.addColorStop(1, solved ? 'rgba(255, 159, 67, 0.2)' : 'rgba(43, 184, 255, 0.25)')
    ctx.fillStyle = core
    ctx.shadowColor = solved ? 'rgba(255, 207, 112, 0.95)' : 'rgba(94, 243, 255, 0.95)'
    ctx.shadowBlur = cell * 0.4
    ctx.fill()
    ctx.restore()
  }

  function drawParticles(state, geo) {
    const { pad, cell } = geo
    if (!state.particles?.length) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const particle of state.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife)
      const x = pad + (particle.gx + 0.5) * cell
      const y = pad + (particle.gy + 0.5) * cell
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.8, particle.size * cell * alpha), 0, TAU)
      ctx.fillStyle = `rgba(${particle.color}, ${alpha * 0.85})`
      ctx.fill()
    }
    ctx.restore()
  }

  function drawCursor(state, geo, now) {
    if (!state.showCursor || !state.cursor) return
    const { pad, cell } = geo
    const x = pad + state.cursor.x * cell + cell * 0.08
    const y = pad + state.cursor.y * cell + cell * 0.08
    const size = cell * 0.84
    const pulse = 0.65 + 0.35 * Math.sin(now * 0.008)
    roundRect(ctx, x, y, size, size, cell * 0.18)
    ctx.strokeStyle = `rgba(94, 243, 255, ${0.5 + pulse * 0.35})`
    ctx.lineWidth = Math.max(1.4, cell * 0.022)
    ctx.setLineDash([cell * 0.12, cell * 0.07])
    ctx.stroke()
    ctx.setLineDash([])
  }

  function render(state, now = performance.now()) {
    const puzzle = state.puzzle
    if (!puzzle) return
    const geo = geometry(puzzle)
    ctx.clearRect(0, 0, view.width, view.height)

    let shakeX = 0
    let shakeY = 0
    if (!reduceMotion && state.shake > 0) {
      const amount = state.shake
      shakeX = (Math.random() - 0.5) * amount
      shakeY = (Math.random() - 0.5) * amount
    }

    ctx.save()
    ctx.translate(shakeX, shakeY)

    const board = drawBackground(geo, now)
    ctx.save()
    roundRect(ctx, board.boardX, board.boardY, board.boardSize, board.boardSize, board.radius)
    ctx.clip()
    drawBeam(puzzle, state, geo, now)
    drawWalls(puzzle, geo)
    for (let i = 0; i < puzzle.crystals.length; i++) drawCrystal(puzzle, i, state, geo, now)
    for (let i = 0; i < puzzle.mirrors.length; i++) drawMirror(puzzle, i, state, geo, now)
    drawEmitter(puzzle, state, geo, now)
    drawParticles(state, geo)
    drawCursor(state, geo, now)
    ctx.restore()

    if (!reduceMotion && state.solved) {
      const t = Math.min(1, (now - (state.solvedAt || now)) / 900)
      if (t < 1) {
        ctx.fillStyle = `rgba(255, 235, 185, ${0.13 * (1 - t)})`
        ctx.fillRect(0, 0, view.width, view.height)
      }
    }

    ctx.restore()
  }

  return { resize, cellAt, render, view }
}
