<!--
  Profil (the round 10 draft): one page in the pages' frame (Page) with its head (ProfileHead:
  the title "Profil" and "Aus Lebenslauf ausfüllen", which opens the file dialog at once). A
  CV dropped on the page (Tauri's drag and drop, never a path) is evaluated the same way,
  with a dashed edge while it is over the page; it fills the profile at once. Under the head
  what went wrong with the CV (a state box with its way out), then the groups
  (ProfileEditor). Without a profile the two ways in (ProfileStart); a file that no longer
  reads says so in the same place, with its folder at hand.
  A change saves by itself, and what cannot be saved asks once on the way out
  (saving.svelte.ts).
  What is missing (owner, 2026-10-29): a required field that is still empty (Wunschrollen,
  Länder, Kompetenzen, Sprachen) never holds the save and stays calm on the Profil page. The
  card under the head (it unfolds) names them. Its "Ergänzen" marks them orange until they are
  filled and brings the first into view with a moment's wash, no caret; a further press brings
  the next (owner, 2026-11-01). A new or changed form asks core what it still lacks
  (`profileMissing`, a moment after the last edit), the stored profile names its own
  (`missing`).
  In the setup (`setup`) the same form without the CV and the card; its "Weiter" (`next`)
  marks and leads the same way, and saves and goes on once nothing is missing; a failed save
  says so above the form.
  A state box the user's own action caused (a dropped CV, its failure, a drop refused, Weiter's
  failed save, staying after the question) comes into view: the page glides up to it.
