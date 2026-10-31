/**
 * Build the committed campaign and weekly level pools.
 *
 * Run: node scripts/build-levels.js
 * The output is deterministic for the seeds below.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generateLevel } from '../src/generator.js'
import { parseLevel, solveLevel } from '../src/rules.js'

const root = new URL('..', import.meta.url).pathname
const outDir = join(root, 'src', 'data')
mkdirSync(outDir, { recursive: true })

const campaignSpecs = [
  {
    name: 'İlk Kıvılcım',
    intro: 'Karanlık koridorlarda ilk adımını at. Korları topla, ocağı uyandır.',
    difficulty: 1,
    required: [],
  },
  {
    name: 'Köz Yolu',
    intro: 'Küllerin arasında bir yol var; her dönemeç bir tuzak.',
    difficulty: 2,
    required: [],
  },
  {
    name: 'Buz Çatlağı',
    intro: 'Donmuş taşlar seni kaydırır. Buzun üstünde durmayı unut.',
    difficulty: 3,
    required: ['ice'],
  },
  {
    name: 'Sessiz Geçit',
    intro: 'İki kapı, tek bir nefes. Portallar mesafeyi kandırır.',
    difficulty: 4,
    required: ['portal'],
  },
  {
    name: 'Kırık Basamak',
    intro: 'Ardında çatlayan taşlar bırak. Geri dönüş yok.',
    difficulty: 5,
    required: ['cracked'],
  },
  {
    name: 'Alev Kapısı',
    intro: 'Alevler her tur açılır ve kapanır. Doğru anı bekle.',
    difficulty: 6,
    required: ['flame'],
  },
  {
    name: 'Kayıp Anahtar',
    intro: 'Kapılar kilitli; anahtarı bulmadan ocağa ulaşamazsın.',
    difficulty: 7,
    required: ['key'],
    maxOptimal: 62,
  },
  {
    name: 'Gölge Kovuğu',
    intro: 'Kül gözü koridorda dolaşıyor. Gölgesine basma.',
    difficulty: 8,
    required: ['sentry'],
    maxOptimal: 65,
  },
  {
    name: 'Duman Halkası',
    intro: 'İki bekçi, dar bir geçit. Ritmi bozma.',
    difficulty: 9,
    required: ['sentry', 'portal'],
    maxOptimal: 70,
  },
  {
    name: 'Son Ocak',
    intro: 'Bütün korlar bir arada. Labirentin kalbine in.',
    difficulty: 10,
    required: ['sentry', 'portal', 'flame'],
    maxOptimal: 68,
    extra: (level) => level.sentries.length >= 2,
  },
  {
    name: 'Küllerin Sırrı',
    intro: 'Her mekanizma devrede. Ustalaşma vakti.',
    difficulty: 10,
    required: ['ice', 'portal', 'cracked', 'flame', 'key', 'sentry'],
    maxOptimal: 72,
  },
  {
    name: 'Kor Labirenti',
    intro: 'Son sınav: ateş, buz, gölge ve çelik.',
    difficulty: 10,
    required: ['portal', 'cracked', 'flame', 'sentry'],
    maxOptimal: 68,
  },
]

function satisfies(level, spec) {
  if (!level) return false
  if (spec.required.some((feature) => !level.features.includes(feature))) return false
  if (spec.extra && !spec.extra(level)) return false
  if (level.optimal > (spec.maxOptimal || 72)) return false
  return true
}

function validate(level) {
  try {
    const parsed = parseLevel(level)
    const solution = solveLevel(parsed, { maxStates: 350000 })
    if (!solution.solved) return false
    if (solution.optimal !== level.optimal) return false
    return true
  } catch {
    return false
  }
}

const campaign = []
for (let index = 0; index < campaignSpecs.length; index++) {
  const spec = campaignSpecs[index]
  let chosen = null
  for (let attempt = 0; attempt < 400 && !chosen; attempt++) {
    const candidate = generateLevel({
      seed: `campaign-${index + 1}-${attempt}`,
      difficulty: spec.difficulty,
      name: spec.name,
      id: `campaign-${index + 1}`,
    })
    if (satisfies(candidate, spec) && validate(candidate)) chosen = candidate
  }
  if (!chosen) {
    // Relax the feature requirement rather than shipping a hole.
    for (let attempt = 0; attempt < 400 && !chosen; attempt++) {
      const candidate = generateLevel({
        seed: `campaign-fallback-${index + 1}-${attempt}`,
        difficulty: spec.difficulty,
        name: spec.name,
        id: `campaign-${index + 1}`,
      })
      if (candidate && validate(candidate)) chosen = candidate
    }
  }
  if (!chosen) throw new Error(`Could not generate campaign level ${index + 1}`)
  chosen.intro = spec.intro
  chosen.chapter = index + 1
  campaign.push(chosen)
  console.log(
    `campaign ${String(index + 1).padStart(2, '0')} ${chosen.name.padEnd(18)} d${chosen.difficulty} par=${chosen.par} opt=${chosen.optimal} features=${chosen.features.join(',') || '—'} sentries=${chosen.sentries.length}`,
  )
}

const weekly = []
for (let i = 0; i < 108; i++) {
  const difficulty = 2 + (i % 9)
  let chosen = null
  for (let attempt = 0; attempt < 80 && !chosen; attempt++) {
    const candidate = generateLevel({
      seed: `weekly-pool-${i}-${attempt}`,
      difficulty,
      name: `Hafta Taşı ${i + 1}`,
      id: `weekly-pool-${i}`,
    })
    if (candidate && validate(candidate)) chosen = candidate
  }
  if (!chosen) {
    console.warn(`weekly ${i} skipped`)
    continue
  }
  chosen.difficulty = difficulty
  weekly.push(chosen)
}
console.log(`weekly pool: ${weekly.length} levels`)
const featureCounts = weekly.reduce((acc, level) => {
  for (const feature of level.features) acc[feature] = (acc[feature] || 0) + 1
  return acc
}, {})
console.log('feature counts:', featureCounts)

const header = '// Generated by scripts/build-levels.js — edit the generator, not this file.\n'
writeFileSync(
  join(outDir, 'campaign.js'),
  `${header}export const CAMPAIGN_LEVELS = ${JSON.stringify(campaign, null, 2)}\n`,
)
writeFileSync(
  join(outDir, 'weekly-pool.js'),
  `${header}export const WEEKLY_POOL = ${JSON.stringify(weekly, null, 2)}\n`,
)
console.log('wrote', join(outDir, 'campaign.js'), join(outDir, 'weekly-pool.js'))
