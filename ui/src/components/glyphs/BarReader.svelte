<!--
  The job view's glyph of the top bar, drawn for the app (user, 2026-09-29: quieter than Lucide's, like the
  Claude app's bar): 16 units, a square frame, round ends and corners, in the bar's 1.5 px line
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
  class="glyph-bar-reader"
  {...props}
>
  <rect x="2" y="2" width="12" height="12" rx="2.5" />
  <path d="M9.5 2v12" />
</svg>
