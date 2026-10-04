<!--
  "CXact sucht nach" in Einstellungen > Portale: the terms the search asks every portal for
  (from the profile, in the search's order, `search_terms`), each with what it brought in the
  last search ("zuletzt 3 passende") or "neu" before its first, in columns that wrap; under
  them "Im Profil ändern", the way to where they come from. Without a usable profile one
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
    <span class="edit">
      <Button
        variant="link"
        label={t.settings.editTerms}
        testid="terms-edit"
        onclick={() => navigation.go('profile')}
      />
    </span>
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

  /* Columns that wrap with the width; each term with its yield quietly after it. */
  .terms {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--terms-column), 1fr));
    gap: var(--space-8) var(--space-16);
  }

  .term {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
  }

  .word {
    overflow: hidden;
    color: var(--text);
    font: var(--type-body);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .yield {
    flex: none;
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  .edit {
    display: flex;
    margin-top: var(--space-12);
  }
</style>
