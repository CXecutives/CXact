<!-- The app's own icon (dark plate, white folder, check mark): first run, empty states. -->
<script lang="ts">
  import icon from '../assets/app-icon.svg';

  interface Props {
    size?: 'xs' | 'sm' | 'md' | 'lg';
    /** Accessible name; omit when the app name stands next to the mark. */
    label?: string | null;
  }

  let { size = 'md', label = null }: Props = $props();
</script>

<img
  class="mark {size}"
  src={icon}
  alt={label ?? ''}
  aria-hidden={label ? undefined : 'true'}
  draggable="false"
/>

<style>
  .mark {
    flex: none;
    width: var(--mark-size);
    height: var(--mark-size);
    border-radius: var(--brand-radius);
    box-shadow: 0 0 0 var(--border-width) var(--brand-edge);
    pointer-events: none;
  }

  .xs {
    --mark-size: var(--brand-mark-xs);
  }

  .sm {
    --mark-size: var(--brand-mark-sm);
  }

  .md {
    --mark-size: var(--brand-mark);
  }

  .lg {
    --mark-size: var(--brand-mark-lg);
  }
</style>
