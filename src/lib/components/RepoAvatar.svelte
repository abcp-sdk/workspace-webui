<script lang="ts">
  // RepoAvatar — the 3-level honeycomb identicon, an exact port of easylab's
  // Flutter ChatAvatar:
  //   org    -> solid circle tinted by the org name
  //   repo   -> org background + a FIXED wreath shared by every repo
  //   branch -> org background + a UNIQUE honeycomb seeded by the branch name
  import { avatarSpecFor, type AvatarLevel, type HexCell } from '$lib/identicon'

  let {
    org = '',
    repo = '',
    branch = '',
    level = 'branch',
    size = 40,
  }: { org?: string; repo?: string; branch?: string; level?: AvatarLevel; size?: number } = $props()

  const spec = $derived(avatarSpecFor(org, repo, branch, level))
  const d = $derived(size)
  const clipId = $derived(`rav-${(org + '/' + repo + '/' + branch + '/' + level).replace(/[^a-zA-Z0-9]/g, '')}`)

  function points(h: HexCell): string {
    const cx = d / 2 + h.x * d
    const cy = d / 2 + h.y * d
    const r = h.r * d
    const pts: string[] = []
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
    }
    return pts.join(' ')
  }
</script>

<svg width={d} height={d} viewBox="0 0 {d} {d}" class="shrink-0" aria-hidden="true">
  <clipPath id={clipId}>
    <circle cx={d / 2} cy={d / 2} r={d / 2} />
  </clipPath>
  <circle cx={d / 2} cy={d / 2} r={d / 2} fill={spec.bg} />
  <g clip-path={`url(#${clipId})`}>
    {#each spec.hexes.filter(h => h.on) as h}
      <polygon points={points(h)} fill={spec.fg} />
    {/each}
  </g>
</svg>
