<!--
  A small panel under its button (the Profil's "Aus Lebenslauf ausfüllen"): the button opens
  and closes it, its right edge on the button's (`align` end) or its left edge; it floats over
  what follows on the surface of every floating panel (the hairline, the menu's shadow) and
  comes in like a menu (100 ms, a small slide, ease-out). Opened, the focus goes to its first
  control; Esc closes it and gives the focus back to the button, and so does a choice inside
  it (`close`); a press elsewhere or Tab out of it closes it. The trigger is the button
  (`trigger`, given `toggle` and whether it is open).
-->
<script lang="ts">
  import { formKeys } from '$lib/input/input';
  import { menuIn, menuOut } from '$lib/motion/transitions';
  import { tick, type Snippet } from 'svelte';

  interface Props {
    /** The button: it calls `toggle`; `open` says whether the panel shows. */
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    align?: 'start' | 'end';
    testid?: string | null;
    children: Snippet<[{ close: () => void }]>;
  }

  let { trigger, align = 'end', testid = null, children }: Props = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let panel = $state<HTMLElement | null>(null);

  async function toggle(): Promise<void> {
    if (open) {
      close();
      return;
    }
    open = true;
    await tick();
    panel?.querySelector<HTMLElement>('button, input, [tabindex="0"]')?.focus();
  }

  /** Closed by Esc or a choice inside: the focus goes back to the button. */
  function close(): void {
    open = false;
    root?.querySelector<HTMLElement>('[data-popover-trigger] button')?.focus();
  }

  /** A press inside: the focus it takes away (WebKit) is no leaving. */
  let pressed = false;
  function press(): void {
    pressed = true;
    setTimeout(() => (pressed = false));
  }

  /** The focus left the panel and its button (a press elsewhere, Tab out): it closes. */
  function leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (open && !pressed && !(next instanceof Node && root?.contains(next))) open = false;
  }
</script>

<span class="anchor" role="presentation" bind:this={root} onfocusout={leave} onpointerdown={press}>
  <span class="trigger" data-popover-trigger
    >{@render trigger({ toggle: () => void toggle(), open })}</span
  >
  {#if open}
    <div
      class="panel {align}"
      bind:this={panel}
      data-testid={testid ?? undefined}
      use:formKeys={{ cancel: close }}
      in:menuIn
      out:menuOut
    >
      {@render children({ close })}
    </div>
  {/if}
</span>

<style>
  .anchor {
    position: relative;
    display: inline-flex;
  }

  .trigger {
    display: inline-flex;
  }

  .panel {
    position: absolute;
    z-index: var(--z-overlay);
    top: calc(100% + var(--menu-gap));
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    width: var(--popover-width);
    padding: var(--space-8);
    border: var(--border-width) solid var(--border);
    border-radius: var(--menu-radius);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-menu);
  }

  .panel.end {
    right: 0;
  }

  .panel.start {
    left: 0;
  }
</style>
