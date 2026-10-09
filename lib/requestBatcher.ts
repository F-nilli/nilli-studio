// Collapse event bursts and serialize reads. Events during a read cause one
// trailing read so a response captured before a mutation cannot leave stale data.
export function createRequestBatcher({
  run,
  delay = 200,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = (error: unknown) => console.error('[notification refresh]', error),
}: {
  run: () => Promise<unknown>
  delay?: number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
  onError?: (error: unknown) => void
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let dirty = false
  let disposed = false

  const schedule = () => {
    if (disposed) return
    dirty = true
    if (running || timer !== undefined) return
    timer = setTimer(async () => {
      timer = undefined
      if (disposed) return
      dirty = false
      running = true
      try {
        await run()
      } catch (error) {
        onError(error)
      } finally {
        running = false
        if (dirty && !disposed) schedule()
      }
    }, delay)
  }

  return {
    schedule,
    dispose() {
      disposed = true
      dirty = false
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
    },
  }
}
