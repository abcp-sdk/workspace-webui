<script lang="ts">
  // RepoBlob — read one repository file at a ref. A small toolbar offers the
  // file's commit HISTORY (a stack page) and toggles between the rendered
  // CONTENT and the per-line BLAME.
  import type { PageProps } from '$lib/page-props'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import RepoFilePane from '$lib/components/RepoFilePane.svelte'
  import BlameView from '$lib/components/BlameView.svelte'
  import PageHeader from '$lib/components/layout/PageHeader.svelte'
  import IconButton from '$lib/components/layout/IconButton.svelte'

  let {
    store,
    org,
    repo,
    ref,
    path,
    showBack = false,
  }: PageProps & { org: string; repo: string; ref: string; path: string } = $props()

  const name = $derived(path.split('/').pop() ?? path)
  let view = $state<'code' | 'blame'>('code')

  function openHistory() {
    store.pushChild({ kind: 'repo_history', key: `hist:${org}/${repo}@${ref}:${path}`, org, repo, ref, path })
  }
</script>
<div class="flex h-full w-full flex-col">
  <PageHeader>
    {#if showBack}<IconButton icon={AppIcons.back} onclick={() => store.popPage()} />{/if}
    <AppIcons.file_code class="size-4 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1">
      <span class="block truncate text-base font-semibold">{name}</span>
      <span class="block truncate text-[10px] text-muted-foreground">{org}/{repo} · {ref}</span>
    </span>
    <!-- Code / Blame toggle + history -->
    <div class="flex shrink-0 items-center gap-0.5 rounded-full border border-border p-0.5">
      <button
        type="button"
        class={cn('rounded-full px-2 py-0.5 text-[10px]', view === 'code' ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
        onclick={() => (view = 'code')}
      >{t('code')}</button>
      <button
        type="button"
        class={cn('rounded-full px-2 py-0.5 text-[10px]', view === 'blame' ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
        onclick={() => (view = 'blame')}
      >{t('blame')}</button>
    </div>
    <IconButton icon={AppIcons.history} label={t('fileHistory')} onclick={openHistory} />
  </PageHeader>

  <div class="min-h-0 flex-1 overflow-hidden bg-card">
    {#if view === 'code'}
      <RepoFilePane {store} {org} {repo} {ref} {path} chrome={false} />
    {:else}
      <BlameView {store} {org} {repo} {ref} {path} />
    {/if}
  </div>
</div>
