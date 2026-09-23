<script lang="ts">
  // ToolPartView — a foldable tool card. Once a call's arguments have fully
  // streamed, a tool with a registered card (see $lib/tool-cards) renders a
  // PRETTY view (fields + body + actions) instead of raw JSON; a toggle
  // switches between the pretty render and the raw JSON. Tools without a card,
  // and calls still streaming, fall back to the raw JSON + output sections.
  import type { ChatPart, ToolState } from '$lib/models'
  import type { AgentApi } from '$lib/api'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import MediaAttachment from './MediaAttachment.svelte'
  import TodosPanel from './TodosPanel.svelte'
  import ToolCard from './ToolCard.svelte'
  import { isTodoWrite, parseTodos } from '$lib/todos'
  import { cardFor } from '$lib/tool-cards'
  import type { FileRef } from '$lib/models'
  import type { AppStore } from '$lib/store.svelte'

  let {
    part,
    isStreaming = false,
    api,
    store,
  }: {
    part: ChatPart
    isStreaming?: boolean
    api: AgentApi
    store?: AppStore
  } = $props()

  let open = $state(true)
  let inputOpen = $state(true)
  let contentOpen = $state(true)
  let metaOpen = $state(true)
  // Pretty (structured card) vs raw JSON for the input section.
  let pretty = $state(true)

  const toolState: ToolState | null = $derived(part.state ?? null)
  const tool = $derived(part.tool)
  const status = $derived(toolState?.status ?? 'complete')
  const hasError = $derived(status === 'error')
  const running = $derived(isStreaming && status === 'running')
  const input = $derived((toolState?.input ?? {}) as Record<string, unknown>)

  const output = $derived(toolState?.output ?? '')
  const meta = $derived((toolState?.data ?? {}) as Record<string, unknown>)

  // A `todo-write` card renders the checklist instead of raw JSON once its
  // arguments have fully streamed (state.input is present); while streaming
  // (only inputText) the raw preview below is used.
  const todoList = $derived(isTodoWrite(tool) ? parseTodos(input) : null)

  // The registered card spec (null = no pretty view; raw JSON only).
  const card = $derived(
    !running && Object.keys(input).length > 0 ? cardFor(tool, meta, input, output) : null,
  )
  const hasPretty = $derived(card !== null || todoList !== null)

  interface MediaRef {
    code: string
    mime?: string | null
    name?: string | null
  }
  // First-class produced-file refs from `data.files` (the unified key), with
  // the server-derived media metadata when present.
  const fileRefs = $derived.by<FileRef[]>(() => {
    const out: FileRef[] = []
    const collect = (v: unknown) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>
        const code = o['code']
        if (typeof code === 'string' && code) {
          out.push({
            code,
            mime: (o['mime'] as string) ?? null,
            name: (o['name'] as string) ?? null,
            size: o['size'] != null ? Number(o['size']) : null,
            width: o['width'] != null ? Number(o['width']) : null,
            height: o['height'] != null ? Number(o['height']) : null,
            durationMs:
              o['duration_ms'] != null
                ? Number(o['duration_ms'])
                : o['durationMs'] != null
                  ? Number(o['durationMs'])
                  : null,
            thumbCode:
              (o['thumb_code'] as string) ??
              (o['thumbCode'] as string) ??
              null,
            thumbhash: (o['thumbhash'] as string) ?? null,
          })
        }
      }
    }
    const files = meta['files']
    if (Array.isArray(files)) files.forEach(collect)
    else collect(files)
    return out
  })

  const changeId = $derived((toolState?.changeId as string | undefined) ?? ((toolState?.data?.['change_id'] as string | undefined) ?? ''))
  const diffText = $derived((toolState?.diff as string | undefined) ?? ((toolState?.data?.['diff'] as string | undefined) ?? ''))
  const additions = $derived((toolState?.additions as number | undefined) ?? 0)
  const deletions = $derived((toolState?.deletions as number | undefined) ?? 0)
  const hasMeta = $derived(!!changeId || !!diffText || additions > 0 || deletions > 0)

  /** flutter `toolDisplayName`: `todowrite` shows as `todo`. */
  function toolDisplayName(name: string): string {
    return isTodoWrite(name) ? 'todo' : name
  }

  function prettyJson(o: unknown): string {
    try {
      return JSON.stringify(o, null, 2)
    } catch {
      return String(o)
    }
  }

  const subtitle = $derived(card?.subtitle ?? toolState?.title ?? '')
</script>

<div
  class={cn(
    'min-w-0 max-w-full rounded-sm text-meta',
    hasError ? 'bg-destructive/5' : 'bg-muted/35',
  )}
