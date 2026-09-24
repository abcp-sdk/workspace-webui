<script lang="ts">
  // ChatInfoDialog — the read-only session-info sheet (model/variant/preset/
  // locale) with an edit affordance that hands off to the settings dialog.
  // A session may own SEVERAL sandboxes; all of them are listed.
  import { t } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { AppIcons } from '$lib/icons'
  import { Dialog } from '$lib/components/ui/dialog'
  import type { Session } from '$lib/models'
  import type { SandboxRef } from '$lib/api'

  let {
    open = $bindable(false),
    session,
    role = '',
    sandboxes = [],
    onEdit,
  }: {
    open: boolean
    session: Session | null
    /** Workspace role label key ('' when not a workspace session). */
    role?: string
    /** Every sandbox the session owns (representative first). */
    sandboxes?: SandboxRef[]
    /** "Edit": close this sheet and open the settings dialog. */
    onEdit: () => void
  } = $props()
</script>

<Dialog bind:open title={t('sessionInfo')}>
  {#snippet children()}
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <AppIcons.chat class="size-4 text-primary" />
        <span class="truncate text-meta font-bold">{session?.id}</span>
      </div>
      {#each [
        [t('modelLabel'), session?.model || t('none')],
        [t('variantLabel'), session?.variant || t('variantNone')],
        [t('presetLabel'), session?.preset || t('none')],
        [t('role'), role || t('none')],
        [t('agentLocale'), session?.locale || Prefs.loadAgentLocale()],
      ] as [label, value] (label)}
        <div class="flex items-start gap-3 border-t border-border/40 pt-2 first:border-t-0 first:pt-0">
          <span class="w-24 shrink-0 text-micro text-muted-foreground">{label}</span>
          <span class="min-w-0 flex-1 text-meta font-semibold">{value}</span>
        </div>
      {/each}
      {#if sandboxes.length}
        <div class="flex items-start gap-3 border-t border-border/40 pt-2">
          <span class="w-24 shrink-0 text-micro text-muted-foreground">{t('sandboxes')}</span>
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            {#each sandboxes as s (s.name)}
              <span class="flex min-w-0 items-center gap-1.5 text-meta">
                <AppIcons.box class="size-3.5 shrink-0 text-primary" />
                <span class="min-w-0 flex-1 truncate font-mono">{s.name}</span>
                <span class="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{s.phase || t('none')}</span>
              </span>
            {/each}
          </span>
        </div>
      {/if}
    </div>
  {/snippet}
  {#snippet footer()}
    <button type="button" class="rounded-md px-3 py-1.5 text-sm hover:bg-muted" onclick={() => (open = false)}>{t('close')}</button>
    <button
      type="button"
      class="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/80"
      onclick={() => {
        open = false
        onEdit()
      }}
    >{t('edit')}</button>
  {/snippet}
</Dialog>
