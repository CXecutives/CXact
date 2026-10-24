<!--
  "Jobdetails" (the round 10 draft): the facts of the job in two columns (one where the card is
  narrower than 560 px), in the order of the facts table (lib/facts.ts, read by terms.ts). A
  fact is its label (96, muted, no icon), its value (14, copyable) and, at its end, an 18 px
  column for the verdict, an icon in the colours of the rings; a value without a verdict takes
  that column too. The contact (its name, e-mail and phone one under the other) spans both
  columns; its e-mail writes a new mail to it, the job's title its subject. A hairline under
  each fact starts at its label; the last line's is cut by the card. "Gefunden" stays quiet.
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
  <div class="clip">
    <ul class="facts" aria-label={t.reader.details} data-testid="criteria">
      {#each rows as row (row.key)}
        <li
          class="fact"
          class:wide={row.key === 'contact'}
          data-row={row.key}
          data-testid="term-{row.key}"
          in:fade
        >
          <span class="term-name">{row.name}</span>
          <span class="term-line" class:spans={row.verdict === null}>
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
                class:quiet={row.key === 'portal'}
                class:urgent={row.urgent}
                data-copy={row.missing ? null : ''}>{row.value}</span
              >
            {/if}
            {#if row.note}<span class="term-note">{row.note}</span>{/if}
          </span>
          {#if row.verdict}
            <span class="verdict" data-testid="verdict" data-verdict={row.verdict}>
              <ReasonItem
                iconOnly
                kind={row.excludes ? 'violation' : kindOf(row.verdict)}
                label={row.excludes ? t.score.excluded : t.reader.verdict[row.verdict]}
              />
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </div>
</Card>

<style>
  /* Cuts the hairline under the last line of facts. */
  .clip {
    container-type: inline-size;
    margin-top: var(--facts-top);
    overflow: hidden;
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--space-20);
    margin-bottom: calc(-1 * var(--border-width));
  }

  /* Label, value and the verdict's column; every part on the fact's first line. */
  .fact {
    display: grid;
    grid-template-columns: var(--facts-label) minmax(0, 1fr) var(--facts-mark);
    align-items: start;
    gap: var(--space-6);
    padding: var(--space-8) 0;
    border-bottom: var(--border-width) solid var(--border);
    font: var(--type-md);
  }

  .fact.wide {
    grid-column: 1 / -1;
  }

  .term-name {
    color: var(--text-muted);
  }

  .term-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* No verdict: the value takes its column. */
  .term-line.spans {
    grid-column: 2 / -1;
  }

  .value {
    color: var(--text);
  }

  .value.missing,
  .term-note {
    color: var(--text-subtle);
  }

  /* How and when the job came: quieter than what the ad says. */
  .value.quiet {
    color: var(--text-muted);
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

  /* The icon centred on the fact's first line. */
  .verdict {
    display: inline-flex;
    justify-content: center;
    margin-top: calc((var(--leading-md) - var(--icon-sm)) / 2);
  }

  @container (width < 560px) {
    .facts {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