-->
<script lang="ts">
  import Dialog from '$components/Dialog.svelte';
  import Page from '$components/Page.svelte';
  import StateBox from '$components/StateBox.svelte';
  import { t } from '$lib/i18n/t';
  import { errorText } from '$lib/i18n/texts';
  import { invoke, onCloseRequested, onFileDrag, type FileDrag } from '$lib/ipc/api';
  import type { ProfileForm } from '$lib/ipc/types';
  import { app } from '$lib/state/app.svelte';
  import { navigation } from '$lib/state/navigation.svelte';
  import { unfold } from '$lib/motion/transitions';
  import { editor, sameForm } from '$lib/state/profile.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { fromCv } from '../shared/fromCv.svelte';
  import CvProblem from './CvProblem.svelte';
  import { draftMissing } from './draftMissing.svelte';
  import ProfileEditor from './ProfileEditor.svelte';
  import ProfileHead from './ProfileHead.svelte';
  import ProfileStart from './ProfileStart.svelte';
  import { ProfileSaving, type Words } from './saving.svelte';
  import { FIELD_ORDER, LABEL_OF } from './sections';

  interface Props {
    /** The setup's page: the form alone, its "Weiter" saves (`next`). */
    setup?: boolean;
  }
  let { setup = false }: Props = $props();

  const profile = $derived(app.state?.profile ?? null);
  const stored = $derived(profile?.form ?? null);

  /** A failure is said when it shows. */
  let note = $state<Words | null>(null);
  let panel = $state<ProfileEditor | null>(null);

  const saving = new ProfileSaving({
    panel: () => panel,
    setup: () => setup,
    stored: () => stored,
    onfailed: (words) => {
      note = words;
      void panel?.showHead();
    },
  });

  // The stored profile fills the form while nothing unsaved is in it, and once nothing is (what
  // was typed while a CV was evaluated, taken back). A save under way decides at its end
  // (`editor.settle`): till then a change taken back reads as none.
  $effect(() => {
    const form = stored;
    if (saving.busy || editor.dirty) return;
    untrack(() => {
      if (form === null) {
        if (editor.origin === 'stored') editor.close();
      } else if (editor.origin !== 'stored' || !sameForm(editor.before, form)) {
        editor.edit(form);
      }
    });
  });

  onMount(() => {
    // The setup's form starts empty where there is no profile yet.
    if (setup && editor.origin === null) editor.create();
    const release = navigation.guard((next) => {
      if (!saving.dirty) return true;
      void saving.leaveTo(next);
      return false;
    });
    const stopClose = onCloseRequested(() => void saving.closeRequested());
    // The setup takes its CV on its own upload step.
    const stopDrag = setup ? () => undefined : onFileDrag(dragged);
    return () => {
      saving.stop();
      release();
      stopClose();
      stopDrag();
      fromCv.clear();
      void invoke('set_unsaved', { on: false }).catch(() => undefined);
      editor.endDay();
      // An untouched new form starts over next time.
      if (!editor.dirty && editor.origin !== 'stored') editor.close();
    };
  });

  function openFolder(): void {
    note = null;
    invoke('open_target', { target: { kind: 'profileDir' } }).catch(
      (error: unknown) => (note = () => errorText(error)),
    );
  }

  /** "Selbst ausfüllen": the new form. */
  function create(): void {
    fromCv.clear();
    editor.create();
  }

  /** The CV filled the profile: the form shows it as stored. What was typed meanwhile stays and
   *  goes with its save, which writes only what differs on top of what the CV stored. */
  function filled(form: ProfileForm | null): void {
    if (editor.dirty) saving.soon();
    else if (form !== null) editor.edit(form);
  }

  /** The file dialog or a drop. What the user's action brings comes into view: a drop's busy line
   *  in the head and what went wrong under it. */
  async function fillFromCv(dropped = false): Promise<void> {
    if (dropped) void panel?.showHead();
    if (!(await saving.settled())) {
      void panel?.showHead();
      return;
    }
    const info = await fromCv.run(dropped);
    if (info !== null) filled(info.form);
    else if (fromCv.problem !== null) void panel?.showHead();
  }

  /** The label of a value that holds the save. */
  const held = $derived(panel?.wrongField() ?? null);
  /** What the question says; its words stand while the dialog leaves. */
  let question = $state('');
  $effect.pre(() => {
    if (saving.asking)
      question = held !== null ? t.profile.leaveWrong(held) : t.profile.leaveFailed;
  });

  /** A file over the page: the dashed edge shows while the CV import would take it; a drop it
   *  cannot take says why (the tries used up, in fromCv; a value that is wrong). */
  let over = $state(false);
  const takesDrop = (): boolean =>
    saving.leaving === null && held === null && !fromCv.busy && !fromCv.limited;

  function dragged(drag: FileDrag): void {
    over = drag.kind === 'over' && takesDrop();
    if (drag.kind !== 'drop' || drag.paths.length === 0 || saving.leaving !== null) return;
    const wrong = held;
    if (wrong === null) {
      void fillFromCv(true);
      return;
    }
    saving.note = () => t.profile.fixFirst(wrong);
    void panel?.showHead();
  }

  /** Back at the ways in, the keyboard focus on the first of them (a button: no caret). */
  async function focusFirstWay(): Promise<void> {
    await tick();
    document.querySelector<HTMLElement>('[data-testid="way-cv"]')?.focus();
  }

  /** Esc on an untouched new form: back to the ways in, whose first one takes the focus of the
   *  gone form. */
  function discard(): void {
    saving.discard();
    if (editor.origin === null) void focusFirstWay();
  }

  // ------------------------------------------------------------ what is still missing

  /** A required field's label as the page shows it (the card of what is missing). */
  const labelOf = (field: string): string => {
    const key = LABEL_OF[field as keyof ProfileForm] ?? field;
    return String((t.profile.field as Record<string, unknown>)[key] ?? field);
  };

  const stillMissing = draftMissing();
  /** The required fields still empty, in the order of the page. */
  const missing = $derived(stillMissing());
  /** Someone asked for them (Ergänzen, Weiter, Profil ergänzen): from then on they are marked
   *  until they are filled; until then the rows stay calm. */
  let flagged = $state(false);
  $effect(() => {
    if (flagged && missing.length === 0) flagged = false;
  });
  const marked = $derived(flagged ? missing : []);

  /** The field the last press led to. */
  let ledTo: string | null = null;

  /** A field of the form comes into view with a moment's wash, no caret, and what is missing is
   *  marked. */
  function lead(field: string): void {
    flagged = true;
    ledTo = field;
    void panel?.revealField(field);
  }

  /** Each press leads to the next field still missing, then round again; one that was filled
   *  meanwhile starts at the first. */
  function leadOn(): void {
    const field = missing[(missing.findIndex((one) => one === ledTo) + 1) % missing.length];
    if (field !== undefined) lead(field);
  }

  /** The Profil opened for one of its fields ("Profil ergänzen" in the Jobs view sets
   *  `navigation.section` to the first required field still empty; read once and set back,
   *  like Einstellungen its group): that field comes into view. */
  $effect(() => {
    const field = navigation.section;
    if (field === null || setup || panel === null) return;
    navigation.section = null;
    void tick().then(() => lead(field));
  });

  /**
   * The setup's "Weiter": what is missing is marked and the next of it comes into view;
   * else it saves what changed (a new form always) and is `true` once nothing required is
   * open in the stored profile.
   */
  export async function next(): Promise<boolean> {
    if (saving.busy) return false;
    if (missing.length > 0) {
      leadOn();
      return false;
    }
    if (editor.dirty || editor.origin === 'new') {
      if (panel !== null && !panel.ready()) return false;
      if (!(await saving.save())) {
        if (saving.note !== null) void panel?.showHead();
        return false;
      }
    }
    const left = FIELD_ORDER.filter((field) => (profile?.missing ?? []).includes(field));
    if (profile === null || left.length > 0) {
      lead(left[0] ?? FIELD_ORDER[0] ?? '');
      return false;
    }
    return true;
  }
