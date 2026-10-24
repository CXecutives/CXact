<!-- A tile holding a glyph, a portal monogram (in / fd / fm, 12/650) or a portal's own mark
     (`logo`, an image of the app: a full square the tile's corners round, with a hairline so a
     light mark keeps its edge). Four sizes, 32, 36, 48 and 56 (sm, md, lg, xl), the glyph half
     the tile (16, 18, 24, 28); 8 round up to 36 and 14 from 48 (`round`: a disc). Tones:
     neutral (the track with a muted glyph: the rows of Einstellungen), raised (white with an
     edge and a lifted shadow: an empty state), accent (the track with a navy glyph: a step of
     the setup), success (the soft green with the green glyph: the setup done) and danger (the
     soft red with the red glyph: a failure). No tinted portal tiles (round 10). A glyph that
     `draws` draws itself once as the tile appears (the check of the setup's Fertig). -->
<script lang="ts" module>
  export type TileTone = 'neutral' | 'raised' | 'accent' | 'success' | 'danger';
  export type TileSize = 'sm' | 'md' | 'lg' | 'xl';
</script>

<script lang="ts">
  import Icon, { type IconName, type IconSize } from './Icon.svelte';

  interface Props {
    tone?: TileTone;
    size?: TileSize;
    /** A disc instead of a rounded square. */
    round?: boolean;
    icon?: IconName | null;
    monogram?: string | null;
    logo?: string | null;
    /** The glyph draws itself once as the tile appears. */
    draws?: boolean;
  }

  let {
    tone = 'neutral',
    size = 'md',
    round = false,
    icon = null,
    monogram = null,
    logo = null,
    draws = false,
  }: Props = $props();

  /** A glyph in a tile is half the tile. */
  const ICON_SIZE: Record<TileSize, IconSize> = { sm: 'sm', md: 'nav', lg: 'xl', xl: 'xxl' };
</script>

<span
  class="tile {tone} {size}"
  class:round
  class:mark={logo !== null}
  class:draws
  aria-hidden="true"
>
  {#if logo}
    <img class="logo" src={logo} alt="" draggable="false" />
  {:else if icon}
    <Icon name={icon} size={ICON_SIZE[size]} />
  {:else if monogram}
    <span class="monogram">{monogram}</span>
  {/if}
</span>

<style>
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--tile-size);
    height: var(--tile-size);
    border-radius: var(--tile-radius);
    background-color: var(--tile-bg);
    color: var(--tile-fg);
  }

  .round {
    border-radius: var(--radius-full);
  }

  /* A portal's own mark fills the tile; a hairline over it keeps a white one apart. */
  .mark {
    position: relative;
    overflow: hidden;
  }

  .mark::after {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 var(--border-width) var(--border);
    content: '';
    pointer-events: none;
  }

  .draws :global(path) {
    stroke-dasharray: var(--draw-length);
    animation: draw var(--dur-slow) var(--ease-out) var(--dur-instant) both;
  }

  .logo {
    width: 100%;
    height: 100%;
  }

  .monogram {
    font: var(--tile-monogram);
  }

  .neutral {
    --tile-bg: var(--surface-track);
    --tile-fg: var(--text-muted);
  }

  .raised {
    --tile-bg: var(--surface);
    --tile-fg: var(--text-muted);

    border: var(--border-width) solid var(--border);
    box-shadow: var(--sh-raised);
  }

  .accent {
    --tile-bg: var(--surface-track);
    --tile-fg: var(--tile-accent);
  }

  .success {
    --tile-bg: var(--success-soft);
    --tile-fg: var(--success);
  }

  .danger {
    --tile-bg: var(--danger-tint);
    --tile-fg: var(--status-danger);
  }

  .sm {
    --tile-size: var(--tile-sm);
    --tile-radius: var(--tile-radius-sm);
  }

  .md {
    --tile-size: var(--tile-md);
    --tile-radius: var(--tile-radius-sm);
  }

  .lg {
    --tile-size: var(--tile-lg);
    --tile-radius: var(--tile-radius-lg);
  }

  .xl {
    --tile-size: var(--tile-xl);
    --tile-radius: var(--tile-radius-lg);
  }
</style>
