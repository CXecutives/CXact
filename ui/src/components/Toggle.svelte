<!--
  On/off switch, coral when on with a white knob (owner, 2026-10-30), grey when off at 3:1
  on white (round 10: 36 x 21, the knob 17 px and 15
  px of travel). The knob travels in 150 ms (ease-out, no bounce) and the track
  changes colour with it; it darkens a step under the pointer and one more while the left
  button is down, off and on alike (the knob never changes shape).
  Disabled switches stay hoverable so the tooltip can say why (disabledReason), a press at
  once, and Tab passes them like native disabled controls.
  It flips at once, like a native switch: when `onchange` returns a promise (the save),
  the switch shows the new state until it settles, then `checked` again - which is the old
  state if the save failed, so the thumb slides back.
  Only the switch itself switches, like the switches of the Windows 11 and macOS settings
  (user decision): its label and the text of its row are no click target and never show a
  hover. `id` ties it to the text of its SettingRow (`for`): the row's label names it
  (`{id}-label`) and the row's hint, while it has one, describes it.
-->
<script lang="ts">
  import { tooltip } from '$lib/actions/tooltip';
  import { describedBy } from '$lib/state/described';

  interface Props {
    checked: boolean;
    label: string;
    disabled?: boolean;
    disabledReason?: string | null;
    /** Ties the switch to the text of its SettingRow (`for`), which names and describes it. */
    id?: string | null;
    testid?: string | null;
    /** Return the save's promise: the switch shows the new state until it settles. */
    onchange: (checked: boolean) => unknown;
  }

  let {
    checked,
    label,
    disabled = false,
    disabledReason = null,
    id = null,
    testid = null,
    onchange,
  }: Props = $props();

  const described = describedBy();

  /** The state shown while a save is on its way (null: show `checked`). */
  let pending = $state<boolean | null>(null);
  let attempt = 0;
  const shown = $derived(pending ?? checked);

  async function toggle(): Promise<void> {
    if (disabled) return;
    const next = !shown;
    const mine = ++attempt;
    pending = next;
    // Settled either way: the caller reports a failure, the switch shows `checked` again.
    const settle = (): void => {
      if (mine === attempt) pending = null;
    };
    await Promise.resolve(onchange(next)).then(settle, settle);
  }
</script>

<button
  type="button"
  role="switch"
  class="toggle"
  id={id ?? undefined}
  aria-checked={shown}
  aria-label={label}
  aria-labelledby={id ? `${id}-label` : undefined}
  aria-describedby={described() ?? undefined}
  aria-disabled={disabled ? 'true' : undefined}
  tabindex={disabled ? -1 : undefined}
  data-testid={testid ?? undefined}
  use:tooltip={disabled ? { text: disabledReason, toggle: true } : null}
  onclick={() => void toggle()}
>
  <span class="track"><span class="thumb"></span></span>
</button>

<style>
  .toggle {
    display: inline-flex;
    flex: none;
    align-items: center;
  }

  .track {
    position: relative;
    display: inline-block;
    flex: none;
    width: var(--toggle-width);
    height: var(--toggle-height);
    border-radius: var(--radius-full);
    background-color: var(--toggle-off);
    transition: background-color var(--dur-base) var(--ease-out);
  }

  .thumb {
    position: absolute;
    top: calc((var(--toggle-height) - var(--toggle-thumb)) / 2);
    left: calc((var(--toggle-height) - var(--toggle-thumb)) / 2);
    width: var(--toggle-thumb);
    height: var(--toggle-thumb);
    border-radius: var(--radius-full);
    background-color: var(--toggle-knob);
    box-shadow: var(--sh-knob);
    transition: transform var(--dur-slow) var(--ease-out);
  }

  .toggle:not([aria-disabled='true']):hover .track {
    background-color: var(--toggle-off-hover);
    transition-duration: var(--dur-hover);
  }

  .toggle[aria-checked='true'] .track {
    background-color: var(--toggle-on);
  }

  .toggle[aria-checked='true']:not([aria-disabled='true']):hover .track {
    background-color: var(--toggle-on-hover);
  }

  .toggle[aria-checked='true'] .thumb {
    transform: translateX(var(--toggle-travel));
  }

  /* Pressed: the track darkens one more step than on hover, 60 ms, off and on alike. */
  :global(:where(:root:not([data-aux-press])))
    .toggle:not([aria-disabled='true']):active:hover
    .track {
    background-color: var(--toggle-off-press);
    transition-duration: var(--dur-instant);
  }

  :global(:where(:root:not([data-aux-press])))
    .toggle[aria-checked='true']:not([aria-disabled='true']):active:hover
    .track {
    background-color: var(--toggle-on-press);
  }

  .toggle[aria-disabled='true'] {
    cursor: default;
    opacity: var(--opacity-disabled);
  }
</style>
