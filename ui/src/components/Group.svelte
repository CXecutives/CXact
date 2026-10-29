<!--
  The white box of a page's group (Section; Profil, Einstellungen, the setup's mailbox form
  and its portals' rows; the round 10 draft): white with a hairline edge and the card's soft
  shadow, 14 round. A box of fields is 18 20 20 inside with its fields 18 apart, no lines
  between them. A box of rows (SettingRow, PortalRow; the Profil's rows, `rows`) has no
  padding: its rows pad themselves and draw the hairline between them, the only hairlines of
  a box. The box is the
  container its rows ask for their width (a narrow box puts a row's buttons on a line of their
  own). A box of a group of several has its caption above it (Jobportale's "Suche und
  Alert-Mails"): 13/500 muted, 2 in like the section's title, 6 above the box, 14 below the box
  before it (8 under the section's title).
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
    /** A box of rows that pad themselves (the Profil's). */
    rows?: boolean;
    children: Snippet;
  }

  let {
    caption = null,
    captionTestid = null,
    testid = null,
    rows = false,
    children,
  }: Props = $props();
</script>

{#if caption !== null}
  <div class="captioned">
    <h3 class="caption" data-testid={captionTestid ?? undefined}>{caption}</h3>
    <div class="box" class:rows data-testid={testid ?? undefined}>
      {@render children()}
    </div>
  </div>
{:else}
  <div class="box" class:rows data-testid={testid ?? undefined}>
    {@render children()}
  </div>
{/if}

<style>
  .captioned {
    display: flex;
    flex-direction: column;
    gap: var(--group-caption-gap);
    min-width: 0;
  }

  /* After the section's title the caption stands 8 below it (its 10 less 2); after a box 14
     (the section's gap between its boxes). */
  .captioned:first-child {
    margin-top: calc(-1 * var(--space-2));
  }

  .caption {
    margin-inline: var(--section-inset);
    color: var(--text-muted);
    font: var(--group-caption);
  }

  .box {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--group-field-gap);
    min-width: 0;
    padding: var(--card-pad-y) var(--card-pad-x) var(--group-pad-end);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-card);
    background-color: var(--surface);
    box-shadow: var(--sh-card);
  }

  /* A box of rows: the rows bring their own padding and lines. */
  .box.rows,
  .box:has(> :global([data-setting-row])) {
    gap: 0;
    padding: 0;
  }
</style>
