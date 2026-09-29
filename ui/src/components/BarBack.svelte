<!--
  Zurück of the top bar, drawn for the app (user, 2026-09-29: quieter than Lucide's, like the
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
  class="glyph-bar-back"
  {...props}
>
  <path d="M13.5 8.5h-11" />
  <path d="M7 4l-4.5 4.5L7 13" />
</svg>
