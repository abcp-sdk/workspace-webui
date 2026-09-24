<script lang="ts">
  // PresetsDetail — READ-ONLY view of the deployment's role presets. A
  // preset is the immutable tool whitelist bound to a session at creation
  // (role -> preset -> tools); the workspace gateway refuses UpsertPreset /
  // DeletePreset, so this page only displays them.
  import type { AppStore } from '$lib/store.svelte'
  import type { Preset } from '$lib/models'
  import { t, getLocale } from '$lib/i18n.svelte'
  import { Prefs } from '$lib/prefs'
  import { showErrorToast } from '$lib/toast.svelte'
  import { roleLabelKey, roleIcon, roleTone } from '$lib/roles'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let { store }: { store: AppStore } = $props()

  let presets = $state<Preset[]>([])
  let loading = $state(true)
  let expanded = $state<Set<string>>(new Set())

  $effect(() => {
    void load()
  })

  async function load() {
    // Cache-first: a pane SLIDE re-runs this effect but must not refetch.
    const locale = Prefs.loadAgentLocale()
    const key = `presets:${locale}`
    loading = !store.hasData(key)
    try {
      presets = await store.dataLoad(key, () => store.api.presets(locale))
    } catch (e) {
      showErrorToast(String(e))
    }
    loading = false
  }

  function toggle(id: string) {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expanded = next
  }
</script>

<div class="h-full w-full p-4">
  <p class="mb-3 text-micro text-muted-foreground">{t('presetsReadOnlyHint')}</p>
  {#if loading}
    <div class="flex justify-center py-8">
      <span class="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"></span>
    </div>
  {:else if presets.length === 0}
    <EmptyState class="text-left">{t('noPresets')}</EmptyState>
  {:else}
    <div class="space-y-2">
      {#each presets as p (p.id)}
        {@const Icon = roleIcon(p.id)}
        <div class="rounded-md border border-border bg-card px-3 py-2">
          <button
            type="button"
            class="flex w-full items-center gap-2 text-left"
            onclick={() => toggle(p.id)}
          >
            <span class={cn('flex size-7 shrink-0 items-center justify-center rounded-full', roleTone(p.id))}>
              <Icon class="size-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-body font-medium">{t(roleLabelKey(p.id))}</span>
              <span class="block truncate text-micro text-muted-foreground">{p.id}</span>
            </span>
            {#if p.isSystem}
              <span class="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">system</span>
            {/if}
            <span class="text-micro text-muted-foreground">{p.tools.length} {t('tools')}</span>
            {#if expanded.has(p.id)}<AppIcons.chevron_up class="size-4 text-muted-foreground" />{:else}<AppIcons.chevron_down class="size-4 text-muted-foreground" />{/if}
          </button>
          {#if p.systemPrompt}
            <div class="mt-1.5 line-clamp-3 text-micro text-muted-foreground">{p.systemPrompt}</div>
          {/if}
          <div class="mt-1 text-micro text-muted-foreground">{t('maxTurns')}: {p.maxTurns}</div>
          {#if expanded.has(p.id) && p.tools.length}
            <div class="mt-2 flex flex-wrap gap-1 border-t border-border/50 pt-2">
              {#each p.tools as tool (tool)}
                <span class="rounded-full border border-border px-2 py-px text-[10px] text-muted-foreground">{tool}</span>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
