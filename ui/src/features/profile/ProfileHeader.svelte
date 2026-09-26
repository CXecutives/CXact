<!--
  The head of the Profil view: the person (name and role, copyable; the file name as the
  tooltip) with the time of the last save, or the draft; how well the form reads (an honest
  badge, following the form while it changes: "Vollständig" only with competences and nothing
  to check, else "Wenig Inhalt" or "Ohne Kompetenzen", which says the thin profile in this
  one place, its tooltip why); "n Werte prüfen" while values of the file do not read (or a
  rule stays off), a click goes to the first one; one quiet stats line ("42 Suchbegriffe ·
  2 Schwerpunkte"); keys the app does not read; the rescore a save starts; and the actions:
  one main button (an update from a CV, or for a new form one from a CV) and the "…" menu of
  the app with the rest (another file, the profile folder, remove; remove at once, the toast
  offers Rückgängig). While the form holds changes, what would replace them waits and says
  "Erst speichern oder verwerfen." While the stored file does not read, a new form says that
  saving replaces that file and keeps its folder at hand. Drafts say once that they are to be
  reviewed.
-->
<script lang="ts">
  import Badge, { type BadgeTone } from '$components/Badge.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import IconTile from '$components/IconTile.svelte';
  import Notice from '$components/Notice.svelte';
  import Spinner from '$components/Spinner.svelte';
  import { t } from '$lib/i18n/t';
  import { formatDate, formatMoment, formatTime } from '$lib/i18n/format';
  import { warningText } from '$lib/i18n/texts';
  import type { Notice as NoticeData, ProfileInfo, ProfileQuality } from '$lib/ipc/types';
  import { menuState, openMenu, type MenuEntry } from '$lib/state/menu.svelte';
  import type { DraftOrigin } from '$lib/state/profile.svelte';

  interface Props {
    origin: DraftOrigin;
    profile: ProfileInfo | null;
    /** How well the form as it is reads. */
    quality: ProfileQuality | null;
    /** The form has competences ("Vollständig" needs them). */
    competences: boolean;
    /** Suchbegriffe (the engine's count, moved by the changes of the form). */
    terms: number | null;
    /** Schwerpunkte of the form. */
    focus: number;
    /** What is still to check, each in one sentence (the tooltip of "n Werte prüfen"). */
    checks: readonly string[];
    /** Warnings said here: what the form cannot change (keys the app does not read). */
    warnings: readonly NoticeData[];
    rescoring: boolean;
    /** Unsaved changes: another file or an update would replace them. */
    dirty: boolean;
    picking: boolean;
    note: string | null;
    onpick: () => void;
    onremove: () => void;
    onfromcv: () => void;
    onopenfolder: () => void;
    /** "n Werte prüfen": the caret goes to the first one. */
    oncheck: () => void;
  }

  let {
    origin,
    profile,
    quality,
    competences,
    terms,
    focus,
    checks,
    warnings,
    rescoring,
    dirty,
    picking,
    note,
    onpick,
    onremove,
    onfromcv,
    onopenfolder,
    oncheck,
  }: Props = $props();

  const stored = $derived(origin === 'stored' && profile !== null);
  /** A new form for a stored file that does not read: saving replaces that file. */
  const replaces = $derived(origin === 'new' && (profile?.parseError ?? null) !== null);
  /** The badge: honest about competences; with values to check "n Werte prüfen" stands in
   *  place of "Vollständig". */
  const badge = $derived.by((): { label: string; tone: BadgeTone; hint: string | null } | null => {
    if (quality === null) return null;
    if (!competences || quality === 'empty') {
      return {
        label: t.profile.quality.empty,
        tone: quality === 'empty' ? 'danger' : 'warning',
        hint: t.profile.qualityText.empty,
      };
    }
    if (quality === 'thin') {
      return { label: t.profile.quality.thin, tone: 'warning', hint: t.profile.qualityText.thin };
    }
    if (checks.length > 0) return null;
    return { label: t.profile.quality.good, tone: 'success', hint: null };
  });
  /** One separator for the whole line: Suchbegriffe, Schwerpunkte. */
  const summary = $derived(
    terms === null
      ? null
      : [t.profile.understood(terms), focus > 0 ? t.profile.focusCount(focus) : '']
          .filter((part) => part !== '')
          .join(' · '),
  );
  const notes = $derived(
    warnings.flatMap((notice) => {
      const text = warningText(notice);
      return text === null ? [] : [text];
    }),
  );
  /** The person first: the name (the file name only as its tooltip), the role muted. */
  const person = $derived(profile?.form ?? null);
  /** When it was saved, in the format of every moment of the app (`21.09. 09:30`, the time
   *  alone today); a save of another year keeps its year. */
  function moment(iso: string): string {
    return new Date(iso).getFullYear() === new Date().getFullYear()
      ? formatMoment(iso)
      : `${formatDate(iso)} ${formatTime(iso)}`;
  }
  const savedAt = $derived(profile?.savedAt ? t.profile.savedAt(moment(profile.savedAt)) : null);

  // ------------------------------------------------------------------ the "…" menu
  let anchor = $state<HTMLElement | null>(null);
  let expanded = $state(false);

  /** What the menu holds: for the stored profile another file, its folder and remove; for a
   *  new form a file (and the folder of a file that does not read). */
  const entries = $derived.by((): MenuEntry[] => {
    const pick: MenuEntry = {
      id: 'pick',
      label: stored ? t.profile.pickOther : t.profile.pick,
      icon: 'file-up',
      disabled: dirty,
      reason: dirty ? t.profile.saveFirst : null,
      run: onpick,
    };
    const folder: MenuEntry = {
      id: 'folder',
      label: t.common.openFolder,
      icon: 'folder-open',
      run: onopenfolder,
    };
    if (!stored) return replaces ? [pick, folder] : [pick];
    return [
      pick,
      folder,
      { kind: 'separator' },
      { id: 'remove', label: t.profile.remove, icon: 'trash-2', danger: true, run: onremove },
    ];
  });

  /** The menu opens right below the button, its right edge on the button's. */
  function more(): void {
    if (anchor === null || menuState.open !== null) return;
    expanded = true;
    openMenu({
      label: t.profile.more,
      anchor: { kind: 'below', rect: anchor.getBoundingClientRect(), align: 'end' },
      entries,
      onclose: () => (expanded = false),
    });
  }
</script>

<Card padding="md" testid="profile-file">
  <div class="head">
    <div class="file">
      <IconTile tone="navy" icon="file-text" size="md" />
      <div class="facts">
        {#if stored && profile}
          <h2 class="name" data-copy use:tooltip={profile.fileName}>
            <span data-testid="profile-name">{person?.name || t.profile.unnamed}</span>
            {#if person?.title}<span class="role" data-testid="profile-role">{person.title}</span
              >{/if}
          </h2>
          {#if savedAt}<p class="meta" data-testid="profile-saved-at">{savedAt}</p>{/if}
        {:else}
          <h2 class="name" data-testid="profile-name">
            {t.profile.draft[origin === 'stored' ? 'new' : origin]}
          </h2>
        {/if}
      </div>
      {#if badge}
        <span class="quality" data-testid="profile-quality">
          <Badge label={badge.label} tone={badge.tone} hint={badge.hint} />
        </span>
      {/if}
      {#if checks.length > 0}
        <!-- Its tooltip names the values, a click goes to the first. -->
        <span class="check" use:tooltip={checks.join(' ')}>
          <Button
            variant="ghost"
            size="sm"
            icon="triangle-alert"
            label={t.profile.check(checks.length)}
            testid="profile-check"
            onclick={oncheck}
          />
        </span>
      {/if}
    </div>

    {#if summary}
      <p class="summary" data-testid="profile-understood">{summary}</p>
    {/if}
    {#each notes as text, index (index)}
      <Notice tone="info" variant="inline" {text} testid="profile-warning" />
    {/each}
    {#if origin === 'file' || origin === 'answer' || origin === 'update'}
      <Notice tone="info" variant="inline" text={t.profile.review} testid="profile-review" />
    {/if}
    {#if replaces}
      <Notice tone="info" variant="inline" text={t.profile.replaces} testid="profile-replaces" />
    {/if}
    {#if rescoring}
      <p class="status" data-testid="profile-rescoring">
        <Spinner size="sm" label={null} />{t.profile.rescoring(profile?.pending ?? 0)}
      </p>
    {/if}

    {#if stored || origin === 'new'}
      <div class="actions">
        <Button
          variant="secondary"
          size="field"
          icon="clipboard-paste"
          label={stored ? t.profile.updateFromCv : t.profile.fromCv}
          disabled={dirty}
          disabledReason={t.profile.saveFirst}
          testid={stored ? 'profile-update-cv' : 'profile-from-cv'}
          onclick={onfromcv}
        />
        <span class="more" bind:this={anchor}>
          <Button
            variant="secondary"
            size="field"
            iconOnly
            icon="ellipsis"
            label={t.profile.more}
            menu
            {expanded}
            loading={picking}
            testid="profile-more"
            onclick={more}
          />
        </span>
      </div>
    {/if}
    {#if note}
      <Notice tone="danger" variant="inline" text={note} testid="profile-note" />
    {/if}
  </div>
</Card>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .file {
    display: flex;
    align-items: center;
    gap: var(--space-12);
  }

  .facts {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  /* The badge's box, no line around it (it stays centred on the person). */
  .quality,
  .check,
  .more {
    display: flex;
  }

  /* The ghost button's text ends on the card's edge, like the badge. */
  .check {
    margin-right: calc(-1 * var(--ghost-inset));
  }

  .role {
    margin-left: var(--space-8);
    color: var(--text-muted);
    font: var(--type-md);
  }

  .name {
    overflow: hidden;
    color: var(--text-heading);
    font: var(--type-lg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta,
  .summary {
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
  }

  .summary {
    padding-top: var(--space-12);
    border-top: var(--border-width) solid var(--border);
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }
</style>
