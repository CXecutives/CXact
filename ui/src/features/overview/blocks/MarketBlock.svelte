<!--
  The market of the last 30 days, every row over the same days: the jobs per portal (the
  enabled ones, in the app's one order), the median day rate of fitting jobs beside the
  profile's minimum, the share of mostly remote jobs.
-->
<script lang="ts">
  import { formatEuro } from '$lib/i18n/format';
  import { t } from '$lib/i18n/t';
  import { app } from '$lib/state/app.svelte';
  import { overview } from '../model.svelte';
  import Block from './Block.svelte';

  const market = $derived(overview.stats?.market ?? null);
  const perPortal = $derived(
    (market?.newByPortal ?? []).filter((p) => p.count > 0 && overview.portals.includes(p.portal)),
  );
  const minRate = $derived(app.state?.profile?.form?.criteria.minDayRate ?? null);
  const rateLine = $derived(
    market?.medianDayRate == null
      ? ''
      : [
          t.overview.marketRateValue(formatEuro(market.medianDayRate), market.rateCount),
          minRate === null ? null : t.overview.marketMin(formatEuro(minRate)),
        ]
          .filter(Boolean)
          .join(' · '),
  );
</script>

{#if market !== null}
  <Block testid="market" heading={t.overview.market}>
    <dl class="terms">
      {#if perPortal.length > 0}
        <dt>{t.overview.marketNew}</dt>
        <dd data-testid="market-new">
          {perPortal.map((p) => `${t.portal[p.portal]} ${p.count}`).join(' · ')}
        </dd>
      {/if}
      {#if market.medianDayRate !== null}
        <dt>{t.overview.marketRate}</dt>
        <dd data-testid="market-rate">{rateLine}</dd>
      {/if}
      {#if market.remoteShare !== null}
        <dt>{t.overview.marketRemote}</dt>
        <dd data-testid="market-remote">
          {t.overview.marketRemoteValue(market.remoteShare, market.remoteKnown)}
        </dd>
      {/if}
    </dl>
  </Block>
{/if}

<style>
  /* Like the reader's Konditionen: the name, its value. */
  .terms {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-8) var(--space-16);
    margin: 0;
    font: var(--type-sm);
  }

  .terms dt {
    color: var(--text-muted);
  }

  .terms dd {
    margin: 0;
  }
</style>
