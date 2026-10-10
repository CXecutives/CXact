<!--
  A job at a glance: a building and the company, a map pin and the place (without the work
  mode a portal appends to it, lib/place.ts), and when the ad states it the pay in the
  reader's money form ("1.250 €/Tag", "95.000 €/Jahr": employment its salary, any other job
  its day or hour rate). One line in the list's row, where the company gives way first and the
  pay is never cut; under the title of the job view, where the line may wrap (`wrap`). The
  glyphs are the small ones of a row's second line (design round 7).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { JobView } from '$lib/ipc/types';
  import { placeOf } from '$lib/place';
  import Icon from './Icon.svelte';

  interface Props {
    job: JobView;
    /** The test ids' prefix (`row`, `reader`). */
    prefix: string;
    /** Under the job view's title: the parts wrap instead of being cut. */
    wrap?: boolean;
  }

  let { job, prefix, wrap = false }: Props = $props();

  /** The pay the ad states; null when it names none. */
  function payOf(job: JobView): string | null {
    const facts = job.match?.facts ?? null;
    if (facts === null) return null;
    if (facts.contract === 'permanent' || facts.contract === 'anue') {
      return facts.salary === undefined
        ? null
        : t.facts.pay(facts.salary, 'year', null, facts.salaryLowerBound === true);
    }
    if (facts.rate === null) return null;
    return t.facts.pay(facts.rate, facts.hourly === true ? 'hour' : 'day', facts.currency);
  }

  const place = $derived(placeOf(job.location));
  const pay = $derived(payOf(job));
</script>

<span class="meta" class:wrap data-testid="{prefix}-meta">
  {#if job.company}<span class="part company" data-testid="{prefix}-company"
      ><Icon name="company" size="xs" /><span class="text" data-copy={wrap ? '' : undefined}
        >{job.company}</span
      ></span
    >{/if}
  {#if place}<span class="part place" data-testid="{prefix}-place"
      ><Icon name="place" size="xs" /><span class="text" data-copy={wrap ? '' : undefined}
        >{place}</span
      ></span
    >{/if}
  {#if pay}<span class="part pay" data-testid="{prefix}-pay"><span class="text">{pay}</span></span
    >{/if}
</span>

<style>
  /* One line, each part with its glyph; where it is short the company gives way (an
     ellipsis), the place stays whole up to --row-place-max, the pay always. */
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-10);
    min-width: 0;
    height: var(--leading-sm);
    overflow: hidden;
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .part {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .part.place {
    flex: none;
    max-width: var(--row-place-max);
  }

  /* The pay is short and never cut. */
  .part.pay {
    flex: none;
  }

  .part :global(.icon) {
    flex: none;
    color: var(--text-subtle);
  }

  /* Under the job view's title: the parts wrap, nothing is cut. */
  .wrap {
    flex-wrap: wrap;
    row-gap: var(--space-2);
    height: auto;
    overflow: visible;
  }

  .wrap .part.place {
    max-width: none;
  }

  .wrap .text {
    white-space: normal;
  }
</style>
