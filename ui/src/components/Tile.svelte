<!--
  A large button that is one choice or one place to drop a file (the round 10 draft); focus
  draws no ring, Enter and Space press it like any button, nothing moves or shrinks.
  - a way (the setup's two ways to the profile, side by side; a click goes on at once): white
    with a hairline, 14 round, 16 inside; its glyph in a white 36 tile with an edge (navy),
    the title 16/650 12 under it and one small muted line. Under the pointer a stronger edge
    and a soft shadow. The way the app recommends (`recommended`: from the CV) is coral: a
    coral-tinted fill, a coral edge and a coral glyph.
  - `drop`: a dashed edge on the page's ground, 14 round, the content centred: a round track
    disc of 48 with the navy glyph, the words and a quiet line (the CV's upload, in the setup
    and the Profil): a click opens the file dialog. Under the pointer, and while a file is
    dragged over the window (`over`), the edge turns navy, the ground the track and the disc
    white.
-->
<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    icon: IconName;
    label: string;
    /** The one small line under the label. */
    note?: string | null;
    /** The way the app recommends (coral). */
    recommended?: boolean;
    /** A drop zone: dashed, centred. */
    drop?: boolean;
    /** A file is over the window: it looks as under the pointer. */
    over?: boolean;
    testid?: string | null;
    onclick: () => void;
  }

  let {
    icon,
    label,
    note = null,
    recommended = false,
    drop = false,
    over = false,
    testid = null,
    onclick,
  }: Props = $props();
</script>

<button
  type="button"
  class="tile"
  class:way={!drop}
  class:recommended={recommended && !drop}
  class:drop
  class:over
  data-testid={testid ?? undefined}
  onclick={() => onclick()}
>
  <span class="glyph"><Icon name={icon} size={drop ? 'xl' : 'nav'} /></span>
  <span class="label">{label}</span>
  {#if note}<span class="note">{note}</span>{/if}
</button>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-radius: var(--radius-card);
    text-align: start;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }

  /* A way: white, its glyph tile at the top left. */
  .way {
    align-items: flex-start;
    padding: var(--way-pad);
    border: var(--border-width) solid var(--border);
    background-color: var(--surface);
  }

  .way:hover {
    border-color: var(--border-strong);
    box-shadow: var(--sh-tile-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .way:active:hover {
    background-color: var(--control-press);
    transition-duration: var(--dur-instant);
  }

  .way .glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tile-md);
    height: var(--tile-md);
    border: var(--border-width) solid var(--border);
    border-radius: var(--tile-radius-sm);
    background-color: var(--surface);
    color: var(--icon-accent);
    transition: border-color var(--dur-base) var(--ease-out);
  }

  .way .label {
    margin-top: var(--way-title-gap);
    color: var(--text);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  .way .note {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The recommended way: coral fill, edge and glyph. */
  .recommended {
    border-color: var(--recommended-edge);
    background-color: var(--recommended-surface);
  }

  .recommended:hover {
    border-color: var(--recommended-edge-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .recommended:active:hover {
    background-color: var(--recommended-press);
  }

  .recommended .glyph {
    border-color: var(--recommended-edge);
    color: var(--recommended-glyph);
  }

  /* The drop zone: dashed on the page's ground, everything centred. */
  .drop {
    align-items: center;
    padding: var(--drop-pad-y) var(--drop-pad-x);
    border: var(--drop-edge) dashed var(--border-strong);
    background-color: var(--page);
    text-align: center;
  }

  .drop .glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tile-lg);
    height: var(--tile-lg);
    margin-bottom: var(--drop-disc-gap);
    border-radius: var(--radius-full);
    background-color: var(--surface-track);
    color: var(--icon-accent);
    transition: background-color var(--dur-base) var(--ease-out);
  }

  .drop .label {
    color: var(--text);
    font: var(--type-label);
  }

  .drop .note {
    color: var(--text-subtle);
    font: var(--type-sm);
  }

  .drop:hover,
  .drop.over {
    border-color: var(--drop-edge-hover);
    background-color: var(--surface-track);
    transition-duration: var(--dur-hover);
  }

  .drop:hover .glyph,
  .drop.over .glyph {
    background-color: var(--surface);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .drop:active:hover {
    border-color: var(--link-hover);
    transition-duration: var(--dur-instant);
  }
</style>
