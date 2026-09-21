<script lang="ts">
  // SessionRepoRow — the collapsible repo header above its branch sessions.
  // Repurposes the original webui's subsession-tree affordance: a repo row
  // expands to its maintainer + developer branch sessions.
  import { t } from '$lib/i18n.svelte'
  import { AppIcons } from '$lib/icons'
  import { cn } from '$lib/utils'

  let {
    repoKey,
    count,
    expanded,
    onToggle,
  }: {
    repoKey: string
    count: number
    expanded: boolean
    onToggle: () => void
  } = $props()
</script>

<button
  type="button"
  class="flex w-full items-center gap-2 bg-muted/40 px-3 py-1.5 text-left hover:bg-muted/60"
  onclick={onToggle}
>
  {#if expanded}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
  <AppIcons.folder class={cn('size-4 shrink-0', expanded ? 'text-primary' : 'text-muted-foreground')} />
  <span class="min-w-0 flex-1 truncate text-meta font-semibold">{repoKey}</span>
  <span class="shrink-0 rounded-full bg-muted-foreground/14 px-1.5 py-px text-[10px] leading-none text-muted-foreground">{count}</span>
</button>
