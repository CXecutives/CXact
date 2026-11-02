<!--
  The surfaces of the design system in their states (`?sheet=surfaces`, the harness only):
  cards, groups and sections, fields, setting rows, status words, tiles, the setup's ways and
  drop zone, empty states, state boxes, toasts, dialogs, the bar at a view's foot, spinners,
  meters, the progress strip, the item list, the rings, the placeholders and the app's mark.
  `&toasts` shows the toasts at once and holds them; `&dialog=confirm|danger` opens a dialog.
  The words are the draft's (round 10).
-->
<script lang="ts">
  import AppMark from '$components/AppMark.svelte';
  import BottomBar from '$components/BottomBar.svelte';
  import Button from '$components/Button.svelte';
  import Card from '$components/Card.svelte';
  import Dialog from '$components/Dialog.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Field from '$components/Field.svelte';
  import Group from '$components/Group.svelte';
  import IconTile, { type TileTone } from '$components/IconTile.svelte';
  import ItemList from '$components/ItemList.svelte';
  import Meter from '$components/Meter.svelte';
  import Page from '$components/Page.svelte';
  import PageHeader from '$components/PageHeader.svelte';
  import ProgressStrip from '$components/ProgressStrip.svelte';
  import ScoreRing from '$components/ScoreRing.svelte';
  import Section from '$components/Section.svelte';
  import SettingRow from '$components/SettingRow.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import Spinner from '$components/Spinner.svelte';
  import StateBox from '$components/StateBox.svelte';
  import StatusText from '$components/StatusText.svelte';
  import TextField from '$components/TextField.svelte';
  import Tile from '$components/Tile.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { toasts } from '$lib/state/toasts.svelte';

  const params = new URLSearchParams(location.search);
  const asked = params.get('dialog');
  let confirmOpen = $state(asked === 'confirm');
  let dangerOpen = $state(asked === 'danger');

  function showToasts(): void {
    toasts.show('Prompt kopiert. Füg ihn in einen KI-Chat ein.');
    toasts.show('Archiviert', 'success', { label: 'Rückgängig', onclick: () => undefined });
    toasts.show('2 Jobs passen jetzt besser', 'plain');
    toasts.show('2 neue Jobs, 1 mit hoher Übereinstimmung', 'info', {
      label: 'Zeigen',
      undo: false,
      onclick: () => undefined,
    });
  }

  // The toasts stay while the sheet is open with `&toasts` (a screenshot).
  if (params.has('toasts')) {
    toasts.hold();
    showToasts();
  }

  let competences = $state([
    { name: 'Controlling', years: '18' },
    { name: 'Konzernrechnungslegung nach IFRS', years: '14' },
    { name: 'Konsolidierung', years: '11' },
  ]);
  let adding = $state('');
  let switchOn = $state(true);

  const TONES: readonly TileTone[] = ['accent', 'danger'];
  const noop = (): void => undefined;
</script>

