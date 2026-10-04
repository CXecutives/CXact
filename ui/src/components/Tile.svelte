<!--
  A large button that is one choice or one place to drop a file (design round 3): a bordered
  tile (radius 10) with its glyph in navy, its label and one small line under it. Under the
  pointer and pressed it takes a navy edge on a faint navy tint (150 ms, ease-out; nothing
  moves or shrinks); keyboard focus is the navy ring; Enter and Space press it like any
  button.
  - choice: the glyph on top, the label in bold, the content at the left (the setup's two
    ways to the profile, side by side; a click goes on at once).
  - `drop`: a dashed edge, the content centred, the label in the ink of the text (the CV's
    upload, in the setup and in the Profil's popover): a click opens the file dialog, and
    while a file is dragged over the window (`over`) it looks as under the pointer.
-->
<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    icon: IconName;
    label: string;
    /** The one small line under the label. */
    note?: string | null;
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
    drop = false,
    over = false,
    testid = null,
    onclick,
  }: Props = $props();
</script>

<button
  type="button"
  class="tile"
  class:drop
  class:over
  data-testid={testid ?? undefined}
  onclick={() => onclick()}
>
  <span class="glyph"><Icon name={icon} size={drop ? 'xl' : 'lg'} /></span>
  <span class="label">{label}</span>
  {#if note}<span class="note">{note}</span>{/if}
</button>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--card-padding);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--surface);
    text-align: start;
    cursor: pointer;
    transition:
      border-color var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out);
  }

  .tile:hover,
  .tile.over {
    border-color: var(--active-edge);
    background-color: var(--active-surface);
    transition-duration: var(--dur-hover);
  }

  :global(:where(:root:not([data-aux-press]))) .tile:active:hover {
    background-color: var(--active-hover);
    transition-duration: var(--dur-instant);
  }

  .tile:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .glyph {
    display: inline-flex;
    margin-bottom: var(--space-6);
    color: var(--icon-accent);
  }

  .label {
    color: var(--text);
    font: var(--type-md);
    font-weight: var(--weight-semibold);
  }

  .note {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  /* The drop zone: dashed, everything centred, the label in the text's weight. */
  .drop {
    align-items: center;
    padding: var(--space-24) var(--card-padding);
    border: var(--drop-edge) dashed var(--border-strong);
    text-align: center;
  }

  .drop .label {
    font-weight: var(--weight-medium);
  }

  .drop .glyph {
    margin-bottom: var(--space-8);
  }
</style>
