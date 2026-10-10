<!--
  The white box of a page's group (Section; Profil, Einstellungen, the setup's mailbox form
  and its portals' rows): white with a 1 px edge,
  12 round, 16 inside all round, like the settings of macOS and Windows on the cream page.
  Fields stand 16 apart in it without a line between them (ProfileEditor). A list of rows
  (SettingRow, PortalRow) brings its own padding: the rows run edge to edge (they bleed out
  by the box's inset, --row-inset, and pad back in by it) with a hairline between them, the
  only hairlines of a box. A box of a group of several has its caption above it (the
  Jobportale's "Suche und Alert-Mails"): the app's text in medium, muted, flush with the box,
  6 above it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** The caption above the box (a group of several boxes). */
    caption?: string | null;
    /** The caption's test id. */
    captionTestid?: string | null;
    /** The box's test id. */
    testid?: string | null;
    children: Snippet;
  }

  let { caption = null, captionTestid = null, testid = null, children }: Props = $props();
</script>

{#if caption !== null}
  <div class="captioned">
    <h3 class="caption" data-testid={captionTestid ?? undefined}>{caption}</h3>
    <div class="box" data-testid={testid ?? undefined}>{@render children()}</div>
  </div>
{:else}
  <div class="box" data-testid={testid ?? undefined}>{@render children()}</div>
{/if}

<style>
  .captioned {
    display: flex;
    flex-direction: column;
    gap: var(--label-gap);
  }

  .caption {
    color: var(--text-muted);
    font: var(--type-label);
  }

  .box {
    --row-inset: var(--layout-group-pad);

    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: var(--layout-group-pad);
    border-radius: var(--layout-group-radius);
    background-color: var(--layout-group);
    box-shadow: inset 0 0 0 var(--border-width) var(--layout-group-edge);
  }

  /* Rows bring their own padding above and below. */
  .box:has(> :global([data-setting-row])) {
    padding-block: 0;
  }
</style>
