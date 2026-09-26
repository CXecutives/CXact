<!--
  "So liest die App dein Profil", the last block of the form (a heading and a card like the
  others): what the engine reads in the file, which explains the Suchbegriffe of the head.
  The Suchbegriffe themselves (the first 40), where in the file they come from (also parts
  the form does not show, such as career stations), the years and degrees it found, its
  specialist vocabulary and the conditions it applies. While the form holds changes its
  sentence says that this is the saved profile.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { formatEuro, formatNumber } from '$lib/i18n/format';
  import type { Notice, ProfileUnderstanding } from '$lib/ipc/types';
  import { shownDate } from '$lib/state/profile.svelte';
  import ProfileSection from './ProfileSection.svelte';

  interface Props {
    understood: ProfileUnderstanding;
    /** The form holds changes this reading does not know yet. */
    stale: boolean;
  }

  let { understood, stale }: Props = $props();

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

  const str = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : '';

  /** The form's label of each criterion (the one word for it on this page); the contract
   *  types keep their name, their value says "ausgeschlossen". */
  const FIELD: Record<string, string> = $derived({
    minDayRate: t.profile.field.minDayRate,
    countries: t.profile.field.countries,
    availability: t.profile.field.available,
    minSalary: t.profile.field.minSalary,
    permanentRegion: t.profile.field.places,
    targetYears: t.profile.field.targetYears,
  });

  /** A set criterion as the engine applies it: its name and its value. */
  function criterion(notice: Notice): { label: string; value: string } | null {
    const p = notice.params;
    if (p.set !== true) return null;
    const key = notice.code as keyof typeof t.reader.criterion;
    const label = FIELD[notice.code] ?? t.reader.criterion[key]?.label ?? notice.code;
    switch (notice.code) {
      case 'minDayRate':
      case 'minSalary':
        return { label, value: words.from(formatEuro(Number(p.min))) };
      case 'countries':
        return {
          label,
          value: str(p.countries)
            .split(',')
            .map((code) => code.trim())
            .map((code) => t.profile.country[code] ?? code)
            .join(', '),
        };
      case 'noAnue':
      case 'noPermanent':
        return { label, value: words.excluded };
      case 'availability':
        return {
          label,
          value: p.from === 'now' ? t.profile.availability.now : shownDate(str(p.from)),
        };
      case 'permanentRegion':
        return { label, value: str(p.places) };
      case 'targetYears':
        return { label, value: words.yearsFrom(Number(p.min)) };
      default:
        return { label, value: '' };
    }
  }

  const criteria = $derived(
    understood.criteria.flatMap((notice) => {
      const row = criterion(notice);
      return row === null ? [] : [row];
    }),
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
      {#if understood.years !== null}
        <dt>{words.years}</dt>
        <dd>{words.yearsValue(understood.years)}</dd>
      {/if}
      {#if understood.degrees.length > 0}
        <dt>{words.degrees}</dt>
        <dd data-copy>{understood.degrees.join(' · ')}</dd>
      {/if}
      {#if packs.length > 0}
        <dt>{words.packs}</dt>
        <dd>{packs.join(' · ')}</dd>
      {/if}
      <dt>{words.criteria}</dt>
      <dd data-testid="reading-criteria">
        {#if criteria.length === 0}
          {words.none}
        {:else}
          <ul class="criteria">
            {#each criteria as row (row.label)}
              <li><span class="criterion">{row.label}</span> {row.value}</li>
            {/each}
          </ul>
        {/if}
      </dd>
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

  .criteria {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .criterion {
    color: var(--text-muted);
  }
</style>
