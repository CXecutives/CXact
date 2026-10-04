// The preview's menu (tools/ui-preview.cmd): a small button in the middle of the top bar that
// opens the table below, to jump straight into a state of the app without clicking there:
// every step of the setup, every failure of the CV, an empty list, a search that runs, no
// fitting job, an excluded job, an open profile, no mailbox; "Von vorn" starts the state shown
// again (the stub keeps its data in memory, the page's store is cleared too). It lives in the
// stub, which only the harness build contains (vite.config.ts aliases @tauri-apps/api to it in
// `--mode harness`), so the app never has it (specs/preview.spec.ts checks the release build).
// The specs drive the same build without it (`navigator.webdriver`), `?menu` shows it anyway.
// A new state is one row here (and its scenario in the stub's SCENARIOS where it needs one).
// The labels are German: the menu speaks to the product owner, like the app.

/** One entry: its words and the address it opens (`scenario`, `step`, `cv`, `open`, ...). */
interface Entry {
  label: string;
  query: string;
}

const SETUP = 'scenario=first-run&step=';
const CV = 'scenario=first-run&step=reading&cv=';

export const PREVIEW_MENU: readonly { heading: string; entries: readonly Entry[] }[] = [
  {
    heading: 'Einrichtung',
    entries: [
      { label: 'Willkommen', query: `${SETUP}welcome` },
      { label: 'Weg wählen', query: `${SETUP}way` },
      { label: 'Upload', query: `${SETUP}upload` },
      { label: 'Auswertung', query: `${SETUP}reading` },
      { label: 'Prüfen und ergänzen', query: `${SETUP}review` },
      { label: 'Alert-Mails', query: 'scenario=setup-profile' },
      { label: 'Fertig', query: 'scenario=setup-profile&step=done' },
      { label: 'Nach dem Zurücksetzen', query: 'scenario=reset' },
    ],
  },
  {
    heading: 'Lebenslauf-Fehler',
    entries: [
      { label: 'Limit erreicht', query: `${CV}limit` },
      { label: 'Keine Verbindung', query: `${CV}offline` },
      { label: 'Datei unlesbar', query: `${CV}unreadable` },
      { label: 'Pausiert', query: `${CV}unavailable` },
      { label: 'Version veraltet', query: `${CV}outdated` },
    ],
  },
  {
    heading: 'Jobs',
    entries: [
      { label: 'Mit Beispieldaten', query: 'scenario=default' },
      { label: 'Leere Liste', query: 'scenario=fresh' },
      { label: 'Suche läuft', query: 'scenario=searching' },
      { label: 'Keine Treffer', query: 'scenario=empty' },
      { label: 'Ausgeschlossener Job', query: 'scenario=default&open=freelance:900412' },
      { label: 'Kein Postfach', query: 'scenario=no-mailbox' },
    ],
  },
  {
    heading: 'Profil',
    entries: [
      { label: 'Profil unvollständig', query: 'scenario=profile-incomplete&view=profile' },
      { label: 'Kein Profil', query: 'scenario=no-profile&view=profile' },
    ],
  },
];

/** The address of an entry, keeping the platform the preview shows. */
function addressOf(query: string): string {
  const next = new URLSearchParams(query);
  const platform = new URLSearchParams(location.search).get('platform');
  if (platform !== null) next.set('platform', platform);
  return `${location.pathname}?${next.toString()}`;
}

/** Opens a state: the page's store is cleared (the kept open job, the sidebar), then loaded. */
function openState(query: string | null): void {
  try {
    localStorage.clear();
  } catch {
    // Without a store nothing was kept.
  }
  if (query === null) location.reload();
  else location.assign(addressOf(query));
}

export const preview = {
  /** The app restarts in a scenario (after "Zurücksetzen": the setup). */
  restart(scenario: string): void {
    openState(`scenario=${scenario}`);
  },
};

const STYLE = `
  :host { all: initial; }
  .corner { position: fixed; z-index: 2147483000; top: 4px; left: 50%; transform: translateX(-50%);
    font: 13px/1.4 Inter, system-ui, sans-serif; color: var(--text, #222); }
  button { font: inherit; color: inherit; cursor: default; }
  .open { height: 28px; padding: 0 12px; border-radius: 14px; border: 1px solid var(--border, #ccc);
    background: var(--surface, #fff); box-shadow: var(--sh-menu, 0 4px 16px rgb(0 0 0 / 15%)); }
  .panel { position: absolute; left: 50%; top: 34px; transform: translateX(-50%); width: 240px;
    max-height: 80vh; overflow: auto;
    padding: 8px; border-radius: 12px; border: 1px solid var(--border, #ccc);
    background: var(--surface, #fff); box-shadow: var(--sh-menu, 0 4px 16px rgb(0 0 0 / 15%)); }
  .panel[hidden] { display: none; }
  h3 { margin: 8px 8px 4px; font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.04em; color: var(--text-subtle, #888); }
  .entry { display: block; width: 100%; padding: 4px 8px; border: 0; border-radius: 6px;
    background: none; text-align: left; }
  .entry:hover { background: var(--surface-hover, #f2f2f2); }
  .again { margin-top: 8px; border-top: 1px solid var(--border, #ddd); padding-top: 8px; }
`;

/** Builds the menu once the page is there (only in the preview, or with `?menu`). */
export function installPreviewMenu(): void {
  const asked = new URLSearchParams(location.search).has('menu');
  if (navigator.webdriver && !asked) return;
  const mount = (): void => {
    const host = document.createElement('div');
    host.dataset.testid = 'preview-menu';
    const root = host.attachShadow({ mode: 'open' });
    // A constructed sheet: the app's CSP allows no inline style.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    const corner = document.createElement('div');
    corner.className = 'corner';
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.hidden = true;
    const toggle = document.createElement('button');
    toggle.className = 'open';
    toggle.textContent = 'Vorschau';
    toggle.addEventListener('click', () => (panel.hidden = !panel.hidden));
    for (const group of PREVIEW_MENU) {
      const heading = document.createElement('h3');
      heading.textContent = group.heading;
      panel.append(heading);
      for (const entry of group.entries) {
        const button = document.createElement('button');
        button.className = 'entry';
        button.textContent = entry.label;
        button.addEventListener('click', () => openState(entry.query));
        panel.append(button);
      }
    }
    const again = document.createElement('button');
    again.className = 'entry again';
    again.textContent = 'Von vorn';
    again.addEventListener('click', () => openState(null));
    panel.append(again);
    corner.append(toggle, panel);
    root.append(corner);
    document.body.append(host);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount);
  else mount();
}
