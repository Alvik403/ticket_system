export function keepScreenAwake() {
  let sentinel: WakeLockSentinel | null = null
  let stopped = false

  async function request() {
    if (stopped || document.visibilityState !== 'visible') return
    if (!('wakeLock' in navigator)) return
    try {
      const next = await navigator.wakeLock.request('screen')
      if (stopped) {
        await next.release()
        return
      }
      sentinel = next
      sentinel.addEventListener('release', () => {
        sentinel = null
        if (!stopped && document.visibilityState === 'visible') void request()
      })
    } catch {
      // The browser refused the lock (insecure http, or a policy).
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void request()
  })
  void request()
  const timer = window.setInterval(() => {
    if (!sentinel) void request()
  }, 20_000)

  return () => {
    stopped = true
    window.clearInterval(timer)
    void sentinel?.release()
  }
}
