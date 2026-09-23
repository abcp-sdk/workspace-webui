// Shared page prop bag handed to every routed page by the Shell.

import type { BackendCfg } from './models'
import type { ThemeMode } from './prefs'
import type { AppStore } from './store.svelte'

export interface PageProps {
  store: AppStore
  themeMode: ThemeMode
  onThemeMode: (v: ThemeMode) => void
  onSwitchBackend?: (() => void) | null
  onBackendSwitched?: ((b: BackendCfg) => void) | null
  onUiLocale?: ((l: 'system' | 'zh' | 'en') => void) | null
  /** Clears the active connection and lands on the setup form so the user can
   *  sign in as someone else (Flutter's `onAddUser`). */
  onAddUser?: (() => void) | null
  showBack?: boolean
  initialId?: string
  overlay?: 'mailbox'
  modelId?: string | null
  /** Service tab drill-in param (sandbox name). */
  name?: string
  /** Service tab job drill-in param (job id). */
  jobId?: string
  /** Code tab drill-in params (repo detail / blob / history / commit). */
  org?: string
  repo?: string
  ref?: string
  path?: string
  /** Commit sha (repo_commit / repo_history_diff). */
  sha?: string
  /** Change-request index (repo_mr). */
  index?: number
  /** Release tag (repo_release). */
  tag?: string
  /** Compare refs (repo_compare). */
  base?: string
  head?: string
  /** Repo browser sub-tab (repo_detail / repo_tag / code_root), from `?tab=`. */
  tab?: 'files' | 'commits' | 'tags' | 'releases' | 'changes'
  /** MR list filter (repo_detail / code_root), from `?state=`. */
  mrState?: string
  /** repo_blob view mode, from `?view=`. */
  view?: 'code' | 'blame'
  /** Service log source, from `?logs=`. */
  logs?: 'follow' | 'tail'
  /** Service log "previous instance" flag, from `?prev=1`. */
  prev?: boolean
}
