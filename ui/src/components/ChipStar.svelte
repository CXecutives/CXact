<!--
  The star at the start of a chip (ChipInput `star`): outlined, filled while the chip is
  marked (a preferred industry); its words say what a click does. Like the chip's x it is no
  Tab stop and a click keeps the caret in the field.
-->
<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    on: boolean;
    label: string;
    onclick: () => void;
  }

  let { on, label, onclick }: Props = $props();
</script>

<button
  type="button"
  class="star"
  class:on
  tabindex="-1"
  data-keep-focus
  aria-pressed={on}
  aria-label={label}
  data-testid="chip-star"
  {onclick}
>
  <Icon name="star" size="xs" filled={on} />
</button>

<style>
  .star {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: min(var(--icon-md), var(--chip-line));
    height: min(var(--icon-md), var(--chip-line));
    border-radius: var(--radius-full);
    color: var(--active-text);
    transition: background-color var(--dur-fast) var(--ease-standard);
  }

  .star:hover {
    background-color: var(--active-hover);
    transition-duration: var(--dur-hover);
  }

  .star.on {
    color: var(--pressed);
  }
</style>
