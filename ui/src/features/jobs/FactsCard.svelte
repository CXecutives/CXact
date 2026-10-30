<!--
  "Jobdetails" (the round 10 draft): the facts of the job in two columns (one where the card is
  narrower than 560 px), in the order of the facts table (lib/facts.ts, read by terms.ts). A
  fact is its label (96, muted, no icon) and its value (14, copyable, ink). A fact that fits
  the profile carries no mark; one that does not fully fit (in part, not, unclear) carries its
  verdict's icon in the colours of the rings 6 after its value's last word (owner, 2026-10-28:
  the eye goes to what does not fit). The contact (its name, e-mail and phone one under the
  other) spans both columns and comes last, so the rows above it pair up; its e-mail writes a
  new mail to it, the job's title its subject. A hairline between the rows, none after the
  last, like every box of rows.
  A deadline within a week, or past, is red. Rows that arrive later (the ad loaded) fade in.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import ReasonItem from '$components/ReasonItem.svelte';
  import { t } from '$lib/i18n/t';
  import { fade } from '$lib/motion/transitions';
  import { kindOf } from './reader-sections';
  import type { TermRow } from './terms';

  interface Props {
    rows: readonly TermRow[];
    /** A new mail to the contact's e-mail. */
    onmail: () => void;
  }

  let { rows, onmail }: Props = $props();
</script>

<Card heading={t.reader.details} testid="terms">
  <div class="room">
    <ul class="facts" aria-label={t.reader.details} data-testid="criteria">
      {#each rows as row (row.key)}
        <li
          class="fact"
          class:wide={row.key === 'contact'}
          data-row={row.key}
          data-verdict={row.verdict ?? undefined}
          data-testid="term-{row.key}"
          in:fade
        >
          <span class="term-name">{row.name}</span>
          <span class="term-line">
            {#if row.parts}
              <span class="parts">
                {#each row.parts as part, index (index)}{#if part === row.mail}<span class="mail"
                      ><Button
                        variant="link"
                        label={part}
                        testid="contact-mail"
                        onclick={onmail}
                      /></span
                    >{:else}<span class="value" data-copy>{part}</span>{/if}{/each}
              </span>
            {:else}
              <span
                class="value"
                class:missing={row.missing}
                class:urgent={row.urgent}
                data-copy={row.missing ? null : ''}>{row.value}</span
              >
            {/if}{#if row.note}<span class="term-note">{row.note}</span
              >{/if}{#if row.verdict !== null && row.verdict !== 'met'}<span
                class="verdict"
                data-testid="verdict"
                data-verdict={row.verdict}
                ><ReasonItem
                  iconOnly
                  kind={row.excludes ? 'violation' : kindOf(row.verdict)}
                  label={row.excludes ? t.score.excluded : t.reader.verdict[row.verdict]}
                /></span
              >{/if}
          </span>
        </li>
      {/each}
    </ul>
  </div>
</Card>

<style>
  /* The first fact 12 under the title and the last 18 above the card's end, like the other
     cards (the facts bring 8 each); the card's width decides their columns. */
  .room {
    container-type: inline-size;
    margin-top: var(--facts-top);
    margin-bottom: calc(-1 * var(--space-8));
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--space-20);
  }

  /* The label and the value with its mark; both on the fact's first line. */
  .fact {
    display: grid;
    grid-template-columns: var(--facts-label) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-6);
    padding: var(--space-8) 0;
    font: var(--type-md);
  }

  /* Lines only between rows. */
  .fact:nth-child(n + 3) {
    border-top: var(--border-width) solid var(--border);
  }

  .fact.wide {
    grid-column: 1 / -1;
  }

  .term-name {
    color: var(--text-muted);
  }

  /* The value, its quiet note and its mark in the flow of its words: the mark follows the
     last word when the value wraps. */
  .term-line {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .value {
    color: var(--text);
  }

  .value.missing,
  .term-note {
    color: var(--text-subtle);
  }

  .term-note {
    margin-inline-start: var(--space-6);
  }

  .value.urgent {
    color: var(--danger-strong);
  }

  /* The parts of the contact, one under the other, each copied on its own. */
  .parts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  /* The e-mail as a link keeps its hit area but not its height: the line stays a line of
     text. */
  .mail {
    display: inline-flex;
    margin-block: calc((var(--leading-md) - var(--control-sm)) / 2);
  }

  .mail :global(.btn.link) {
    --btn-type: var(--type-md);
  }

  /* The mark 6 after the words, centred on their line without making it taller. */
  .verdict {
    display: inline-flex;
    margin-block: calc((var(--leading-md) - var(--icon-sm)) / 2);
    margin-inline-start: var(--space-6);
    vertical-align: top;
  }

  @container (width < 560px) {
    .facts {
      grid-template-columns: minmax(0, 1fr);
    }

    .fact + .fact {
      border-top: var(--border-width) solid var(--border);
    }
  }
</style>
