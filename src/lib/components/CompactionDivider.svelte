<script lang="ts">
  // CompactionDivider — the persisted compaction checkpoint (`role='compaction'`)
  // rendered as a CENTERED horizontal divider instead of a chat bubble: a rule
  // with a label ("History compacted · view summary") that expands to show the
  // summary text plus its metadata (reason, folded message count, estimated
  // tokens). Purely presentational.
  import type { ChatPart } from '$lib/models'
  import { t } from '$lib/i18n.svelte'
  import { renderMarkdown } from '$lib/markdown'
  import { AppIcons } from '$lib/icons'

  let { part }: { part: ChatPart } = $props()

  let open = $state(false)

  const label = $derived(
    part.compactionReason === 'overflow'
      ? t('compactedOverflow')
      : t('compactedLabel'),
  )
</script>

<div class="my-3 flex w-full flex-col items-center gap-1.5">
  <button
    type="button"
    class="flex w-full items-center gap-2 text-micro text-muted-foreground"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="h-px flex-1 bg-border"></span>
    <span class="flex items-center gap-1 whitespace-nowrap">
      {#if open}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
      <span>{label}</span>
    </span>
    <span class="h-px flex-1 bg-border"></span>
  </button>

  {#if open}
    <div class="w-full max-w-[640px] rounded-sm border border-border/50 bg-muted/40 px-3 py-2">
      <div class="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>{part.compactionReason === 'overflow' ? t('compactedAuto') : t('compactedManual')}</span>
        {#if part.foldedCount != null}
          <span>{t('compactedFolded', { n: String(part.foldedCount) })}</span>
        {/if}
        {#if part.foldedTokens != null}
          <span>{t('compactedTokens', { n: String(part.foldedTokens) })}</span>
        {/if}
      </div>
      {#if part.text}
        <div class="md-body text-meta text-muted-foreground">{@html renderMarkdown(part.text)}</div>
      {/if}
    </div>
  {/if}
</div>
