#!/usr/bin/env node
/*
 * PRISMA — optional shared weekly leaderboard.
 *
 * Zero dependencies. Serves the static game and a tiny JSON API:
 *
 *   GET  /api/leaderboard?week=2026-W44
 *   POST /api/leaderboard?week=2026-W44
 *        { id, name, score, timeMs, levels, crystals }
 *
 * Start with:
 *   node server/leaderboard-server.mjs
 *
 * Then open http://localhost:4173/?online=1 (or set
 * window.PRISMA_CONFIG = { leaderboardApi: '/api/leaderboard' } yourself).
 *
 * Scores are stored in .data/leaderboard.json. Only the best score per player
 * and week is kept; ties are resolved by the faster run.
 */

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, '.data')
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json')
const PORT = Number(process.env.PORT) || 4173
const HOST = process.env.HOST || '0.0.0.0'
const MAX_BODY = 16 * 1024
const MAX_WEEKS = 26
const MAX_ENTRIES = 150

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

let store = { version: 1, weeks: {} }
let writeQueue = Promise.resolve()

function normalizeName(value) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14)
}

function cleanPlayer(input) {
  const id = String(input?.id || '').trim()
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return { error: 'Geçersiz oyuncu kimliği.' }
  const name = normalizeName(input?.name)
  if (name.length < 1) return { error: 'Oyuncu adı gerekli.' }
  const score = Number(input?.score)
  const timeMs = Number(input?.timeMs)
  const levels = Number(input?.levels)
  const crystals = Number(input?.crystals)
  if (!Number.isFinite(score) || score < 0 || score > 100000) return { error: 'Geçersiz skor.' }
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > 86400000) return { error: 'Geçersiz süre.' }
  if (!Number.isFinite(levels) || levels < 0 || levels > 6) return { error: 'Geçersiz bölüm sayısı.' }
  if (!Number.isFinite(crystals) || crystals < 0 || crystals > 120) return { error: 'Geçersiz kristal sayısı.' }
  return {
    player: {
      id,
      name,
      score: Math.round(score),
      timeMs: Math.round(timeMs),
      levels: Math.round(levels),
      crystals: Math.round(crystals),
      updatedAt: Date.now(),
    },
  }
}

function weekParam(url) {
  const week = url.searchParams.get('week') || ''
  return /^\d{4}-W\d{2}$/.test(week) ? week : ''
}

function sortedEntries(weekKey) {
  const players = store.weeks[weekKey]?.players || {}
  return Object.values(players)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
      return String(a.name).localeCompare(String(b.name), 'tr')
    })
    .slice(0, MAX_ENTRIES)
    .map(({ id, name, score, timeMs, levels, crystals }) => ({ id, name, score, timeMs, levels, crystals }))
}

function pruneWeeks() {
  const keys = Object.keys(store.weeks).sort().reverse()
  for (const key of keys.slice(MAX_WEEKS)) delete store.weeks[key]
}

async function loadStore() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && parsed.version === 1 && parsed.weeks && typeof parsed.weeks === 'object') {
      store = parsed
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[prisma] Could not read ${DATA_FILE}: ${error.message}`)
    }
  }
}

function persist() {
  const payload = JSON.stringify(store, null, 2)
  writeQueue = writeQueue
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true })
      const temp = `${DATA_FILE}.tmp`
      await writeFile(temp, payload)
      await rename(temp, DATA_FILE)
    })
    .catch((error) => {
      console.error(`[prisma] Could not save leaderboard: ${error.message}`)
    })
  return writeQueue
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(text)
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Gövde çok büyük.'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(Object.assign(new Error('Geçersiz JSON.'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    })
    res.end()
    return
  }

  const week = weekParam(url)
  if (!week) {
    sendJson(res, 400, { error: 'week parametresi YYYY-Www biçiminde olmalı.' })
    return
  }

  if (req.method === 'GET') {
    sendJson(res, 200, { week, entries: sortedEntries(week) })
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS')
    sendJson(res, 405, { error: 'Yöntem desteklenmiyor.' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch (error) {
    sendJson(res, error.status || 400, { error: error.message })
    return
  }

  const { player, error } = cleanPlayer(body)
  if (error) {
    sendJson(res, 400, { error })
    return
  }

  const weekData = store.weeks[week] || { players: {} }
  store.weeks[week] = weekData
  const current = weekData.players[player.id]
  const improved = !current
    || player.score > current.score
    || (player.score === current.score && player.timeMs < current.timeMs)
  if (improved) weekData.players[player.id] = player
  else if (current && current.name !== player.name) current.name = player.name

  pruneWeeks()
  await persist()
  sendJson(res, 200, {
    week,
    improved,
    entries: sortedEntries(week),
  })
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    sendText(res, 405, 'Yöntem desteklenmiyor.')
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    sendText(res, 400, 'Geçersiz yol.')
    return
  }
  if (pathname === '/') pathname = '/index.html'

  const filePath = path.resolve(ROOT, `.${pathname}`)
  const relative = path.relative(ROOT, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some((part) => part.startsWith('.'))) {
    sendText(res, 404, 'Bulunamadı.')
    return
  }

  try {
    const data = await readFile(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const isHtml = ext === '.html'
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') sendText(res, 404, 'Bulunamadı.')
    else {
      console.error(`[prisma] Static file error: ${error.message}`)
      sendText(res, 500, 'Sunucu hatası.')
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    if (url.pathname === '/api/leaderboard') {
      await handleApi(req, res, url)
    } else {
      await serveStatic(req, res, url)
    }
  } catch (error) {
    console.error(`[prisma] ${error.stack || error.message}`)
    if (!res.headersSent) sendJson(res, 500, { error: 'Sunucu hatası.' })
    else res.end()
  }
})

await loadStore()
server.listen(PORT, HOST, () => {
  console.log(`PRISMA sunucusu hazır: http://localhost:${PORT}/?online=1`)
  console.log(`Lig verisi: ${DATA_FILE}`)
})

function shutdown(signal) {
  console.log(`\n[prisma] ${signal} alındı, kapatılıyor…`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 4000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
