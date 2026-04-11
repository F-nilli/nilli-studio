let lastPlayed = 0
const THROTTLE_MS = 3000

export function playCoinSound() {
  if (document.hidden) return
  const now = Date.now()
  if (now - lastPlayed < THROTTLE_MS) return
  lastPlayed = now

  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

    // Short ascending two-tone coin sound
    const t = ctx.currentTime

    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.frequency.setValueAtTime(880, t)
    osc1.frequency.exponentialRampToValueAtTime(1320, t + 0.06)
    gain1.gain.setValueAtTime(0.18, t)
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
    osc1.start(t)
    osc1.stop(t + 0.18)

    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.frequency.setValueAtTime(1320, t + 0.07)
    osc2.frequency.exponentialRampToValueAtTime(1760, t + 0.13)
    gain2.gain.setValueAtTime(0.12, t + 0.07)
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    osc2.start(t + 0.07)
    osc2.stop(t + 0.22)

    setTimeout(() => ctx.close(), 500)
  } catch {
    // Audio not supported, silently fail
  }
}
