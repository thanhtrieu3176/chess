/** Âm thanh đi quân / ăn quân, tổng hợp bằng WebAudio (không cần file âm thanh). */
let ctx: AudioContext | null = null
let enabled = true

export function setSoundEnabled(on: boolean): void {
  enabled = on
}

function tone(freq: number, duration: number, gain: number, type: OscillatorType = 'triangle'): void {
  if (!enabled) return
  try {
    ctx ??= new AudioContext()
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(gain, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration)
    osc.connect(g).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  } catch {
    // trình duyệt chặn audio → bỏ qua
  }
}

export function playMoveSound(san: string): void {
  if (san.includes('#')) {
    tone(520, 0.12, 0.25)
    setTimeout(() => tone(390, 0.25, 0.25), 110)
  } else if (san.includes('x')) tone(240, 0.12, 0.35, 'square')
  else if (san.includes('+')) tone(660, 0.1, 0.2)
  else tone(420, 0.06, 0.25)
}

export function playErrorSound(): void {
  tone(150, 0.2, 0.25, 'sawtooth')
}
