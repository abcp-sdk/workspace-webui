<script lang="ts">
  // TabBar / TabItem — the canonical horizontal sub-tab strip under a header:
  // a full-width bordered bar holding underline tabs. Compose with `TabItem`.
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  let { class: className, children }: { class?: string; children?: Snippet } = $props()
</script>

<div class={cn('flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border px-1', className)}>
  {@render children?.()}
</div>
