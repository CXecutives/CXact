<!--
  Vor of the top bar, drawn for the app (user, 2026-09-29: quieter than Lucide's, like the
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
  class="glyph-bar-forward"
  {...props}
>
  <path d="M2 8h11.5" />
  <path d="M9 3.5l4.5 4.5L9 12.5" />
</svg>
