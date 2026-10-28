<!--
  The states sheet of the core controls (`?sheet=controls`, harness build only): every control
  of components/ in rest, under the pointer, pressed, off, busy and wrong, beside each other,
  to compare with the approved draft (.preview/drafts/konzept.html). Hover and pressed are
  forced (force.ts); the open list of a select and a tooltip show when pointed at, as in the
  app. The words are German, like the app: the page speaks to the product owner.
-->
<script lang="ts">
  import Button from '$components/Button.svelte';
  import CheckGroup from '$components/CheckGroup.svelte';
  import ChipInput from '$components/ChipInput.svelte';
  import InfoTip from '$components/InfoTip.svelte';
  import RadioList from '$components/RadioList.svelte';
  import Segmented from '$components/Segmented.svelte';
  import Select from '$components/Select.svelte';
  import Suggestions from '$components/Suggestions.svelte';
  import TextField from '$components/TextField.svelte';
  import Toggle from '$components/Toggle.svelte';
  import { force } from './force';

  const COLUMNS = ['Ruhe', 'Hover', 'Gedrückt', 'Gesperrt', 'Busy, gewählt', 'Fehler, Fokus'];
  const COUNTRIES = [
    { id: 'DE', label: 'Deutschland', terms: ['Germany'] },
    { id: 'AT', label: 'Österreich', terms: ['Austria'] },
    { id: 'CH', label: 'Schweiz', terms: ['Switzerland'] },
    { id: 'NL', label: 'Niederlande', terms: ['Netherlands'] },
    { id: 'BE', label: 'Belgien', terms: ['Belgium'] },
    { id: 'LU', label: 'Luxemburg', terms: ['Luxembourg'] },
  ];
  const PROVIDERS = [
    { id: 'gmail', label: 'Gmail' },
    { id: 'icloud', label: 'iCloud' },
    { id: 'gmx', label: 'GMX' },
    { id: 'webde', label: 'WEB.DE' },
  ];
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((id) => ({ id, label: id }));
  const MODES = [
    { id: 'remote', label: 'Remote' },
    { id: 'hybrid', label: 'Hybrid' },
    { id: 'site', label: 'Vor Ort' },
  ];
  const PLACES = [
    { id: 'inbox', label: 'Aktuell' },
    { id: 'archive', label: 'Archiv' },
    { id: 'trash', label: 'Papierkorb' },
  ];
  const CONTRACTS = [
    { id: 'freelance', label: 'Freiberuflich' },
    { id: 'employed', label: 'Festanstellung' },
    { id: 'leasing', label: 'ANÜ' },
  ];
  const BACKUPS = [
    { id: 'a', label: 'Heute, 09:12', note: 'vor dem Zurücksetzen', detail: '12 KB' },
    { id: 'b', label: 'Gestern, 18:40', detail: '11 KB' },
    { id: 'c', label: '21.10.2026, 08:03', detail: '11 KB' },
  ];
  const TOOLS = ['SAP S/4HANA', 'SAP FI/CO', 'SAP Analytics Cloud', 'LucaNet'];

  let mode = $state('hybrid');
  let place = $state('inbox');
  let provider = $state('gmail');
  let level = $state('B2');
  let contracts = $state(['freelance']);
  let on = $state(true);
  let backup = $state('a');
  let text = $state('');
  let tools = $state(['SAP S/4HANA', 'Excel', 'Power BI']);
  let countries = $state(['DE', 'AT']);
  let running = $state(false);
  const noop = (): void => {};
  const flip = (id: string): void => {
    contracts = contracts.includes(id)
      ? contracts.filter((each) => each !== id)
      : [...contracts, id];
  };
</script>

