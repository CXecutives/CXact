<!--
  A link that is text as well (the contact's e-mail in Jobdetails): navy words that underline
  on hover and dim while pressed, 24 px of hit area, like a Button `link`, the arrow over them
  like every link. It is no button: WebKit starts no selection inside one. A drag over it
  selects it, the app's menu then offers Copy, Ctrl/Cmd+C copies; a click without a drag acts,
  a double click once. Tab reaches it, Enter and Space press it (input.ts `pressByRole`).
-->
<script lang="ts">
  import { wasDragged } from '$lib/input/input';

  interface Props {
    label: string;
    testid?: string | null;
    onclick: () => void;
  }

  let { label, testid = null, onclick }: Props = $props();

  function press(event: MouseEvent): void {
    // The release of a drag; the second click of a double click.
    if (wasDragged(event) || event.detail > 1) return;
    onclick();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<span
  class="link"
  role="button"
  tabindex="0"
  data-copy
  data-testid={testid ?? undefined}
  onclick={press}
>
  <span class="label">{label}</span>
</span>

<style>
  .link {
    display: inline-flex;
    align-items: center;
    height: var(--control-sm);
    color: var(--link);
    white-space: nowrap;
    cursor: default;
    transition:
      color var(--dur-base) var(--ease-standard),
      opacity var(--dur-base) var(--ease-standard);
  }

  .link:hover {
    color: var(--link-hover);
    transition-duration: var(--dur-hover);
  }

  /* Pressed: only while the left button is down (input.ts marks a press of the others). */
  :global(:where(:root:not([data-aux-press]))) .link:active:hover {
    opacity: var(--opacity-press);
    transition-duration: var(--dur-instant);
  }

  .label {
    position: relative;
  }

  .label::after {
    position: absolute;
    inset: auto 0 0;
    height: var(--border-width);
    background-color: currentcolor;
    content: '';
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-standard);
  }

  .link:hover .label::after {
    opacity: 1;
    transition-duration: var(--dur-hover);
  }
</style>
