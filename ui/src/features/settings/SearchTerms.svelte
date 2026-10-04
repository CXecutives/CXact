<!--
  "CXact sucht nach" in Einstellungen > Portale: the terms the search asks every portal for
  (from the profile, in the search's order, `search_terms`), each with what it brought in the
  last search ("zuletzt 3 passende") or "neu" before its first, each a small bordered box in
  rows that wrap ("Im Profil ändern" stands at the heading's end, SettingsView). Without a usable profile one
  sentence and "Profil anlegen". Asked again whenever the app state changes (a save of the
  profile, a finished search); the last answer stays for the next visit, so the page never
  grows under a kept scroll place.
-->
<script lang="ts" module>
  import type { SearchTerm } from '$lib/ipc/api';

  /** The last answer, kept while the app runs. */
  const known = $state<{ terms: SearchTerm[] }>({ terms: [] });
</script>

<script lang="ts">
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Notice from '$components/Notice.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke } from '$lib/ipc/api';
  import { app } from '$lib/state/app.svelte';
  import { navigation } from '$lib/state/navigation.svelte';

  const terms = $derived(known.terms);
  let error = $state<(() => string) | null>(null);

  /** The latest question wins: an older answer that comes late is dropped. */
  let asking = 0;
  $effect(() => {
    if (app.state === null || !app.hasProfile) return;
    const mine = ++asking;
    invoke('search_terms', {}).then(
      (answer) => {
        if (mine !== asking) return;
        known.terms = answer;
        error = null;
      },
      (failure: unknown) => {
        if (mine === asking) error = () => errorText(failure);
      },
    );
  });
</script>

<Card padding="md" testid="search-terms">
  {#if !app.hasProfile}
    <div class="none">
      <p class="text">{t.settings.noTerms}</p>
      <Button
        variant="secondary"
        icon="add"
        label={t.list.createProfile}
        testid="terms-create-profile"
        onclick={() => navigation.go('profile')}
      />
    </div>
  {:else}
    {#if terms.length > 0}
      <ul class="terms" aria-label={t.settings.terms}>
        {#each terms as term (term.term)}
          <li class="term" data-testid="search-term">
            <span class="word" data-copy>{term.term}</span>
            <span class="yield"
              >{term.matched === null
                ? t.settings.termNew
                : t.settings.termMatched(term.matched)}</span
            >
          </li>
        {/each}
      </ul>
    {/if}
    {#if error}
      <Notice tone="danger" variant="inline" text={error()} testid="terms-error" />
    {/if}
  {/if}
</Card>

<style>
  .none {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-12);
  }

  .text {
    color: var(--text-muted);
    font: var(--type-body);
  }

  /* Small bordered boxes in rows that wrap; each term with its yield quietly after it. */
  .terms {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-8);
  }

  .term {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
    max-width: 100%;
    padding: var(--space-4) var(--space-12);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-sm);
  }

  .word {
    overflow: hidden;
    color: var(--text);
    font: var(--type-md);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .yield {
    flex: none;
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }
</style>
