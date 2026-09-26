<!--
  The head of the Profil view. Its first line sits on the first row of the window
  (`data-first-row`, like the first heading of Übersicht and Einstellungen): the file's tile,
  the person (name and role, copyable; the file name as the tooltip) or the draft, how well
  the form reads (an honest badge that follows the form: "Vollständig" only with competences
  and nothing to check, else "Wenig Inhalt" or "Ohne Kompetenzen", red only when nothing at
  all can be scored, its tooltip why) and "n Werte prüfen" while values of the file do not
  read (a click goes to the first one). Under it a card: when it was saved and how many
  Suchbegriffe the app reads (the Schwerpunkte are said at their "2/5"), keys the app does
  not read (with the folder at hand), the rescore a save starts, and the actions: one main
  button (an update from a CV, or for a new form one from a CV) and the "…" menu with the
  rest (another file, the profile folder, remove; remove goes at once, the toast offers
  Rückgängig). While the form holds changes, what would replace or drop them waits and says
  "Erst speichern oder verwerfen." Drafts say once that they are to be reviewed, a draft that
  replaces a profile says that saving replaces it.
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
    /** How many values are still to check. */
    checks: number;
    /** Warnings said here: what the form cannot change (keys the app does not read). */
    warnings: readonly NoticeData[];
    rescoring: boolean;
    /** Unsaved changes: another file, an update or a removal would drop them. */
    dirty: boolean;
    /** Saving the draft replaces the stored profile (another file). */
    replacing: boolean;
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
    checks,
    warnings,
    rescoring,
    dirty,
    replacing,
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
  const replacesBroken = $derived(origin === 'new' && (profile?.parseError ?? null) !== null);
  /** The badge: honest about competences; with values to check "n Werte prüfen" stands in
   *  place of "Vollständig". Without competence rows but with other terms the match is only
   *  rough (amber); red only when nothing can be scored. */
  const badge = $derived.by((): { label: string; tone: BadgeTone; hint: string | null } | null => {
    if (quality === null) return null;
    if (quality === 'empty') {
      return { label: t.profile.quality.empty, tone: 'danger', hint: t.profile.qualityText.empty };
    }
    if (!competences) {
      return { label: t.profile.quality.empty, tone: 'warning', hint: t.profile.noRowsText };
    }
    if (quality === 'thin') {
      return { label: t.profile.quality.thin, tone: 'warning', hint: t.profile.qualityText.thin };
    }
    if (checks > 0) return null;
    return { label: t.profile.quality.good, tone: 'success', hint: null };
  });
  const notes = $derived(
    warnings.flatMap((notice) => {
      const text = warningText(notice);
      return text === null ? [] : [{ text, folder: notice.code === 'ignoredKeys' }];
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
  const savedAt = $derived(
    stored && profile?.savedAt ? t.profile.savedAt(moment(profile.savedAt)) : null,
  );
  const summary = $derived(terms === null ? null : t.profile.understood(terms));

  // ------------------------------------------------------------------ the "…" menu
  let anchor = $state<HTMLElement | null>(null);
  let expanded = $state(false);

  /** What the menu holds: for the stored profile another file, its folder and remove (all
   *  wait while the form holds changes, the folder aside; remove can be undone, so it is no
   *  warning); for a new form a file (and the folder of a file that does not read). */
  const entries = $derived.by((): MenuEntry[] => {
    const held = { disabled: dirty, reason: dirty ? t.profile.saveFirst : null };
    const pick: MenuEntry = {
      id: 'pick',
      label: stored ? t.profile.pickOther : t.profile.pick,
      icon: 'file-up',
      ...held,
      run: onpick,
    };
    const folder: MenuEntry = {
      id: 'folder',
      label: t.common.openFolder,
      icon: 'folder-open',
      run: onopenfolder,
    };
    if (!stored) return replacesBroken ? [pick, folder] : [pick];
    return [
      pick,
      folder,
      { kind: 'separator' },
      { id: 'remove', label: t.profile.remove, icon: 'trash-2', ...held, run: onremove },
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

<div class="head" data-testid="profile-file">
  <div class="first" data-first-row>
    <IconTile tone="navy" icon="file-text" size="sm" />
    {#if stored && profile}
      <h2 class="name" data-copy use:tooltip={profile.fileName}>
        <span data-testid="profile-name">{person?.name || t.profile.unnamed}</span>
        {#if person?.title}<span class="role" data-testid="profile-role">{person.title}</span>{/if}
      </h2>
    {:else}
      <h2 class="name" data-testid="profile-name">
        {t.profile.draft[origin === 'stored' ? 'new' : origin]}
      </h2>
    {/if}
    {#if badge}
      <span class="quality" data-testid="profile-quality">
        <Badge label={badge.label} tone={badge.tone} hint={badge.hint} />
      </span>
    {/if}
    {#if checks > 0}
      <span class="check">
        <Button
          variant="ghost"
          size="sm"
          icon="triangle-alert"
          label={t.profile.check(checks)}
          testid="profile-check"
          onclick={oncheck}
        />
      </span>
    {/if}
  </div>

  <Card padding="md">
    <div class="body">
      {#if savedAt || summary}
        <p class="meta">
          {#if savedAt}<span data-testid="profile-saved-at">{savedAt}</span>{/if}
          {#if summary}<span data-testid="profile-understood">{summary}</span>{/if}
        </p>
      {/if}
      {#each notes as warning, index (index)}
        <Notice
          tone="info"
          variant="inline"
          text={warning.text}
          action={warning.folder
            ? { label: t.common.openFolder, icon: 'folder-open', onclick: onopenfolder }
            : null}
          testid="profile-warning"
        />
      {/each}
      {#if replacing}
        <Notice
          tone="info"
          variant="inline"
          text={t.profile.replacesStored}
          testid="profile-replaces"
        />
      {:else if origin === 'file' || origin === 'answer' || origin === 'update'}
        <Notice tone="info" variant="inline" text={t.profile.review} testid="profile-review" />
      {/if}
      {#if replacesBroken}
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
</div>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .first {
    gap: var(--space-12);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  /* The badge's box, no line around it. */
  .quality,
  .check,
  .more {
    display: flex;
  }

  /* The ghost button's text ends on the column's edge, like the badge. */
  .check {
    margin-right: calc(-1 * var(--ghost-inset));
  }

  .name {
    flex: 1;
    overflow: hidden;
    min-width: 0;
    color: var(--text-heading);
    font: var(--type-lg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .role {
    margin-left: var(--space-8);
    color: var(--text-muted);
    font: var(--type-md);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-16);
    color: var(--text-muted);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
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
