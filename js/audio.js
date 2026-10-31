/* Tiny WebAudio synth — no audio files, no network. */

let context = null
let master = null
let muted = false

const MUTE_KEY = 'prisma.muted.v1'

try {
  muted = localStorage.getItem(MUTE_KEY) === '1'
} catch {}

function ensure() {
  if (muted) return null
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return null
    context = new AudioContext()
    master = context.createGain()
    master.gain.value = 0.22
    master.connect(context.destination)
  }
  if (context.state === 'suspended') context.resume().catch(() => {})
  return context
}

function tone({ freq = 440, endFreq = freq, type = 'sine', gain = 0.2, duration = 0.15, delay = 0, attack = 0.008 }) {
  const ctx = ensure()
  if (!ctx) return
  const start = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), start + duration)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + attack)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp)
  amp.connect(master)
  osc.start(start)
  osc.stop(start + duration + 0.03)
}

export const audio = {
  unlock() {
    ensure()
  },
  get muted() {
    return muted
  },
  setMuted(value) {
    muted = Boolean(value)
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {}
    if (muted && master) master.gain.value = 0
    else if (master) master.gain.value = 0.22
  },
  toggle() {
    this.setMuted(!muted)
    if (!muted) this.click()
    return muted
  },
  click() {
    tone({ freq: 720, endFreq: 980, type: 'triangle', gain: 0.08, duration: 0.07 })
  },
  rotate() {
    tone({ freq: 190, endFreq: 330, type: 'triangle', gain: 0.13, duration: 0.11 })
    tone({ freq: 760, endFreq: 620, type: 'sine', gain: 0.035, duration: 0.06, delay: 0.01 })
  },
  crystal(index = 0) {
    const base = 523 * Math.pow(2, index / 12)
    tone({ freq: base, endFreq: base * 1.5, type: 'sine', gain: 0.12, duration: 0.34 })
    tone({ freq: base * 2, endFreq: base * 2.4, type: 'triangle', gain: 0.04, duration: 0.22, delay: 0.02 })
  },
  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]
    notes.forEach((freq, i) => {
      tone({ freq, endFreq: freq * 1.02, type: 'sine', gain: 0.11, duration: 0.48, delay: i * 0.075 })
      tone({ freq: freq / 2, endFreq: freq / 2, type: 'triangle', gain: 0.035, duration: 0.42, delay: i * 0.075 })
    })
  },
  reset() {
    tone({ freq: 170, endFreq: 92, type: 'sawtooth', gain: 0.075, duration: 0.22 })
  },
  hint() {
    tone({ freq: 880, endFreq: 1180, type: 'sine', gain: 0.07, duration: 0.14 })
    tone({ freq: 1320, endFreq: 1320, type: 'sine', gain: 0.035, duration: 0.18, delay: 0.08 })
  },
  submit() {
    tone({ freq: 392, endFreq: 523, type: 'triangle', gain: 0.09, duration: 0.26 })
    tone({ freq: 659, endFreq: 784, type: 'sine', gain: 0.06, duration: 0.3, delay: 0.1 })
  },
  error() {
    tone({ freq: 150, endFreq: 120, type: 'square', gain: 0.05, duration: 0.12 })
  },
}
