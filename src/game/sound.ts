let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function beep(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.15, delay = 0) {
  const audioCtx = getCtx()
  const startAt = audioCtx.currentTime + delay
  const osc = audioCtx.createOscillator()
  const g = audioCtx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.value = gain
  osc.connect(g)
  g.connect(audioCtx.destination)
  osc.start(startAt)
  g.gain.setValueAtTime(gain, startAt)
  g.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
  osc.stop(startAt + duration)
}

export function playPass() {
  beep(560, 0.08, 'triangle', 0.12)
}

export function playShoot() {
  beep(200, 0.18, 'sawtooth', 0.2)
}

export function playGoal() {
  ;[523, 659, 784, 1046].forEach((f, i) => beep(f, 0.22, 'square', 0.16, i * 0.09))
}

export function playWhistle() {
  beep(1900, 0.3, 'square', 0.1)
}

export function playTurnover() {
  beep(140, 0.25, 'sawtooth', 0.15)
}

export function playCatch() {
  beep(700, 0.05, 'sine', 0.08)
}
