<!--
  The card of a setup step (the round 10 draft): white, an edge, the popover's shadow, 20
  round, at most --setup-card wide and 16 in from the window's sides, centred a little above
  the middle of the window (the view scrolls when the window is lower than the card). Its
  head is centred: what stands at its top (`top`: the app's mark, a tile, the spinner, the
  full ring) centred in one slot of 56 on every step, so the heading 26/650 stands 20 below
  it wherever the step is (it takes the focus on every step, so a screen reader starts
  there), and the lead 15/22 muted. The body under it is left-aligned. The foot under a
  hairline: Zurück (ghost, with its arrow and words) at the left, the step's buttons at the
  right (`actions`, in the OS order the caller gives them; a ghost at their end hangs out like
  Zurück, so the words of both stand on the content's edges); a foot without Zurück centres
  its buttons (`centred`: the reading's Abbrechen). On a step longer than the window the foot
  sticks to the window's bottom edge, so its buttons stay in reach, and what the keyboard's focus,
  typing or a sentence brings into view stands above it (the view's scroll-padding, here while a
  card stands). No step dots.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import { t } from '$lib/i18n/t';
  import { enterStep } from '$lib/motion/enter';
  import type { Snippet } from 'svelte';

  interface Props {
    heading: string;
    lead: string;
    /** The way back (null: none). */
    onback?: (() => void) | null;
    /** The foot's buttons stand in its middle (no Zurück). */
    centred?: boolean;
    /** The heading's element (it takes the focus). */
    headingElement?: HTMLElement | null;
    top: Snippet;
    /** The step's body under the head (none: the head says it all). */
    body?: Snippet | null;
    actions?: Snippet | null;
    /** The way the step came (Weiter or Zurück; null: the first step): its content slides in
     *  from that side while the card itself stays, so nothing blinks between steps. */
    forward?: boolean | null;
  }

  let {
    heading,
    lead,
    onback = null,
    centred = false,
    headingElement = $bindable(null),
    top,
    body = null,
    actions = null,
    forward = null,
  }: Props = $props();
</script>

<div class="frame">
  <div class="card">
    <div class="content" use:enterStep={{ forward }}>
      <header class="head">
        <span class="top">{@render top()}</span>
        <h1
          class="title"
          id="first-step-heading"
          tabindex="-1"
          bind:this={headingElement}
          data-testid="first-heading"
        >
          <span data-heading>{heading}</span>
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
</div>

<style>
  /* What comes into view stands 8 above the foot that sticks over the view (its height in a wide
     card; a narrow card's is a little lower). */
  :global(.view):has(.frame) {
    scroll-padding-bottom: calc(
      var(--setup-foot-pad) + var(--control-field) + var(--setup-foot-end) + var(--border-width) +
        var(--space-8)
    );
  }

  /* The window's cream around the card, 16 from the window's sides with the scrollbar's room
     counted in. Its top stays put from step to step (where a card of the usual height would stand
     a little above the middle), so a shorter or taller step only moves the card's foot, never its
     head. */
  .frame {
    container: setup / inline-size;
    display: grid;
    place-items: start center;
    padding: var(--setup-frame-top) var(--page-side-narrow-end) var(--setup-frame-bottom);
  }

  .content {
    display: flex;
    flex-direction: column;
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--setup-card);
    padding: var(--setup-pad-top) var(--setup-pad-x) 0;
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

  /* One slot for every step's mark, so the heading never moves from step to step. */
  .top {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--setup-top);
    margin-bottom: var(--setup-top-gap);
  }

  .title {
    color: var(--text-heading);
    font: var(--type-display);
    letter-spacing: var(--tracking-display);
    outline: none;
  }

  .lead {
    max-width: var(--setup-lead-max);
    margin-top: var(--setup-lead-gap);
    color: var(--text-muted);
    font: var(--type-lead);
    text-wrap: balance;
  }

  .body {
    display: flex;
    flex-direction: column;
    margin-top: var(--setup-body-gap);
  }

  /* The card's bottom padding is the foot's, so the foot keeps it while it sticks to the
     window's bottom edge (a step longer than the window); the content goes under it. */
  .foot {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
    margin-top: var(--setup-foot-gap);
    padding: var(--setup-foot-pad) 0 var(--setup-foot-end);
    border-top: var(--border-width) solid var(--border);
    background-color: var(--surface);
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

  /* A ghost at the end ("Überspringen") hangs out as far as Zurück does at the start: the
     words of both stand the same way in from the card's sides. */
  .actions > :global(.btn.ghost:last-child) {
    margin-right: var(--setup-back-pull);
  }

  @container setup (width < 600px) {
    .card {
      padding: var(--setup-pad-top-narrow) var(--setup-pad-x-narrow) 0;
    }

    .foot {
      --setup-foot-end: var(--setup-pad-bottom-narrow);
    }
  }
</style>
