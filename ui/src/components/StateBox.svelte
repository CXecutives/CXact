<!--
  The state of something in a box (the round 10 draft): a job in the job view (not loaded yet,
  loading, being scored, excluded, a preview, gone, closed), the list without a profile, a
  failure of the Profil's CV. The cream ground with a hairline, 10 round, 12 20 inside
  (its words start and its button ends where a card's rows do) and at least 56 high: its title (14/540 ink), one quiet sentence under it (13 muted), and
  its one button at the right end (`action`, a secondary button with its glyph, or a button of
  its own in that place: `end`), pressed but not focused (`data-press-only`, input.ts). No sign:
  the state's mark is elsewhere (the ring) or none;
  only while something is being done a 16 px spinner stands before the words (`busy`). A box
  that appears in a view already on screen rises 2 px and fades in (150 ms) and fades out
  (100 ms); one that comes with its view is simply there. In a box under 480 wide (like a row of
  Einstellungen) the button goes under the words, at the right, so a title keeps its one line.
  The words of a box that says something went wrong (`alert`) copy.
-->
<script lang="ts" module>
  import type { IconName } from './Icon.svelte';

  /** The one button of a state box. */
  export interface StateAction {
    label: string;
    icon?: IconName | null;
    testid?: string | null;
    onclick: () => void;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, rise } from '$lib/motion/transitions';
  import Button from './Button.svelte';
  import Spinner from './Spinner.svelte';

  interface Props {
    /** Something is being done: the spinner before the words. */
    busy?: boolean;
    /** The title. */
    heading?: string | null;
    /** The sentence under the title. */
    text?: string | null;
    action?: StateAction | null;
    /** A button of its own in the action's place (one that waits or loads). */
    end?: Snippet | null;
    /** It says something went wrong (announced at once). */
    alert?: boolean;
    testid?: string | null;
    headingTestid?: string | null;
    textTestid?: string | null;
  }

  let {
    busy = false,
    heading = null,
    text = null,
    action = null,
    end = null,
    alert = false,
    testid = null,
    headingTestid = null,
    textTestid = null,
  }: Props = $props();
</script>

<div
  class="box"
  role={alert ? 'alert' : 'status'}
  data-testid={testid ?? undefined}
  in:rise={{ distance: 'sm' }}
  out:fade
>
  <div class="row">
    {#if busy}
      <Spinner size="sm" label={null} />
    {/if}
    <div class="words">
      {#if heading}<p
          class="title"
          data-copy={alert ? '' : undefined}
          data-testid={headingTestid ?? undefined}
        >
          {heading}
        </p>{/if}
      {#if text}
        <p class="text" data-copy={alert ? '' : undefined} data-testid={textTestid ?? undefined}>
          {text}
        </p>
      {/if}
    </div>
    {#if end}
      <span class="action" data-press-only>{@render end()}</span>
    {:else if action}
      <span class="action" data-press-only>
        <Button
          variant="secondary"
          label={action.label}
          icon={action.icon ?? null}
          testid={action.testid ?? null}
          onclick={action.onclick}
        />
      </span>
    {/if}
  </div>
</div>

<style>
  .box {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: var(--state-min);
    padding: var(--state-pad-y) var(--state-pad-start);
    border: var(--border-width) solid var(--state-edge);
    border-radius: var(--radius-lg);
    background-color: var(--state-surface);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--state-gap);
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    color: var(--text);
    font: var(--type-label);
  }

  .text {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .action {
    display: flex;
    flex: none;
    align-items: center;
  }

  /* A narrow box: the button on a line of its own under the words, at the right; a spinner
     stays beside the words. */
  @container (width < 480px) {
    .row {
      flex-wrap: wrap;
      row-gap: var(--space-8);
    }

    .action {
      flex-basis: 100%;
      justify-content: flex-end;
    }
  }
</style>
