// Router glue — binds the AppStore's visible leaf to the browser URL.
//
// The URL is the source of truth: on boot / popstate we decode it into a leaf
// and hydrate the store; when the leaf changes we mirror it back with
// pushState/replaceState. There is NO history.state snapshot — a refresh or a
// deep link reconstructs the exact same stack via the canonical ancestry in
// nav.ts (`stackFor`). Back/forward tracking uses an in-memory URL list, not
// history state.

import { decodeRoute, encodeRoute } from './route'
import type { AppStore } from './store.svelte'

function currentUrl(): string {
  return location.pathname + location.search
}

/**
 * Install the router on a store. Returns a disposer. Must be called in the
 * browser after the store exists (App.svelte, `phase === 'app'`).
 */
export function installRouter(store: AppStore): () => void {
  // The URLs we have visited in this app session, plus our position in it. Lets
  // an in-app "back" consume a real history entry (so the browser Forward
  // button stays meaningful) without stashing anything in history.state.
  let urls: string[] = [currentUrl()]
  let pos = 0

  // ---- boot: decode the initial URL, then normalize it (drop ?token=) ----
  const initial = decodeRoute(location.pathname, location.search)
  if (initial) {
    store.hydrate(initial.leaf)
    history.replaceState(null, '', encodeRoute(initial.leaf))
  } else {
    store.hydrate({ kind: 'chat_list', key: 'chat_list' })
    history.replaceState(null, '', '/chat')
  }
  urls = [currentUrl()]
  pos = 0
  // The boot replace is not a user navigation.
  store.navOp = 'replace'

  // ---- popstate: rebuild the view from the URL (no state) ----
  const onPop = () => {
    const target = currentUrl()
    const idx = urls.indexOf(target)
    if (idx !== -1) pos = idx
    else {
      // A forward entry we did not record (should not happen): resync.
      urls = [target]
      pos = 0
    }
    const r = decodeRoute(location.pathname, location.search)
    store.hydrate(r ? r.leaf : { kind: 'chat_list', key: 'chat_list' })
  }
  window.addEventListener('popstate', onPop)

  // ---- in-app back: consume a real history entry when possible ----
  store.backRequest = () => {
    if (pos > 0) {
      history.back()
      return
    }
    // Deep-linked page: nothing before us in the app — replace with the parent.
    const stack = store.currentStack
    if (stack.length <= 1) return
    store.navigate(stack[stack.length - 2]!, { replace: true })
  }

  // ---- store -> URL mirror ----
  // Re-runs on every navigation (navSeq). pushState/replaceState do NOT fire
  // popstate, so this never recurses.
  const disposeEffect = $effect.root(() => {
    $effect(() => {
      void store.navSeq
      const target = encodeRoute(store.leaf)
      if (target === currentUrl()) {
        store.navOp = 'push'
        return
      }
      if (store.navOp === 'replace') {
        history.replaceState(null, '', target)
        urls[pos] = target
      } else {
        history.pushState(null, '', target)
        urls = urls.slice(0, pos + 1)
        urls.push(target)
        pos = urls.length - 1
      }
      store.navOp = 'push'
    })
  })

  return () => {
    window.removeEventListener('popstate', onPop)
    store.backRequest = null
    disposeEffect()
  }
}
