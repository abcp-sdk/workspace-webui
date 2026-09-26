<script lang="ts">
  // Marquee — a fixed-width slot that scrolls its (single-line) text when it is
  // wider than the slot. When it fits, it is a plain static line.
  //
  // The cycle is: hold 5s at the start → move LINEARLY to the tail at a
  // CONSTANT speed (same px/s for every label, so a longer name takes longer) →
  // hold 5s at the tail → jump back to the start and repeat. Driven by the Web
  // Animations API because the move duration varies with the distance, so a
  // static CSS keyframe cannot express it.
  import { marqueeCycle, marqueePlan } from '$lib/marquee'
  import { cn } from '$lib/utils'

  let {
    text,
    class: className = '',
  }: { text: string; class?: string } = $props()

  let slot: HTMLElement | null = $state(null)
  let content: HTMLElement | null = $state(null)

  // Re-measure whenever the text or the slot width changes. The ResizeObserver
  // covers the responsive split/drawer changing the header width.
  $effect(() => {
    const s = slot
    const c = content
    void text
    if (!s || !c) return
    let anim: Animation | null = null

    const measure = () => {
      anim?.cancel()
      anim = null
      const plan = marqueePlan(s.clientWidth, c.scrollWidth)
      if (!plan.scroll) return
      const cyc = marqueeCycle(plan.distance)
      anim = c.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: cyc.startHoldPct },
          { transform: `translateX(-${plan.distance}px)`, offset: cyc.tailPct },
          { transform: `translateX(-${plan.distance}px)`, offset: 1 },
        ],
        { duration: cyc.totalMs, iterations: Number.POSITIVE_INFINITY, easing: 'linear' },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(s)
    ro.observe(c)
    return () => {
      ro.disconnect()
      anim?.cancel()
    }
  })
</script>

<span bind:this={slot} class={cn('relative block overflow-hidden', className)}>
  <span bind:this={content} class="inline-block whitespace-nowrap will-change-transform">{text}</span>
</span>
