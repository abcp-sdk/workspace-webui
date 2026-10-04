import type { SandboxInfo } from './api'

// The PUBLIC url of a sandbox's worker frontend page. The sandbox is reachable
// in-cluster at `http://<res>.<ns>.svc.cluster.local[:port]` (res = the k8s
// Service name, e.g. `wm-<name>`); the cluster edge routes
// `<res>.<ns>.<domain>` to that Service's port 80. So we take `<res>`/`<ns>`
// from the sandbox's in-cluster URL and the `<domain>` from the CURRENT host
// (drop the first two labels of `window.location.host`), mirroring the gateway's
// service public-URL convention. Returns '' when it cannot be derived.
export function sandboxWorkerUrl(s: SandboxInfo): string {
  const m = /^https?:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\.svc\.cluster\.local/i.exec(
    s.url || '',
  )
  if (!m) return ''
  const res = m[1]!
  const ns = m[2]!
  const host = (window.location.host || '').split(':')[0] ?? ''
  const parts = host.split('.')
  if (parts.length < 3) return ''
  const domain = parts.slice(2).join('.')
  if (!domain) return ''
  return `https://${res}.${ns}.${domain}`
}
