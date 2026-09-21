<script lang="ts">
  // ListRow — the canonical full-width clickable row (chat-list metrics:
  // px-3 / py-2, full-area hover). Renders a <button> when `onclick` is given,
  // otherwise a plain <div>. Use `divided` for dense grouped lists and
  // `align="start"` for multi-line rows (icon stays top-aligned).
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    onclick = null,
    divided = false,
    align = 'center',
    active = false,
    class: className,
    children,
  }: {
    onclick?: (() => void) | null
    divided?: boolean
    align?: 'center' | 'start'
    active?: boolean
    class?: string
    children?: Snippet
  } = $props()

  const base = $derived(
    cn(
      'flex w-full gap-3 px-3 py-2 text-left hover:bg-muted/50',
      align === 'start' ? 'items-start' : 'items-center',
      divided && 'border-b border-border/40',
      active && 'bg-primary/10',
      className,
    ),
  )
</script>

{#if onclick}
  <button type="button" class={base} {onclick}>{@render children?.()}</button>
{:else}
  <div class={base}>{@render children?.()}</div>
{/if}
