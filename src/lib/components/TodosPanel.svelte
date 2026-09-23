<script lang="ts">
  // TodosPanel — the session's todo checklist. Rendered both in the header
  // popover and inline in a `todo-write` tool card (once its input has fully
  // streamed). Purely presentational: the caller supplies the parsed list.
  import type { Todo, TodoPriority, TodoStatus } from '$lib/todos'
  import { t } from '$lib/i18n.svelte'
  import { cn } from '$lib/utils'
  import { AppIcons } from '$lib/icons'
  import EmptyState from '$lib/components/layout/EmptyState.svelte'

  let { todos }: { todos: readonly Todo[] } = $props()

  function statusIcon(status: TodoStatus) {
    switch (status) {
      case 'completed':
        return AppIcons.success
      case 'in_progress':
        return AppIcons.spinner
      case 'cancelled':
        return AppIcons.close
      default:
        return AppIcons.circle
    }
  }

  function statusTone(status: TodoStatus): string {
    switch (status) {
      case 'completed':
        return 'text-success'
      case 'in_progress':
        return 'text-warning'
      case 'cancelled':
        return 'text-muted-foreground'
      default:
        return 'text-muted-foreground'
    }
  }

  function statusKey(status: TodoStatus): string {
    switch (status) {
      case 'completed':
        return 'todoCompleted'
      case 'in_progress':
        return 'todoInProgress'
      case 'cancelled':
        return 'todoCancelled'
      default:
        return 'todoPending'
    }
  }

  function priorityKey(p: TodoPriority): string {
    switch (p) {
      case 'high':
        return 'todoPriorityHigh'
      case 'medium':
        return 'todoPriorityMedium'
      default:
        return 'todoPriorityLow'
    }
  }

  function priorityTone(p: TodoPriority): string {
    switch (p) {
      case 'high':
        return 'bg-destructive/15 text-destructive'
      case 'medium':
        return 'bg-warning/15 text-warning'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }
</script>

{#if todos.length === 0}
  <EmptyState>{t('noTodos')}</EmptyState>
{:else}
  <ul class="min-w-0 space-y-1">
    {#each todos as todo, i (i)}
      {@const Icon = statusIcon(todo.status)}
      <li class="flex min-w-0 items-start gap-1.5">
        <Icon class={cn('mt-0.5 size-3.5 shrink-0', statusTone(todo.status))} />
        <span
          class={cn(
            'min-w-0 flex-1 text-meta wrap-anywhere',
            (todo.status === 'completed' || todo.status === 'cancelled') &&
              'text-muted-foreground line-through',
          )}
        >{todo.content}</span>
        <span
          class={cn(
            'shrink-0 rounded-full px-1.5 py-px text-[9px] leading-4',
            priorityTone(todo.priority),
          )}
          title={t(statusKey(todo.status))}
        >{t(priorityKey(todo.priority))}</span>
      </li>
    {/each}
  </ul>
{/if}
