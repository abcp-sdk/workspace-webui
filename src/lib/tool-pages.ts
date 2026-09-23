// Page builders shared by the tool-card registry. Every builder returns an
// `AppPage` that `store.openCodePage` can push, so a card can deep-link into
// the Code / Service tabs from anywhere.
import type { AppPage } from './nav'

export function repoDetail(org: string, repo: string, ref: string): AppPage {
  return { kind: 'repo_detail', key: `repo:${org}/${repo}@${ref}`, org, repo, ref }
}
export function repoBlob(org: string, repo: string, ref: string, path: string): AppPage {
  return { kind: 'repo_blob', key: `blob:${org}/${repo}@${ref}:${path}`, org, repo, ref, path }
}
export function repoHistory(org: string, repo: string, ref: string, path: string): AppPage {
  return { kind: 'repo_history', key: `hist:${org}/${repo}@${ref}:${path}`, org, repo, ref, path }
}
export function repoCommit(org: string, repo: string, ref: string, sha: string): AppPage {
  return { kind: 'repo_commit', key: `commit:${org}/${repo}@${sha}`, org, repo, ref, sha }
}
export function repoCompare(org: string, repo: string, base: string, head: string): AppPage {
  return { kind: 'repo_compare', key: `cmp:${org}/${repo}:${base}...${head}`, org, repo, base, head }
}
export function repoMR(org: string, repo: string, index: number): AppPage {
  return { kind: 'repo_mr', key: `mr:${org}/${repo}:${index}`, org, repo, index }
}
export function repoTag(org: string, repo: string, ref: string): AppPage {
  return { kind: 'repo_tag', key: `tag:${org}/${repo}@${ref}`, org, repo, ref }
}
export function repoRelease(org: string, repo: string, tag: string): AppPage {
  return { kind: 'repo_release', key: `rel:${org}/${repo}:${tag}`, org, repo, tag }
}
export function sandboxPage(name: string): AppPage {
  return { kind: 'sandbox_detail', key: `sbx:${name}`, name }
}
export function servicePage(name: string): AppPage {
  return { kind: 'service_detail', key: `svc:${name}`, name }
}
