<!--
  Zurück of the top bar, drawn for the app (user, 2026-09-29: quieter than Lucide's, like the
  Claude app's bar): 16 units, round ends and corners, in the bar's 1.5 px line
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
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="glyph-bar-back"
  {...props}
>
  <path d="M13 8H3" />
  <path d="M7 4L3 8l4 4" />
</svg>