<div class="states" data-testid="states-controls">
  <h1>Bedienelemente</h1>
  <div class="sheet">
    <span></span>
    {#each COLUMNS as column (column)}<span class="head">{column}</span>{/each}

    <span class="name">Menü, Vorschläge</span>
    <span class="wide-cell list">
      <span class="anchor">
        <Suggestions
          id="states-list"
          items={TOOLS}
          active={1}
          label="Tools"
          onpick={noop}
          onmark={noop}
        />
      </span>
    </span>
    <span></span><span></span><span></span><span></span>

    <span class="name">Hauptknopf</span>
    <span><Button variant="primary" icon="search" label="Jobs suchen" /></span>
    <span use:force={{ state: 'hover', target: 'button' }}
      ><Button variant="primary" icon="search" label="Jobs suchen" /></span
    >
    <span use:force={{ state: 'hover press', target: 'button' }}
      ><Button variant="primary" icon="search" label="Jobs suchen" /></span
    >
    <span
      ><Button
        variant="primary"
        icon="search"
        label="Jobs suchen"
        disabled
        disabledReason="Lege erst ein Profil an."
      /></span
    >
    <span><Button variant="primary" icon="search" label="Jobs suchen" loading /></span>
    <span></span>

    <span class="name">Knopf</span>
    <span><Button icon="copy" label="Kopieren" /></span>
    <span use:force={{ state: 'hover', target: 'button' }}
      ><Button icon="copy" label="Kopieren" /></span
    >
    <span use:force={{ state: 'hover press', target: 'button' }}
      ><Button icon="copy" label="Kopieren" /></span
    >
    <span><Button icon="copy" label="Kopieren" disabled disabledReason="Gerade nicht." /></span>
    <span><Button icon="copy" label="Kopieren" loading /></span>
    <span><Button icon="filter" label="Filter" pressed /></span>

    <span class="name">Weiter, Zurück</span>
    <span class="row">
      <Button variant="ghost" icon="back" label="Zurück" />
      <Button variant="primary" icon="next" label="Weiter" />
    </span>
    <span class="row" use:force={{ state: 'hover', target: 'button' }}>
      <Button variant="ghost" icon="back" label="Zurück" />
      <Button variant="primary" icon="next" label="Weiter" />
    </span>
    <span class="row" use:force={{ state: 'hover press', target: 'button' }}>
      <Button variant="ghost" icon="back" label="Zurück" />
      <Button variant="primary" icon="next" label="Weiter" />
    </span>
    <span class="row">
      <Button variant="ghost" icon="back" label="Zurück" disabled />
      <Button variant="primary" icon="next" label="Weiter" disabled />
    </span>
    <span class="row"><Button variant="primary" icon="next" label="Weiter" loading /></span>
    <span></span>

    <span class="name">Ruhige Symbole</span>
    <span class="row">
      <Button variant="ghost" iconOnly icon="copy" label="Kopieren" />
      <Button iconOnly icon="filter" label="Sortieren und filtern" />
    </span>
    <span class="row" use:force={{ state: 'hover', target: 'button' }}>
      <Button variant="ghost" iconOnly icon="copy" label="Kopieren" />
      <Button iconOnly icon="filter" label="Sortieren und filtern" />
    </span>
    <span class="row" use:force={{ state: 'hover press', target: 'button' }}>
      <Button variant="ghost" iconOnly icon="copy" label="Kopieren" />
      <Button iconOnly icon="filter" label="Sortieren und filtern" />
    </span>
    <span class="row">
      <Button variant="ghost" iconOnly icon="copy" label="Kopieren" disabled />
      <Button iconOnly icon="filter" label="Sortieren und filtern" disabled />
    </span>
    <span class="row">
      <Button iconOnly icon="filter" label="Sortieren und filtern" menu expanded />
    </span>
    <span></span>

    <span class="name">Gefahr, Link</span>
    <span class="row">
      <Button variant="danger" label="Löschen" />
      <Button variant="link" label="Ändern" />
    </span>
    <span class="row" use:force={{ state: 'hover', target: 'button' }}>
      <Button variant="danger" label="Löschen" />
      <Button variant="link" label="Ändern" />
    </span>
    <span class="row" use:force={{ state: 'hover press', target: 'button' }}>
      <Button variant="danger" label="Löschen" />
      <Button variant="link" label="Ändern" />
    </span>
    <span class="row">
      <Button variant="danger" label="Löschen" disabled />
      <Button variant="link" label="Ändern" disabled />
    </span>
    <span class="row"><Button variant="danger" label="Löschen" loading /></span>
    <span></span>

    <span class="name">Vorschlag</span>
    <span><Button variant="suggest" icon="add" label="SAP Analytics Cloud" /></span>
    <span use:force={{ state: 'hover', target: 'button' }}
      ><Button variant="suggest" icon="add" label="SAP Analytics Cloud" /></span
    >
    <span use:force={{ state: 'hover press', target: 'button' }}
      ><Button variant="suggest" icon="add" label="SAP Analytics Cloud" /></span
    >
    <span></span><span></span><span></span>

    <span class="name">Gleiche Breite</span>
    <span class="wide-cell row" data-testid="states-size-to">
      {#if running}
        <Button
          label="Abbrechen"
          sizeTo={['Jobs suchen']}
          testid="states-cancel"
          onclick={() => (running = false)}
        />
      {:else}
        <Button
          variant="primary"
          label="Jobs suchen"
          sizeTo={['Abbrechen']}
          testid="states-search"
          onclick={() => (running = true)}
        />
      {/if}
      <Button label="Abbrechen" sizeTo={['Jobs suchen']} testid="states-cancel-still" />
      <Button
        variant="primary"
        label="Speichern"
        loading
        sizeTo={['Speichern']}
        testid="states-saving"
      />
    </span>
    <span class="wide-cell row pair" data-testid="states-pair">
      <Button label="Abbrechen" />
      <Button variant="danger" label="Löschen" />
    </span>
    <span></span><span></span>

    <span class="name">Segmente</span>
    <span class="wide-cell"
      ><Segmented
        options={MODES}
        value={mode}
        label="Arbeitsmodell"
        onchange={(id) => (mode = id)}
      /></span
    >
    <span
      class="wide-cell"
      use:force={{ state: 'hover', target: '[role="radio"]:not([data-chosen])' }}
      ><Segmented options={MODES} value="hybrid" label="Arbeitsmodell" onchange={noop} /></span
    >
    <span class="wide-cell"
      ><Segmented
        tabs
        options={PLACES}
        value={place}
        label="Orte"
        onchange={(id) => (place = id)}
      /></span
    >

    <span class="name">Textfeld</span>
    <span class="field"
      ><TextField value={text} label="Rolle" placeholder="Rolle hinzufügen" /></span
    >
    <span class="field" use:force={{ state: 'hover', target: '.field' }}
      ><TextField value="" label="Rolle" placeholder="Rolle hinzufügen" /></span
    >
    <span class="field"><TextField value="Interim CFO" label="Rolle" /></span>
    <span class="field"><TextField value="Interim CFO" label="Rolle" disabled /></span>
    <span class="field" use:force={{ state: 'focus', target: '.field' }}
      ><TextField value="Interim C" label="Rolle" /></span
    >
    <span class="field"
      ><TextField value="abcd efgh" kind="password" label="App-Passwort" invalid /></span
    >

    <span class="name">Suche, Zahl</span>
    <span class="field"
      ><TextField value="" kind="search" label="Suchen" placeholder="Jobs durchsuchen" /></span
    >
    <span class="field"><TextField value="Controller" kind="search" label="Suchen" /></span>
    <span class="field"><TextField value="950" label="Tagessatz" suffix="€" /></span>
    <span class="field" data-missing><TextField value="" label="Tagessatz" suffix="€" /></span>
    <span class="field"><TextField value="abcd efgh" kind="password" label="App-Passwort" /></span>
    <span></span>

    <span class="name">Tag-Feld</span>
    <span class="chips"
      ><ChipInput bind:values={tools} label="Tools" placeholder="Tool hinzufügen" /></span
    >
    <span class="chips" use:force={{ state: 'hover', target: '.entry' }}
      ><ChipInput
        values={['SAP S/4HANA', 'Excel']}
        label="Tools"
        placeholder="Tool hinzufügen"
      /></span
    >
    <span class="chips" use:force={{ state: 'hover', target: '.remove' }}
      ><ChipInput
        values={['SAP S/4HANA', 'Excel']}
        label="Tools"
        placeholder="Tool hinzufügen"
      /></span
    >
    <span class="chips" data-missing
      ><ChipInput values={[]} label="Länder" placeholder="Land suchen" options={COUNTRIES} /></span
    >
    <span class="chips"
      ><ChipInput
        bind:values={countries}
        label="Länder"
        placeholder="Land suchen"
        options={COUNTRIES}
        noMatch="Kein Land mit diesem Namen."
        testid="states-countries"
      /></span
    >
    <span class="chips" use:force={{ state: 'focus', target: '.entry' }}
      ><ChipInput
        values={['Deutschland']}
        label="Regionen"
        placeholder="Region hinzufügen"
        invalid
      /></span
    >

    <span class="name">Auswahlliste</span>
    <span
      ><Select
        options={PROVIDERS}
        value={provider}
        label="Anbieter"
        testid="states-select"
        onchange={(id) => (provider = id)}
      /></span
    >
    <span use:force={{ state: 'hover', target: 'button' }}
      ><Select options={PROVIDERS} value="gmail" label="Anbieter" onchange={noop} /></span
    >
    <span
      ><Select
        options={PROVIDERS}
        value={null}
        label="Anbieter"
        placeholder="Anbieter wählen"
        onchange={noop}
      /></span
    >
    <span
      ><Select
        options={PROVIDERS}
        value="gmail"
        label="Anbieter"
        disabled
        disabledReason="Erst das Postfach trennen."
        onchange={noop}
      /></span
    >
    <span
      ><Select
        inline
        options={LEVELS}
        value={level}
        label="Niveau"
        testid="states-level"
        onchange={(id) => (level = id)}
      /></span
    >
    <span class="field"
      ><Select
        wide
        options={PROVIDERS}
        value="gmx"
        label="Anbieter"
        onchange={noop}
        invalid
      /></span
    >

    <span class="name">Kästchen</span>
    <span
      ><CheckGroup
        options={CONTRACTS}
        values={contracts}
        label="Vertragsart"
        keepOne="Eine bleibt gewählt."
        onchange={flip}
      /></span
    >
    <span use:force={{ state: 'hover', target: '[role="checkbox"]' }}
      ><CheckGroup
        options={CONTRACTS.slice(0, 2)}
        values={['freelance']}
        label="Vertragsart"
        onchange={noop}
      /></span
    >
    <span use:force={{ state: 'hover press', target: '[role="checkbox"]' }}
      ><CheckGroup
        options={CONTRACTS.slice(0, 2)}
        values={['freelance']}
        label="Vertragsart"
        onchange={noop}
      /></span
    >
    <span></span><span></span><span></span>

    <span class="name">Schalter</span>
    <span class="row">
      <Toggle checked={on} label="Freelancermap" onchange={(next) => (on = next)} />
      <Toggle checked={false} label="Freelance.de" onchange={noop} />
    </span>
    <span class="row" use:force={{ state: 'hover', target: '[role="switch"]' }}>
      <Toggle checked label="Freelancermap" onchange={noop} />
      <Toggle checked={false} label="Freelance.de" onchange={noop} />
    </span>
    <span class="row" use:force={{ state: 'hover press', target: '[role="switch"]' }}>
      <Toggle checked label="Freelancermap" onchange={noop} />
      <Toggle checked={false} label="Freelance.de" onchange={noop} />
    </span>
    <span class="row">
      <Toggle
        checked
        label="LinkedIn"
        disabled
        disabledReason="Erst ein Postfach verbinden."
        onchange={noop}
      />
      <Toggle checked={false} label="LinkedIn" disabled onchange={noop} />
    </span>
    <span></span><span></span>

    <span class="name">Auswahl, Info</span>
    <span class="wide-cell"
      ><RadioList
        options={BACKUPS}
        value={backup}
        label="Sicherungen"
        onchange={(id) => (backup = id)}
      /></span
    >
    <span
      class="wide-cell"
      use:force={{ state: 'hover', target: '[role="radio"]:not([aria-checked="true"])' }}
      ><RadioList options={BACKUPS} value="a" label="Sicherungen" onchange={noop} /></span
    >
    <span class="row info"
      >Vertragsart <InfoTip text="Welche Verträge du annimmst." label="Mehr zu Vertragsart" /></span
    >
    <span class="row info" use:force={{ state: 'hover', target: 'button' }}
      >Vertragsart <InfoTip
        text="Welche Verträge du annimmst."
        label="Mehr zu Vertragsart"
        testid="states-info"
      /></span
    >
  </div>
</div>

<style>
  .states {
    container-type: inline-size;
    position: fixed;
    z-index: var(--z-overlay);
    inset: 0;
    overflow: auto;
    padding: var(--space-24) var(--space-32) var(--space-64);
    background-color: var(--page);
    color: var(--text);
    font: var(--type-md);
  }

  h1 {
    margin-bottom: var(--space-16);
    font: var(--type-xl);
  }

  .sheet {
    display: grid;
    grid-template-columns: calc(2 * var(--space-64)) repeat(6, minmax(0, 1fr));
    align-items: center;
    gap: var(--space-16) var(--space-12);
  }

  .head {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .name {
    color: var(--text-muted);
    font: var(--type-sm);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }

  .wide-cell {
    grid-column: span 2;
  }

  .pair {
    --btn-min: var(--button-pair-min);
  }

  .field,
  .chips {
    display: block;
    min-width: 0;
  }

  .list {
    min-height: calc(5 * var(--menu-row));
  }

  .anchor {
    position: relative;
    display: block;
    width: var(--select-min);
  }

  .info {
    font: var(--type-field-label);
  }

  /* Too narrow for six states side by side (a suggestion chip is 170 wide): each control's
     name on a line of its own, its states wrap under it in their order, without the empty
     cells and the column heads. */
  @container (width < 1240px) {
    .sheet {
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 180px), 1fr));
      align-items: start;
    }

    .sheet > :empty,
    .head {
      display: none;
    }

    .name {
      grid-column: 1 / -1;
      margin-top: var(--space-8);
    }

    .wide-cell {
      grid-column: 1 / -1;
    }
  }
</style>