</script>

{#snippet notes()}
  {#if !setup}<CvProblem />{/if}
  {#if !setup && editor.origin === 'stored' && missing.length > 0}
    <!-- It unfolds, so the rows below glide (the page's gap under it comes along). -->
    <div class="fold" transition:unfold>
      <StateBox
        heading={t.profile.missing.heading(missing.length)}
        text={t.profile.missing.fields(missing.map(labelOf))}
        action={{
          label: t.profile.missing.action,
          icon: 'edit',
          testid: 'profile-missing-go',
          onclick: leadOn,
        }}
        testid="profile-missing"
      />
    </div>
  {/if}
  {#if note}<StateBox heading={note()} alert testid="profile-note" />{/if}
  {#if saving.note}
    <StateBox heading={saving.note()} alert testid="profile-save-error" />
  {/if}
{/snippet}

{#if app.state === null}
  <!-- The shell shows nothing until the state is known. -->
{:else if setup}
  {#if editor.origin !== null}
    <div class="setup" data-testid="profile">
      {@render notes()}
      <ProfileEditor bind:this={panel} fieldError={saving.fieldError} missing={marked} />
    </div>
  {/if}
{:else}
  {#snippet head()}
    <ProfileHead
      heading={editor.origin === null && profile?.parseError ? t.profile.unreadable : t.nav.profile}
      form={editor.origin !== null}
      {held}
      oncv={() => void fillFromCv()}
      onfolder={editor.origin === null && profile?.parseError ? openFolder : null}
    />
  {/snippet}
  <Page testid="profile" {over} {head}>
    {#if editor.origin === null}
      <ProfileStart
        broken={profile?.parseError !== null && profile?.parseError !== undefined}
        text={profile?.parseError
          ? `${t.error.text(profile.parseError.kind, profile.parseError.params)} ${t.profile.replaces}`
          : t.profile.noneText}
        note={note?.() ?? null}
        onfilled={(info) => filled(info.form)}
        onempty={create}
      />
    {:else}
      {@render notes()}
      <ProfileEditor
        bind:this={panel}
        fieldError={saving.fieldError}
        missing={marked}
        onsave={() => saving.trySave()}
        ondiscard={discard}
        onleft={() => saving.soon()}
      />
    {/if}
  </Page>
{/if}

<!-- A change that cannot be saved: the way goes on without it, or stays. -->
<Dialog
  open={saving.asking}
  variant="danger"
  heading={t.profile.leaveHeading}
  text={question}
  confirmLabel={t.profile.discard}
  testid="dialog-leave-profile"
  onconfirm={() => void saving.leave()}
  oncancel={() => saving.stay()}
/>

<style>
  .setup {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
  }

  /* The page's gap under the card inside what unfolds, so it does not jump. */
  .fold {
    margin-bottom: calc(-1 * var(--group-section-gap));
    padding-bottom: var(--group-section-gap);
  }
</style>
