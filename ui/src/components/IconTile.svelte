<!-- A 48 tile holding a glyph of 24 (half the tile), 14 round. Tones: accent (the track with a
     navy glyph: a step of the setup, an empty state) and danger (the soft red with the red glyph: a failure). -->
<script lang="ts" module>
  export type TileTone = 'accent' | 'danger';
</script>

<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  interface Props {
    tone?: TileTone;
    icon: IconName;
  }

  let { tone = 'accent', icon }: Props = $props();
</script>

<span class="tile {tone}" aria-hidden="true">
  <Icon name={icon} size="xl" />
</span>

<style>
  .tile {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--tile-lg);
    height: var(--tile-lg);
    border-radius: var(--tile-radius-lg);
    background-color: var(--tile-bg);
    color: var(--tile-fg);
  }

  .accent {
    --tile-bg: var(--surface-track);
    --tile-fg: var(--tile-accent);
  }

  .danger {
    --tile-bg: var(--danger-soft);
    --tile-fg: var(--status-danger);
  }
</style>
