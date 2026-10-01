<!-- A soft tinted tile holding an icon, a portal monogram (in / fd / fm) or a portal's own
     mark (`logo`, an image of the app: a full square the tile's corners round, with a
     hairline so a light mark keeps its edge). Data sources (portals, the profile file) take
     the navy tone. -->
<script lang="ts" module>
  export type TileTone = 'navy' | 'danger' | 'neutral';
  export type TileSize = 'sm' | 'md' | 'lg';
  export const TILE_TONES: readonly TileTone[] = ['navy', 'danger', 'neutral'];
</script>

<script lang="ts">
  import Icon, { type IconName, type IconSize } from './Icon.svelte';

  interface Props {
    tone?: TileTone;
    size?: TileSize;
    icon?: IconName | null;
    monogram?: string | null;
    logo?: string | null;
  }

  let {
    tone = 'neutral',
    size = 'md',
    icon = null,
    monogram = null,
    logo = null,
  }: Props = $props();

  const ICON_SIZE: Record<TileSize, IconSize> = { sm: 'sm', md: 'md', lg: 'lg' };
</script>

<span class="tile {tone} {size}" class:mark={logo !== null} aria-hidden="true">
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

  .logo {
    width: 100%;
    height: 100%;
  }

  .monogram {
    font: var(--tile-type);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-tight);
  }

  .navy {
    --tile-bg: var(--active-surface);
    --tile-fg: var(--active-text);
  }

  .danger {
    --tile-bg: var(--danger-soft);
    --tile-fg: var(--danger-strong);
  }

  /* The track tone reads on white cards and on the cream page alike. */
  .neutral {
    --tile-bg: var(--surface-track);
    --tile-fg: var(--text-muted);
  }

  .sm {
    --tile-size: var(--tile-sm);
    --tile-radius: var(--radius-sm);
    --tile-type: var(--type-xs);
  }

  .md {
    --tile-size: var(--tile-md);
    --tile-radius: var(--radius-md);
    --tile-type: var(--type-sm);
  }

  .lg {
    --tile-size: var(--tile-lg);
    --tile-radius: var(--radius-lg);
    --tile-type: var(--type-lg);
  }
</style>
