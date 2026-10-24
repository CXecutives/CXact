// The preview's menu (tools/ui-preview.cmd): a tiny quiet round button in the bottom right
// corner that opens the table below, to jump straight into a state of the app without clicking
// there: the first open (the default, a demo the whole way through), every step of the setup,
// every failure of the CV, an empty list, a search that runs, no fitting job, a scored, an
// unscored and an excluded job, the profile complete, incomplete and missing, Einstellungen
// with and without a mailbox and with the errors of the mailbox and the portals; "Von vorn" starts the state shown again (the stub keeps its data
// in memory and the demo in sessionStorage, both are cleared with the page's store). It lives in the
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
    heading: 'Bausteine',
    entries: [
      { label: 'Bedienelemente', query: 'sheet=controls' },
      { label: 'Flächen', query: 'sheet=surfaces' },
    ],
  },
  {
    heading: 'Einrichtung',
    entries: [
      { label: 'Erster Start (Demo)', query: 'scenario=demo' },
      { label: 'Willkommen', query: 'scenario=first-run' },
      { label: 'Profil anlegen', query: `${SETUP}way` },
      { label: 'Upload', query: `${SETUP}upload` },
      { label: 'Auswertung', query: `${SETUP}reading` },
      { label: 'Dein Profil (nach KI)', query: 'scenario=setup-cv&step=profile' },
      { label: 'Dein Profil (selbst)', query: `${SETUP}profile&way=self` },
      { label: 'Postfach', query: 'scenario=setup-profile' },
      { label: 'Fertig', query: 'scenario=setup-mailbox' },
      { label: 'Fertig ohne Postfach', query: 'scenario=setup-profile&step=done' },
    ],
  },
  {
    heading: 'Lebenslauf-Fehler',
    entries: [
      { label: 'Limit erreicht', query: `${CV}limit` },
      { label: 'Keine Verbindung', query: `${CV}offline` },
      { label: 'Zu lange gedauert', query: `${CV}timeout` },
      { label: 'Datei unlesbar', query: `${CV}unreadable` },
      { label: 'Datei zu groß', query: `${CV}tooBig` },
      { label: 'Format unbekannt', query: `${CV}unsupported` },
      { label: 'Nicht verfügbar', query: `${CV}unavailable` },
      { label: 'Pausiert', query: `${CV}paused` },
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
      { label: 'Bewerteter Job', query: 'scenario=default&open=freelancermap:2801' },
      { label: 'Unbewerteter Job', query: 'scenario=default&open=linkedin:4100200302' },
      { label: 'Ausgeschlossener Job', query: 'scenario=default&open=freelance:900412' },
    ],
  },
  {
    heading: 'Profil',
    entries: [
      { label: 'Profil vollständig', query: 'scenario=default&view=profile' },
      { label: 'Profil unvollständig', query: 'scenario=profile-incomplete&view=profile' },
      { label: 'Kein Profil', query: 'scenario=no-profile&view=profile' },
      { label: 'Lebenslauf heute ausgeschöpft', query: 'scenario=default&view=profile&cv=used' },
    ],
  },
  {
    heading: 'Einstellungen',
    entries: [
      { label: 'Mit Postfach', query: 'scenario=default&view=settings' },
      { label: 'Ohne Postfach', query: 'scenario=no-mailbox&view=settings' },
      { label: 'Postfach nicht erreichbar', query: 'scenario=offline&view=settings' },
      { label: 'Anmeldung abgelaufen', query: 'scenario=sign-in-expired&view=settings' },
      { label: 'App-Passwort abgelehnt', query: 'scenario=mailbox-refused&view=settings' },
      { label: 'Portal pausiert', query: 'scenario=paused&view=settings' },
      { label: 'Alert-Mail bleibt aus', query: 'scenario=quiet-alert&view=settings' },
      { label: 'Noch angemeldet', query: 'scenario=session-left&view=settings' },
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
    sessionStorage.clear();
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
  .corner { position: fixed; z-index: 2147483000; right: 3px; bottom: 3px;
    font: 13px/1.4 Geist, system-ui, sans-serif; color: var(--text, #222); }
  button { font: inherit; color: inherit; cursor: default; }
  .open { display: grid; place-items: center; width: 16px; height: 16px; padding: 0;
    border-radius: 8px; border: 1px solid var(--border, #ccc); background: var(--surface, #fff);
    color: var(--text-subtle, #888); opacity: 0.55; transition: opacity 120ms ease-out; }
  .open:hover, .open[aria-expanded='true'] { opacity: 1; }
  .open svg { width: 10px; height: 10px; }
  .panel { position: absolute; right: 0; bottom: 22px; width: 240px;
    max-height: calc(100vh - 60px); overflow: auto;
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

/** The button's glyph: three stacked lines (an SVG, no text). */
function glyph(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const y of [4, 8, 12]) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '3');
    line.setAttribute('x2', '13');
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linecap', 'round');
    svg.append(line);
  }
  return svg;
}

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
    toggle.setAttribute('aria-label', 'Vorschau');
    toggle.title = 'Vorschau';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(glyph());
    const show = (open: boolean): void => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => show(toggle.getAttribute('aria-expanded') !== 'true'));
    // A click anywhere else folds it again.
    addEventListener('pointerdown', (event) => {
      if (!event.composedPath().includes(host)) show(false);
    });
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
