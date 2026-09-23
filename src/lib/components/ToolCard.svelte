<script lang="ts">
  // ToolCard — renders a `CardSpec` from $lib/tool-cards: labelled parameter
  // fields (optionally clickable → Code/Service tabs), an optional list body
  // (diff / commits / files / ports / …), and primary action buttons.
  import type { CardSpec, CardField, CardBody } from '$lib/tool-cards'
  import type { AppStore } from '$lib/store.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import DiffView from './DiffView.svelte'

  let { card, store }: { card: CardSpec; store?: AppStore } = $props()

  function icon(name: string) {
    return AppIcons[name as keyof typeof AppIcons] ?? AppIcons.tools
  }
  function toneClass(t: CardField['tone']): string {
    switch (t) {
      case 'success': return 'text-success'
      case 'destructive': return 'text-destructive'
      case 'muted': return 'text-muted-foreground'
      default: return ''
    }
  }
  function short(sha: string): string {
    return sha.length > 8 ? sha.slice(0, 8) : sha
  }
</script>

<div class="min-w-0 space-y-1.5 rounded-sm border border-border/50 bg-background/50 p-2">
  <!-- parameter fields -->
  {#each card.fields as f, i (i)}
    {@const Icon = icon(f.icon)}
    {#if f.link && store}
      <button
        type="button"
        class="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-micro hover:bg-muted"
        title={f.value}
        onclick={() => store?.openCodePage(f.link!)}
      >
        <Icon class="size-[13px] shrink-0 text-primary" />
        <span class="shrink-0 text-muted-foreground">{f.label}</span>
        <span class={cn('min-w-0 flex-1 truncate text-right', f.mono && 'font-mono', toneClass(f.tone))}>{f.value}</span>
      </button>
    {:else}
      <div class="flex min-w-0 items-center gap-1.5 px-1 py-0.5 text-micro" title={f.value}>
        <Icon class="size-[13px] shrink-0 text-primary" />
        <span class="shrink-0 text-muted-foreground">{f.label}</span>
        <span class={cn('min-w-0 flex-1 truncate text-right', f.mono && 'font-mono', toneClass(f.tone))}>{f.value}</span>
      </div>
    {/if}
  {/each}

  <!-- body -->
  {#if card.body}
    {@const b: CardBody = card.body}
    {#if b.kind === 'diff'}
      <div class="max-h-72 min-w-0 overflow-auto rounded-sm bg-card">
        <DiffView diff={b.diff} />
      </div>
    {:else if b.kind === 'commits'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.commits.slice(0, 20) as c (c.sha)}
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-1 text-left text-micro last:border-b-0 hover:bg-muted"
            onclick={() => store?.openCodePage({ kind: 'repo_commit', key: `commit:${b.org}/${b.repo}@${c.sha}`, org: b.org, repo: b.repo, ref: b.ref, sha: c.sha })}
          >
            <AppIcons.commit class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{c.message.split('\n')[0]}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{short(c.sha)}</span>
          </button>
        {/each}
      </div>
    {:else if b.kind === 'entries'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.entries.slice(0, 60) as e (e.path)}
          <div class="flex min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-0.5 text-micro last:border-b-0">
            {#if e.type === 'dir'}<AppIcons.folder class="size-3.5 shrink-0 text-primary" />{:else}<AppIcons.file class="size-3.5 shrink-0 text-muted-foreground" />{/if}
            <span class="min-w-0 flex-1 truncate font-mono">{e.path}</span>
            {#if e.type !== 'dir'}<span class="shrink-0 text-[10px] text-muted-foreground">{e.size}B</span>{/if}
          </div>
        {/each}
      </div>
    {:else if b.kind === 'files'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.files.slice(0, 60) as f (f.path)}
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-0.5 text-left text-micro last:border-b-0 hover:bg-muted"
            onclick={() => store?.openCodePage({ kind: 'repo_blob', key: `blob:${b.org}/${b.repo}@${b.ref}:${f.path}`, org: b.org, repo: b.repo, ref: b.ref, path: f.path })}
          >
            <span class="shrink-0 text-[10px] text-muted-foreground">{f.status}</span>
            <span class="min-w-0 flex-1 truncate font-mono">{f.path}</span>
            <span class="shrink-0 font-mono text-success">+{f.additions}</span>
            <span class="shrink-0 font-mono text-destructive">-{f.deletions}</span>
          </button>
        {/each}
      </div>
    {:else if b.kind === 'paths'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.paths.slice(0, 60) as p (p)}
          <div class="min-w-0 truncate border-b border-border/30 px-1.5 py-0.5 font-mono text-micro last:border-b-0">{p}</div>
        {/each}
      </div>
    {:else if b.kind === 'branches'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.branches.slice(0, 40) as br (br.name)}
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-0.5 text-left text-micro last:border-b-0 hover:bg-muted"
            onclick={() => store?.openCodePage({ kind: 'repo_detail', key: `repo:${b.org}/${b.repo}@${br.name}`, org: b.org, repo: b.repo, ref: br.name })}
          >
            <AppIcons.branch class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate font-mono">{br.name}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{short(br.sha)}</span>
          </button>
        {/each}
      </div>
    {:else if b.kind === 'tags'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.tags.slice(0, 40) as t (t.name)}
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-0.5 text-left text-micro last:border-b-0 hover:bg-muted"
            onclick={() => store?.openCodePage({ kind: 'repo_tag', key: `tag:${b.org}/${b.repo}@${t.name}`, org: b.org, repo: b.repo, ref: t.name })}
          >
            <AppIcons.tag class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate font-mono">{t.name}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{short(t.sha)}</span>
          </button>
        {/each}
      </div>
    {:else if b.kind === 'pulls'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.pulls.slice(0, 40) as p (p.index)}
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-0.5 text-left text-micro last:border-b-0 hover:bg-muted"
            onclick={() => store?.openCodePage({ kind: 'repo_mr', key: `mr:${b.org}/${b.repo}:${p.index}`, org: b.org, repo: b.repo, index: p.index })}
          >
            <AppIcons.merge class={cn('size-3.5 shrink-0', p.merged ? 'text-violet-500' : p.state === 'open' ? 'text-success' : 'text-muted-foreground')} />
            <span class="min-w-0 flex-1 truncate">#{p.index} {p.title}</span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{p.head}→{p.base}</span>
          </button>
        {/each}
      </div>
    {:else if b.kind === 'conflicts'}
      <div class="min-w-0 rounded-sm border border-destructive/40 bg-destructive/5 p-1.5">
        {#each b.conflicts as c (c)}
          <div class="min-w-0 truncate font-mono text-micro text-destructive">{c}</div>
        {/each}
      </div>
    {:else if b.kind === 'ports'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.ports as p, i (i)}
          <div class="flex min-w-0 items-center gap-1.5 border-b border-border/30 px-1.5 py-0.5 text-micro last:border-b-0">
            <AppIcons.server class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate font-mono">{p.protocol}:{p.port}→{p.targetPort}{p.name ? ` (${p.name})` : ''}</span>
            {#if p.publicUrl}<span class="shrink-0 truncate text-[10px] text-primary">{p.publicUrl}</span>{/if}
          </div>
        {/each}
      </div>
    {:else if b.kind === 'images'}
      <div class="min-w-0 rounded-sm border border-border/40">
        {#each b.images.slice(0, 60) as im (im.owner + im.name + im.tag)}
          <div class="min-w-0 truncate border-b border-border/30 px-1.5 py-0.5 font-mono text-micro last:border-b-0">{im.owner}/{im.name}:{im.tag}</div>
        {/each}
      </div>
    {:else if b.kind === 'text'}
      <pre class={cn('max-h-52 min-w-0 overflow-auto rounded-sm bg-muted/40 p-1.5 font-mono text-[11px] whitespace-pre-wrap', b.tone === 'destructive' && 'text-destructive')}>{b.text}</pre>
    {/if}
  {/if}

  <!-- actions -->
  {#if card.actions?.length && store}
    <div class="flex flex-wrap gap-1">
      {#each card.actions as a, i (i)}
        {@const Icon = icon(a.icon)}
        <button
          type="button"
          class="flex min-w-0 max-w-full items-center gap-1 rounded border border-primary/40 bg-primary/8 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/15"
          title={a.label}
          onclick={() => store?.openCodePage(a.page)}
        >
          <Icon class="size-3 shrink-0" />
          <span class="min-w-0 truncate font-mono">{a.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
