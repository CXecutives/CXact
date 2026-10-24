<!--
  The card of a setup step (the round 10 draft): white, an edge, the popover's shadow, 20
  round, at most --setup-card wide and 16 in from the window's sides, centred a little above
  the middle of the window (the view scrolls when the window is lower than the card). Its
  head is centred: what stands at its top (`top`: the app's mark, a tile, the spinner, the
  green disc), the heading 26/650 (it takes the focus on every step, so a screen reader
  starts there) with an optional badge beside it ("Optional"), and the lead 15/22 muted. The
  body under it is left-aligned. The foot under a hairline: Zurück (ghost, with its arrow
  and words) at the left, the step's buttons at the right (`actions`, in the OS order the
  caller gives them); a foot without Zurück centres its buttons (`centred`: the reading's
  Abbrechen). No step dots.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import type { Snippet } from 'svelte';

  interface Props {
    heading: string;
    lead: string;
    badge?: string | null;
    /** Zurück (null: none). */
    onback?: (() => void) | null;
    /** The foot's buttons stand in its middle (no Zurück). */
    centred?: boolean;
    /** The heading's element (it takes the focus). */
    headingElement?: HTMLElement | null;
    top: Snippet;
    /** The step's body under the head (none: the head says it all). */
    body?: Snippet | null;
    actions?: Snippet | null;
  }

  let {
    heading,
    lead,
    badge = null,
    onback = null,
    centred = false,
    headingElement = $bindable(null),
    top,
    body = null,
    actions = null,
  }: Props = $props();
</script>

<div class="frame">
  <div class="card">
    <header class="head">
      {@render top()}
      <h1
        class="title"
        id="first-step-heading"
        tabindex="-1"
        bind:this={headingElement}
        data-testid="first-heading"
      >
        <span data-heading>{heading}</span>
        {#if badge}<span class="badge" data-testid="first-badge">{badge}</span>{/if}
      </h1>
      <p class="lead" data-testid="first-lead">{lead}</p>
    </header>
    {#if body}<div class="body">{@render body()}</div>{/if}
    <footer class="foot" class:centred data-testid="first-bar">
      {#if !centred}
        <span class="back">
          {#if onback}
            <Button
              variant="ghost"
              icon="back"
              label={t.common.back}
              testid="first-back"
              onclick={onback}
            />
          {/if}
        </span>
      {/if}
      {#if actions}<span class="actions">{@render actions()}</span>{/if}
    </footer>
  </div>
</div>

<style>
  /* The window's cream around the card; the card a little above the middle. */
  .frame {
    container: setup / inline-size;
    display: grid;
    place-items: center;
    padding: var(--space-16) var(--space-16) var(--setup-frame-bottom);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--setup-card);
    padding: var(--setup-pad-top) var(--setup-pad-x) var(--setup-pad-bottom);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sheet);
    background-color: var(--surface);
    box-shadow: var(--sh-pop);
  }

  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--setup-badge-gap);
    color: var(--text-heading);
    font: var(--type-display);
    letter-spacing: var(--tracking-display);
    outline: none;
  }

  .badge {
    padding: var(--setup-badge-pad);
    border-radius: var(--radius-inner);
    background-color: var(--surface-track);
    color: var(--text-muted);
    font: var(--setup-badge-type);
    letter-spacing: normal;
  }

  .lead {
    max-width: var(--setup-lead-max);
    margin-top: var(--setup-lead-gap);
    color: var(--text-muted);
    font: var(--type-lead);
  }

  .body {
    display: flex;
    flex-direction: column;
    margin-top: var(--setup-body-gap);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    min-height: calc(var(--setup-foot-pad) + var(--control-field) + var(--border-width));
    margin-top: var(--setup-foot-gap);
    padding-top: var(--setup-foot-pad);
    border-top: var(--border-width) solid var(--border);
  }

  .foot.centred {
    justify-content: center;
  }

  .back {
    display: flex;
    margin-left: var(--setup-back-pull);
  }

  .actions {
    --btn-min: var(--button-pair-min);

    display: flex;
    align-items: center;
    gap: var(--space-8);
  }

  @container setup (width < 600px) {
    .card {
      padding: var(--setup-pad-top-narrow) var(--setup-pad-x-narrow) var(--setup-pad-bottom-narrow);
    }
  }
</style>
