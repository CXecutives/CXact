<!--
  "So liest die App dein Profil", the last block of the form (a heading and a card like the
  others): what the engine reads in the file, which explains the Suchbegriffe of the head.
  The Suchbegriffe themselves (the first 40), where in the file they come from (also parts
  the form does not show, such as career stations) and its specialist vocabulary. What the
  form shows anyway is not said again: the years only while the form's field is empty, the
  degrees only those the form lacks. While the form holds changes its sentence says that
  this reading does not include them.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { formatNumber } from '$lib/i18n/format';
  import type { ProfileForm, ProfileUnderstanding } from '$lib/ipc/types';
  import ProfileSection from './ProfileSection.svelte';

  interface Props {
    understood: ProfileUnderstanding;
    /** The form as it is. */
    form: ProfileForm;
    /** The form holds changes this reading does not know yet. */
    stale: boolean;
  }

  let { understood, form, stale }: Props = $props();

  const words = $derived(t.profile.reading);

  /** Parts of the file the form shows (the others are said to be only in the file). */
  const FORM_KEYS = new Set([
    'titel',
    'kernkompetenzen',
    'methoden_tools',
    'zertifizierungen',
    'branchen',
    'sprachen',
    'alleinstellungsmerkmale',
    'keywords',
    'abschluss',
    'ausbildung',
    'schwerpunkte',
  ]);

  /** `stationen[].schwerpunkte[]` -> `stationen`. */
  const topKey = (path: string): string => path.split(/[[.]/)[0] ?? path;

  /** The parts of the file by name, each once, with the number of terms read there. */
  const sources = $derived.by(() => {
    const parts: { name: string; count: number; file: boolean }[] = [];
    for (const source of understood.sources) {
      const key = topKey(source.path);
      const name = words.source[key] ?? key;
      const part = parts.find((each) => each.name === name);
      if (part) part.count += source.count;
      else parts.push({ name, count: source.count, file: !FORM_KEYS.has(key) });
    }
    return parts.map((part) => {
      const text = `${part.name} ${formatNumber(part.count)}`;
      return part.file ? words.fileOnly(text) : text;
    });
  });

  const more = $derived(Math.max(0, understood.competenceCount - understood.competences.length));
  const packs = $derived(understood.packs.map((pack) => t.profile.pack[pack] ?? pack));
  const years = $derived(form.years === null ? understood.years : null);
  const degrees = $derived(
    understood.degrees.filter(
      (degree) => !form.degrees.some((own) => own.trim().toLowerCase() === degree.toLowerCase()),
    ),
  );
</script>

<ProfileSection
  heading={t.profile.section.understood}
  hint={stale ? words.stale : t.profile.sectionHint.understood}
  testid="section-understood"
>
  <div class="body" data-testid="profile-reading">
    <dl class="facts">
      {#if understood.competences.length > 0}
        <dt>{words.termsLabel}</dt>
        <dd data-testid="reading-list">
          <span data-copy>{understood.competences.join(' · ')}</span>
          {#if more > 0}<span class="more">{words.more(more)}</span>{/if}
        </dd>
      {/if}
      {#if sources.length > 0}
        <dt>{words.sources}</dt>
        <dd data-testid="reading-sources">{sources.join(' · ')}</dd>
      {/if}
      {#if years !== null}
        <dt>{words.years}</dt>
        <dd data-testid="reading-years">{words.yearsValue(years)}</dd>
      {/if}
      {#if degrees.length > 0}
        <dt>{words.degrees}</dt>
        <dd data-copy data-testid="reading-degrees">{degrees.join(' · ')}</dd>
      {/if}
      {#if packs.length > 0}
        <dt>{words.packs}</dt>
        <dd data-testid="reading-packs">{packs.join(' · ')}</dd>
      {/if}
    </dl>
  </div>
</ProfileSection>

<style>
  .body {
    display: flex;
    flex-direction: column;
  }

  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-8) var(--space-16);
    color: var(--text);
    font: var(--type-sm);
  }

  dt {
    color: var(--text-muted);
  }

  .more {
    margin-left: var(--space-4);
    color: var(--text-muted);
  }
</style>