>
  <!-- header: status icon → tool glyph → name → subtitle → chevron -->
  <button
    type="button"
    class="flex w-full items-center gap-1 px-2 py-1 text-left"
    onclick={() => (open = !open)}
  >
    {#if running}
      <AppIcons.more class="size-3.5 shrink-0 text-warning" />
    {:else if hasError}
      <AppIcons.error class="size-3.5 shrink-0 text-destructive" />
    {:else}
      <AppIcons.success class="size-3.5 shrink-0 text-success" />
    {/if}
    <AppIcons.tools class="size-3.5 shrink-0 text-primary" />
    <span class="min-w-0 shrink-0 truncate font-semibold text-muted-foreground">{toolDisplayName(tool || toolState?.title || 'tool')}</span>
    {#if subtitle}
      <span class="min-w-0 flex-1 truncate text-micro text-muted-foreground italic">{subtitle}</span>
    {:else}
      <span class="flex-1"></span>
    {/if}
    {#if open}<AppIcons.chevron_down class="size-3.5 shrink-0 text-muted-foreground" />{:else}<AppIcons.chevron_right class="size-3.5 shrink-0 text-muted-foreground" />{/if}
  </button>

  {#if open}
    <div class="min-w-0 space-y-2 px-2.5 pb-2.5">
      <!-- params section: pretty card / todo checklist / raw JSON -->
      {#if todoList !== null && pretty}
        <div class="min-w-0 rounded-sm border border-border/50 bg-background/50 p-2">
          <TodosPanel todos={todoList} />
        </div>
      {:else if card !== null && pretty}
        <ToolCard {card} {store} />
      {:else if Object.keys(input).length}
        <div class="min-w-0 rounded-sm border border-border/50 bg-background/50">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (inputOpen = !inputOpen)}
          >
            {#if inputOpen}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
            <AppIcons.braces class="size-[13px] text-primary" />
            <span>{t('toolInputParams')}</span>
          </button>
          {#if inputOpen}
            <pre class="max-h-52 min-w-0 overflow-auto px-2 pb-2 font-mono text-[11px] wrap-anywhere whitespace-pre-wrap">{prettyJson(input)}</pre>
          {/if}
        </div>
      {:else if toolState?.inputText}
        <!-- Arguments still streaming (tool-input-delta): raw JSON preview. -->
        <div class="min-w-0 rounded-sm border border-border/50 bg-background/50">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (inputOpen = !inputOpen)}
          >
            {#if inputOpen}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
            <AppIcons.braces class="size-[13px] text-primary" />
            <span>{t('toolInputParams')}</span>
          </button>
          {#if inputOpen}
            <pre class="max-h-52 min-w-0 overflow-auto px-2 pb-2 font-mono text-[11px] wrap-anywhere whitespace-pre-wrap">{toolState.inputText}</pre>
          {/if}
        </div>
      {/if}

      <!-- pretty / raw JSON toggle (only when a pretty view exists) -->
      {#if hasPretty}
        <div class="flex items-center justify-end">
          <div class="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            <button
              type="button"
              class={cn('rounded-full px-2 py-0.5 text-[10px]', pretty ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
              title={t('prettyView')}
              onclick={() => (pretty = true)}
            >{t('prettyView')}</button>
            <button
              type="button"
              class={cn('rounded-full px-2 py-0.5 text-[10px]', !pretty ? 'bg-primary/15 text-primary' : 'text-muted-foreground')}
              title={t('rawJson')}
              onclick={() => (pretty = false)}
            >{t('rawJson')}</button>
          </div>
        </div>
      {/if}

      <!-- content section -->
      {#if hasError}
        <div class="min-w-0 rounded-sm border border-destructive/40 bg-background/50">
          <button type="button" class="flex w-full items-center gap-1 px-2 py-1 text-micro text-destructive">
            <AppIcons.chevron_down class="size-3.5" />
            <AppIcons.error class="size-[13px]" />
            <span>{t('error')}</span>
          </button>
          <pre class="max-h-52 min-w-0 overflow-auto px-2 pb-2 font-mono text-[11px] wrap-anywhere whitespace-pre-wrap text-destructive">{toolState?.error}</pre>
        </div>
      {/if}

      <div class="min-w-0 rounded-sm border border-border/50 bg-background/50">
        <button
          type="button"
          class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
          onclick={() => (contentOpen = !contentOpen)}
        >
          {#if contentOpen}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
          <AppIcons.file class="size-[13px] text-primary" />
          <span>{t('toolContent')}</span>
        </button>
        {#if contentOpen}
          <div class="px-2 pb-2">
            {#if running}
              <p class="text-micro text-muted-foreground italic">{t('running')}</p>
            {:else if output}
              <pre class="max-h-72 min-w-0 overflow-auto font-mono text-[11px] wrap-anywhere whitespace-pre-wrap">{output}</pre>
            {/if}
          </div>
        {/if}
      </div>

      <!-- produced files (first-class cards, `data.files`) -->
      {#if fileRefs.length}
        <div class="flex flex-wrap gap-2">
          {#each fileRefs as f (f.code)}
            <MediaAttachment {api} file={f} siblings={fileRefs} />
          {/each}
        </div>
      {/if}

      <!-- metadata section -->
      {#if hasMeta}
        <div class="min-w-0 rounded-sm border border-border/50 bg-background/50">
          <button
            type="button"
            class="flex w-full items-center gap-1 px-2 py-1 text-micro text-muted-foreground"
            onclick={() => (metaOpen = !metaOpen)}
          >
            {#if metaOpen}<AppIcons.chevron_down class="size-3.5" />{:else}<AppIcons.chevron_right class="size-3.5" />{/if}
            <AppIcons.info class="size-[13px] text-primary" />
            <span>{t('metadata')}</span>
          </button>
          {#if metaOpen}
            <div class="min-w-0 px-2 pb-2">
              {#if changeId}
                <div class="flex items-center gap-1 pb-1 text-micro">
                  <AppIcons.commit class="size-[13px] text-primary" />
                  <span class="text-muted-foreground">change_id</span>
                  <span class="min-w-0 truncate font-mono text-primary">{changeId}</span>
                </div>
              {/if}
              {#if (additions ?? 0) > 0 || (deletions ?? 0) > 0}
                <div class="flex items-center gap-1 pb-1 text-micro">
                  <AppIcons.diff class="size-[13px] {deletions ? 'text-destructive' : 'text-success'}" />
                  <span class="text-muted-foreground">diff</span>
                  <span class="font-mono {deletions ? 'text-destructive' : 'text-success'}">+{additions ?? 0} -{deletions ?? 0}</span>
                </div>
              {/if}
              {#if diffText}
                <div class="max-h-52 min-w-0 overflow-auto rounded-sm bg-muted/40 p-1 font-mono text-[11px] wrap-anywhere whitespace-pre-wrap">{diffText}</div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
