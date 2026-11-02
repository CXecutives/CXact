<!--
  A large button that is one choice or one place to drop a file (the round 10 draft); focus
  draws no ring, Enter and Space press it like any button, nothing moves or shrinks. The
  second click of a double click does nothing: it is the one of the button before it, whose
  step brought this tile under the pointer.
  - a way (the setup's two ways to the profile, side by side; a click goes on at once): white
    with a hairline, 14 round, 16 inside; its glyph in a 36 tile on the track like the step's own,
    the title 16/650 12 under it and one small muted line. Under the pointer a stronger edge
    and a soft shadow. The way the app recommends (`recommended`: from the CV) is coral: a
    coral-tinted fill, a coral edge and a coral glyph.
  - `drop`: a dashed edge on the page's ground, 14 round, the words and a quiet line centred,
    no glyph (the step's tile above says it; the uniformity audit, 2026-10-29): the CV's
    upload, a click opens the file dialog. Under the pointer, and while a file is dragged
    over the window (`over`), a darker edge and the light wash.
-->
<script lang="ts">
  import { secondPress } from '$lib/input/input';
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    /** The glyph of a way (a drop zone has none). */
    icon?: IconName | null;
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
    icon = null,
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
  onclick={(event) => {
    // A double click on the button before it (Loslegen, a way) lands its second click here.
    if (!secondPress(event)) onclick();
  }}
>
  {#if icon && !drop}<span class="glyph"><Icon name={icon} size="nav" /></span>{/if}
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
    border-radius: var(--tile-radius-sm);
    background-color: var(--surface-track);
    color: var(--icon-accent);
    transition: background-color var(--dur-base) var(--ease-out);
  }

  /* Pressed, its small tile goes a step darker with its ground, so it stays. */
  :global(:where(:root:not([data-aux-press]))) .way:active:hover .glyph {
    background-color: var(--border);
    transition-duration: var(--dur-instant);
  }

  .way .label {
    margin-top: var(--way-title-gap);
    color: var(--text);
    font: var(--type-heading);
    letter-spacing: var(--tracking-tight);
  }

  /* No word alone on its last line (like every sentence, base.css). */
  .way .note {
    color: var(--text-muted);
    font: var(--type-sm);
    text-wrap: pretty;
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
    background-color: var(--recommended-press);
    color: var(--recommended-glyph);
  }

  :global(:where(:root:not([data-aux-press]))) .recommended:active:hover .glyph {
    background-color: var(--recommended-edge);
  }

  /* The drop zone: dashed on the page's ground, everything centred. */
  .drop {
    align-items: center;
    padding: var(--drop-pad-y) var(--drop-pad-x);
    border: var(--drop-edge) dashed var(--border-strong);
    background-color: var(--page);
    text-align: center;
  }

  .drop .label {
    color: var(--text);
    font: var(--type-label);
  }

  .drop .note {
    color: var(--text-muted);
    font: var(--type-sm);
    text-wrap: pretty;
  }

  .drop:hover,
  .drop.over {
    border-color: var(--drop-edge-hover);
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .drop:active:hover {
    border-color: var(--control-press-edge);
    transition-duration: var(--dur-instant);
  }
</style>
