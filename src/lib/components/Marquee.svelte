<script lang="ts">
  // Marquee — a fixed-width slot that auto-scrolls its (single-line) text from
  // left to right when the text is wider than the slot. When it fits, it is a
  // plain static line. Used for the chat header's session name so a long name
  // stays readable without overlapping the toolbar.
  import { marqueeDuration, marqueePlan } from '$lib/marquee'
  import { cn } from '$lib/utils'

  let {
    text,
    class: className = '',
  }: { text: string; class?: string } = $props()

  let slot: HTMLElement | null = $state(null)
  let content: HTMLElement | null = $state(null)
  let distance = $state(0)
  let duration = $state(1200)

  // Re-measure whenever the text or the slot width changes. The ResizeObserver
  // covers the responsive split/drawer changing the header width.
  $effect(() => {
    const s = slot
    const c = content
    void text
    if (!s || !c) return
    const measure = () => {
      const plan = marqueePlan(s.clientWidth, c.scrollWidth)
      distance = plan.distance
      duration = marqueeDuration(plan.distance)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(s)
    ro.observe(c)
    return () => ro.disconnect()
  })
</script>

<span bind:this={slot} class={cn('relative block overflow-hidden', className)}>
  <span
    bind:this={content}
    class="inline-block whitespace-nowrap will-change-transform"
    style={distance > 0
      ? `--mq-dist: -${distance}px; animation: mq-scroll ${duration}ms ease-in-out infinite alternate;`
      : ''}
  >{text}</span>
</span>