<div class="sheet" data-testid="sheet-surfaces">
  <div class="grid">
    <!-- Cards -->
    <section class="cell wide">
      <h2 class="name">Karten</h2>
      <div class="cards">
        <Card hero testid="sheet-hero">
          <div class="hero">
            <ScoreRing ring={{ status: 'scored', score: 89, band: 'high' }} size="md" />
            <div>
              <p class="job">Interim CFO für Familienunternehmen</p>
              <p class="band">Hohe Übereinstimmung</p>
            </div>
          </div>
          <div class="state">
            <StateBox
              heading="Die Anzeige ist noch nicht geladen."
              text="Danach wird der Job bewertet."
              action={{ label: 'Anzeige laden', icon: 'details', onclick: noop }}
            />
          </div>
        </Card>
        <Card heading="Anforderungen" count="4 von 6">
          <p class="body">Der Text einer Karte, 14 auf ihrer Zeile.</p>
        </Card>
      </div>
    </section>

    <!-- State boxes -->
    <section class="cell">
      <h2 class="name">Zustandsbox</h2>
      <div class="stack">
        <StateBox busy heading="Die Anzeige wird geladen." />
        <StateBox busy heading="Der Job wird bewertet." />
        <StateBox
          tone="ban"
          heading="„Werkstudent“ steht in deinen Ausschlusswörtern."
          text="Darum wurde der Job nicht bewertet."
          action={{ label: 'Trotzdem bewerten', icon: 'add', onclick: noop }}
        />
        <StateBox
          heading="Noch kein Profil"
          text="CXact bewertet Jobs erst mit einem Profil."
          action={{ label: 'Profil anlegen', icon: 'add', onclick: noop }}
        />
        <StateBox heading="Die Anzeige ist beendet." />
      </div>
    </section>

    <!-- Empty states -->
    <section class="cell">
      <h2 class="name">Leerer Zustand</h2>
      <div class="split">
        <div class="frame">
          <EmptyState
            icon="jobs"
            placement="list"
            heading="Noch keine Jobs"
            text="Mit „Jobs suchen“ durchsucht CXact die Jobportale nach Jobs, die zu deinem Profil passen."
          />
        </div>
        <div class="frame center">
          <EmptyState icon="jobs" heading="Kein Job gewählt" text="Wähl einen Job aus der Liste." />
        </div>
        <div class="frame center">
          <EmptyState icon="warning" tone="danger" text="Die Jobs ließen sich nicht laden." />
        </div>
      </div>
    </section>

    <!-- A page: head, sections, groups, fields, rows -->
    <section class="cell wide">
      <h2 class="name">Seite, Abschnitt, Gruppe, Feld</h2>
      <div class="page-frame">
        <Page>
          {#snippet head()}
            <PageHeader heading="Einstellungen" column="page">
              {#snippet actions()}
                <Button label="Aus Lebenslauf ausfüllen" icon="pickFile" onclick={noop} />
              {/snippet}
            </PageHeader>
          {/snippet}
          <div class="sections">
            <Section id="sheet-portals" name="portals" heading="Jobportale">
              <Group caption="Suche und Alert-Mails">
                <SettingRow label="freelancermap" hint="Zuletzt 4 neue Jobs">
                  {#snippet end()}
                    <Toggle
                      checked={switchOn}
                      label="freelancermap"
                      onchange={(on) => (switchOn = on)}
                    />
                  {/snippet}
                </SettingRow>
                <SettingRow label="Hays" hint="Pausiert bis morgen" status="warning">
                  {#snippet end()}
                    <Toggle checked label="Hays" onchange={noop} />
                  {/snippet}
                </SettingRow>
              </Group>
              <Group caption="Nur Alert-Mails">
                <SettingRow
                  label="LinkedIn"
                  link={{ label: 'Postfach verbinden', onclick: noop }}
                  disabled
                >
                  {#snippet end()}
                    <Toggle checked={false} disabled label="LinkedIn" onchange={noop} />
                  {/snippet}
                </SettingRow>
                <SettingRow label="freelance.de" hint="11 Alert-Mails in 30 Tagen">
                  <Button
                    icon="signIn"
                    label="Anmelden"
                    sizeTo={[{ label: 'Abmelden', icon: 'signOut' }]}
                    onclick={noop}
                  />
                  <Button
                    icon="alertAdd"
                    label="Alert anlegen"
                    sizeTo={[
                      { label: 'Alert-Mail öffnen', icon: 'alertMail' },
                      { label: 'Alert prüfen', icon: 'external' },
                    ]}
                    onclick={noop}
                  />
                  {#snippet end()}
                    <Toggle checked label="freelance.de" onchange={noop} />
                  {/snippet}
                </SettingRow>
              </Group>
            </Section>
            <Section id="sheet-mailbox" name="mailbox" heading="Postfach">
              <Group>
                <SettingRow
                  label="alerts.demo@gmail.com"
                  copyLabel
                  hint="Verbunden"
                  status="success"
                  pair
                >
                  <Button icon="edit" label="Ändern" onclick={noop} />
                  <Button icon="trash" label="Entfernen" onclick={noop} />
                </SettingRow>
                <SettingRow
                  label="alerts.demo@gmail.com"
                  copyLabel
                  hint="App-Passwort abgelehnt"
                  status="danger"
                  pair
                >
                  <Button icon="edit" label="Ändern" onclick={noop} />
                  <Button icon="trash" label="Entfernen" onclick={noop} />
                </SettingRow>
              </Group>
            </Section>
            <Section id="sheet-data" name="data" heading="Daten">
              <Group>
                <SettingRow label="Profil-Ordner" hint="C:\Users\demo\Documents\CXact" copy pair>
                  <Button icon="folder" label="Öffnen" onclick={noop} />
                  <Button icon="edit" label="Ändern" onclick={noop} />
                </SettingRow>
                <SettingRow
                  label="Alles zurücksetzen"
                  hint="Löscht alles, was CXact gespeichert hat."
                >
                  <Button icon="trash" label="Zurücksetzen" onclick={noop} />
                </SettingRow>
              </Group>
            </Section>
            <Section id="sheet-fields" name="fields" heading="Felder">
              <div data-testid="sheet-fields">
                <Group>
                  <div class="form-row">
                    <Field
                      row
                      label="App-Passwort"
                      for="sheet-password"
                      info="Ein eigenes Passwort nur für CXact. Du erstellst es bei deinem Anbieter."
                      links={[
                        { label: 'IMAP-Abruf erlauben', onclick: noop },
                        { label: 'App-Passwort erstellen', onclick: noop },
                      ]}
                    >
                      <TextField id="sheet-password" value="" placeholder="16 Buchstaben" />
                    </Field>
                  </div>
                  <div class="form-row" data-missing>
                    <Field row label="Wunschrollen" for="sheet-roles">
                      <TextField id="sheet-roles" value="" placeholder="Rolle hinzufügen" />
                    </Field>
                  </div>
                  <div class="form-row">
                    <Field
                      row
                      label="Wunschtagessatz"
                      for="sheet-rate"
                      error="Gib einen Betrag bis 100.000 € ein."
                    >
                      <TextField id="sheet-rate" value="1.000.000" invalid suffix="€ am Tag" />
                    </Field>
                  </div>
                </Group>
              </div>
              <Group>
                <ItemList
                  items={competences}
                  key={(item) => item.name}
                  name={(item) => item.name}
                  addLabel="Kompetenz hinzufügen"
                  onremove={(item) => (competences = competences.filter((each) => each !== item))}
                  testid="sheet-competences"
                >
                  {#snippet value(item)}
                    <span class="short"><TextField value={item.years} suffix="Jahre" /></span>
                  {/snippet}
                  {#snippet draft()}
                    <TextField
                      value={adding}
                      placeholder="Kompetenz"
                      oninput={(text) => (adding = text)}
                    />
                  {/snippet}
                </ItemList>
              </Group>
            </Section>
          </div>
          {#snippet foot()}
            <BottomBar>
              Ungespeicherte Änderungen
              {#snippet actions()}
                <Button variant="ghost" label="Verwerfen" onclick={noop} />
                <Button variant="primary" label="Speichern" onclick={noop} />
              {/snippet}
            </BottomBar>
          {/snippet}
        </Page>
      </div>
    </section>

    <!-- A narrow box: the buttons under the words -->
    <section class="cell">
      <h2 class="name">Schmale Zeile</h2>
      <div class="narrow">
        <Group>
          <SettingRow label="Alles zurücksetzen" hint="Löscht alles, was CXact gespeichert hat.">
            <Button icon="trash" label="Zurücksetzen" onclick={noop} />
          </SettingRow>
        </Group>
      </div>
      <h2 class="name">Statuswort</h2>
      <div class="row-of">
        <StatusText tone="success" text="Verbunden" />
        <StatusText tone="warning" text="Pausiert bis morgen" />
        <StatusText tone="danger" text="Abgelehnt" />
      </div>
    </section>

    <!-- Tiles -->
    <section class="cell">
      <h2 class="name">Kacheln 48, der Kopf der Einrichtung 56</h2>
      <div class="tiles">
        <div class="row-of">
          {#each TONES as tone (tone)}<IconTile icon="jobs" {tone} />{/each}
        </div>
        <div class="row-of">
          <AppMark />
          <Spinner size="xl" />
          <ScoreRing ring={{ status: 'scored', score: 100, band: 'high' }} size="md" done />
        </div>
      </div>
    </section>

    <!-- The setup's ways and its drop zone -->
    <section class="cell">
      <h2 class="name">Wege und Ablage</h2>
      <div class="ways">
        <Tile
          icon="pickFile"
          label="Aus Lebenslauf"
          note="Eine KI füllt es aus, du prüfst es danach."
          recommended
          onclick={noop}
        />
        <Tile
          icon="edit"
          label="Selbst ausfüllen"
          note="Du trägst alles von Hand ein."
          onclick={noop}
        />
      </div>
      <div class="drops">
        <Tile
          icon="upload"
          label="Datei hierher ziehen oder auswählen"
          note="PDF, Word oder Foto"
          drop
          onclick={noop}
        />
        <Tile
          icon="upload"
          label="Datei hierher ziehen oder auswählen"
          note="PDF, Word oder Foto"
          drop
          over
          onclick={noop}
        />
      </div>
    </section>

    <!-- Progress -->
    <section class="cell">
      <h2 class="name">Fortschritt</h2>
      <div class="stack">
        <ProgressStrip
          step="Portale werden durchsucht"
          count="3 von 8"
          value={3 / 8}
          label="Fortschritt"
        />
        <ProgressStrip step="Jobs werden neu bewertet" value={null} label="Fortschritt" />
        <ProgressStrip step="Wartet auf freelance.de" value={5 / 8} label="Fortschritt">
          {#snippet action()}<Button
              variant="link"
              icon="signIn"
              label="Anmelden"
              onclick={noop}
            />{/snippet}
        </ProgressStrip>
        <Meter value={0.6} label="Fortschritt" />
        <Meter value={null} label="Fortschritt" />
      </div>
      <h2 class="name">Spinner</h2>
      <div class="row-of">
        <Spinner size="sm" />
        <Spinner size="md" />
        <Spinner size="lg" />
        <Spinner size="xl" />
        <span class="filled"><Spinner size="sm" tone="current" label={null} /></span>
      </div>
    </section>

    <!-- Rings and placeholders -->
    <section class="cell">
      <h2 class="name">Ringe</h2>
      <div class="row-of">
        {#each [100, 89, 71, 58, 40, 12] as score (score)}
          <ScoreRing
            ring={{
              status: 'scored',
              score,
              band: score >= 80 ? 'high' : score >= 40 ? 'mid' : 'low',
            }}
          />
        {/each}
        <ScoreRing ring={{ status: 'none' }} />
        <ScoreRing ring={{ status: 'unscorable' }} />
        <ScoreRing ring={{ status: 'none' }} ban />
      </div>
      <div class="row-of">
        <ScoreRing ring={{ status: 'scored', score: 100, band: 'high' }} size="md" />
        <ScoreRing ring={{ status: 'scored', score: 62, band: 'mid' }} size="md" />
        <ScoreRing ring={{ status: 'none' }} size="md" />
        <ScoreRing ring={{ status: 'none' }} size="md" ban />
      </div>
      <h2 class="name">Platzhalter</h2>
      <div class="skeletons">
        <Skeleton shape="circle" />
        <div class="lines"><Skeleton width={70} /><Skeleton width={40} /></div>
      </div>
    </section>

    <!-- Toasts and dialogs -->
    <section class="cell">
      <h2 class="name">Toasts und Dialoge</h2>
      <div class="row-of">
        <Button label="Toasts zeigen" onclick={showToasts} />
        <Button label="Dialog" onclick={() => (confirmOpen = true)} />
        <Button label="Gefahr" onclick={() => (dangerOpen = true)} />
      </div>
    </section>
  </div>
</div>

<Dialog
  bind:open={confirmOpen}
  heading="Änderung verwerfen?"
  text="Die letzte Änderung lässt sich gerade nicht speichern."
  confirmLabel="Verwerfen"
  onconfirm={() => (confirmOpen = false)}
/>
<Dialog
  bind:open={dangerOpen}
  variant="danger"
  heading="Job endgültig löschen?"
  text="Der Job kommt nicht wieder, auch nicht mit alten Alert-Mails."
  confirmLabel="Löschen"
  onconfirm={() => (dangerOpen = false)}
/>

<style>
  /* Over the app, below its toasts (--z-toast) and dialogs. */
  .sheet {
    position: fixed;
    inset: 0;
    z-index: 50;
    overflow: auto;
    background-color: var(--page);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    gap: 28px;
    padding: 28px;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .name {
    color: var(--text-muted);
    font: var(--type-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .cards {
    max-width: var(--reader-max);
  }

  .hero {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-right: 96px;
  }

  .job {
    color: var(--text);
    font: var(--type-xl);
    letter-spacing: var(--tracking-tight);
  }

  .band {
    margin-top: 3px;
    color: var(--score-text-9);
    font: var(--type-field-label);
  }

  .state {
    margin-top: 14px;
  }

  .body {
    margin-top: 8px;
    color: var(--text-muted);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .split {
    display: grid;
    gap: 12px;
  }

  .frame {
    min-height: 180px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    background-color: var(--surface);
  }

  .frame.center {
    display: grid;
    place-items: center;
    min-height: 200px;
  }

  .page-frame {
    position: relative;
    height: 900px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--group-section-gap);
  }

  .narrow {
    width: 440px;
    max-width: 100%;
  }

  .row-of {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .tiles {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .ways {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .drops {
    display: grid;
    gap: 12px;
  }

  .filled {
    display: inline-flex;
    padding: 6px 10px;
    border-radius: var(--radius-control);
    background-color: var(--primary);
    color: var(--text-on-accent);
  }

  /* A field as a row of its box, the Profil's measure and its hairline (ProfileEditor). */
  .form-row {
    position: relative;
    display: grid;
    min-height: var(--form-row-min);
    padding: var(--form-row-control-y) var(--form-row-pad-x);
  }

  .form-row + .form-row::after {
    position: absolute;
    top: 0;
    right: 0;
    left: var(--setting-rule-start);
    border-top: var(--border-width) solid var(--border);
    content: '';
  }

  .short {
    display: block;
    width: var(--profile-control-width);
  }

  .skeletons {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
  }
</style>
