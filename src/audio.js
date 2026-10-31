export class AudioEngine {
  constructor({ muted = false } = {}) {
    this.ctx = null
    this.master = null
    this.ambient = null
    this.muted = Boolean(muted)
    this.initialized = false
  }

  ensure() {
    if (this.initialized) {
      if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {})
      return this.ctx
    }
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Ctor) return null
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.55
    const compressor = this.ctx.createDynamicsCompressor()
    compressor.threshold.value = -18
    compressor.knee.value = 20
    compressor.ratio.value = 4
    this.master.connect(compressor)
    compressor.connect(this.ctx.destination)
    this.initialized = true
    this.startAmbient()
    return this.ctx
  }

  setMuted(muted) {
    this.muted = Boolean(muted)
    if (this.master) {
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, now, 0.08)
    }
  }

  toggle() {
    this.setMuted(!this.muted)
    return this.muted
  }

  startAmbient() {
    if (!this.ctx || this.ambient) return
    const ctx = this.ctx
    const bus = ctx.createGain()
    bus.gain.value = 0.55
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 220
    filter.Q.value = 0.7
    bus.connect(filter)
    filter.connect(this.master)

    const low = ctx.createOscillator()
    low.type = 'sine'
    low.frequency.value = 55
    const lowGain = ctx.createGain()
    lowGain.gain.value = 0.035
    low.connect(lowGain)
    lowGain.connect(bus)
    low.start()

    const high = ctx.createOscillator()
    high.type = 'triangle'
    high.frequency.value = 82.5
    const highGain = ctx.createGain()
    highGain.gain.value = 0.018
    high.connect(highGain)
    highGain.connect(bus)
    high.start()

    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.055
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 70
    lfo.connect(lfoGain)
    lfoGain.connect(filter.frequency)
    lfo.start()

    // A quiet, filtered noise bed gives the stone room some air.
    const length = ctx.sampleRate * 2
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      last = last * 0.96 + white * 0.04
      data[i] = last
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.value = 420
    noiseFilter.Q.value = 0.8
    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.02
    noise.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(bus)
    noise.start()

    this.ambient = { low, high, lfo, noise, bus, filter }
  }

  tone({ freq = 440, to = null, duration = 0.12, type = 'sine', gain = 0.1, delay = 0 }) {
    if (!this.ctx || this.muted) return
    const ctx = this.ctx
    const start = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration)
    env.gain.setValueAtTime(0.0001, start)
    env.gain.exponentialRampToValueAtTime(gain, start + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.connect(env)
    env.connect(this.master)
    osc.start(start)
    osc.stop(start + duration + 0.03)
  }

  play(name, options = {}) {
    if (!this.ctx || this.muted) return
    switch (name) {
      case 'move':
        this.tone({ freq: 210, to: 170, duration: 0.07, type: 'triangle', gain: 0.055 })
        break
      case 'bump':
        this.tone({ freq: 105, to: 70, duration: 0.09, type: 'square', gain: 0.045 })
        break
      case 'ember': {
        const chain = Math.max(0, options.chain || 0)
        const pitch = 1 + Math.min(6, chain) * 0.07
        this.tone({ freq: 660 * pitch, duration: 0.18, type: 'sine', gain: 0.085 })
        this.tone({ freq: 990 * pitch, duration: 0.24, type: 'sine', gain: 0.04, delay: 0.035 })
        this.tone({ freq: 1320 * pitch, duration: 0.16, type: 'triangle', gain: 0.025, delay: 0.06 })
        break
      }
      case 'key':
        this.tone({ freq: 880, duration: 0.12, type: 'triangle', gain: 0.06 })
        this.tone({ freq: 1320, duration: 0.2, type: 'sine', gain: 0.04, delay: 0.06 })
        break
      case 'portal':
        this.tone({ freq: 300, to: 1250, duration: 0.24, type: 'sine', gain: 0.05 })
        this.tone({ freq: 600, to: 240, duration: 0.3, type: 'triangle', gain: 0.035, delay: 0.02 })
        break
      case 'undo':
        this.tone({ freq: 330, to: 220, duration: 0.11, type: 'triangle', gain: 0.04 })
        break
      case 'death':
        this.tone({ freq: 180, to: 45, duration: 0.55, type: 'sawtooth', gain: 0.07 })
        this.tone({ freq: 90, to: 35, duration: 0.6, type: 'square', gain: 0.035, delay: 0.02 })
        break
      case 'win':
        ;[523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
          this.tone({ freq, duration: 0.3, type: 'sine', gain: 0.07, delay: index * 0.09 })
        })
        this.tone({ freq: 261.63, duration: 0.8, type: 'triangle', gain: 0.03, delay: 0.1 })
        break
      case 'click':
        this.tone({ freq: 420, to: 380, duration: 0.04, type: 'triangle', gain: 0.03 })
        break
      case 'select':
        this.tone({ freq: 520, duration: 0.06, type: 'sine', gain: 0.035 })
        break
      default:
        break
    }
  }
}
