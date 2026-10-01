<!--
  The sidebar's glyph of the top bar, drawn for the app (user, 2026-09-29: quieter than Lucide's, like the
  Claude app's bar): 16 units, a square frame with tight corners, arrows as wide as it, in the bar's 1.25 px line
  (--titlebar-icon-stroke). Icon.svelte draws it like a Lucide glyph.
-->
<script lang="ts">
  let props: Record<string, unknown> = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width="16"
  height="16"
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.25"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="glyph-bar-sidebar"
  {...props}
>
  <rect x="2" y="2" width="12" height="12" rx="1.5" />
  <path d="M6.25 2v12" />
</svg>
