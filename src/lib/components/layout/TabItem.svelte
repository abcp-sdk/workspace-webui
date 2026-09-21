<script lang="ts">
  // TabItem — one tab in a <TabBar>. A 2px bottom underline marks the active
  // tab; inactive tabs are muted with a hover affordance.
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let {
    active = false,
    onclick,
    class: className,
    children,
  }: { active?: boolean; onclick?: () => void; class?: string; children?: Snippet } = $props()
</script>

<button
  type="button"
  class={cn(
    'flex items-center gap-1 border-b-2 px-3 py-2 text-meta whitespace-nowrap',
    active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
    className,
  )}
  onclick={onclick}
>
  {@render children?.()}
</button>
