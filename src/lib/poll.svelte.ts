// usePoll — a visibility-aware interval. It runs `fn` on mount and every
// `ms`, PAUSES while the document is hidden, and refreshes immediately when
// the tab becomes visible again. The timer is cleared on unmount. This keeps
// background tabs from hammering the gateway with list polls.
export function usePoll(
  fn: () => void,
  ms: number,
  opts: { immediate?: boolean } = {},
): void {
  const immediate = opts.immediate ?? true
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = () => fn()

  const start = () => {
    if (timer !== null) return
    if (immediate) tick()
    timer = setInterval(tick, ms)
  }
  const stop = () => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  $effect(() => {
    start()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else start()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  })
}
