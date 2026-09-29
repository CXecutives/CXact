<!--
  The sidebar's glyph of the top bar, drawn for the app (user, 2026-09-29: quieter than Lucide's, like the
  Claude app's bar): 16 units on a pixel grid, so its 1 px line (the caption buttons' line,
  --titlebar-icon-stroke) stays sharp. Icon.svelte draws it like a Lucide glyph.
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
  stroke-width="1"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="glyph-bar-sidebar"
  {...props}
>
  <rect x="1.5" y="3.5" width="13" height="10" rx="2" />
  <path d="M5.5 3.5v10" />
</svg>
