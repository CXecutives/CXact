// Shows a control hovered, pressed or focused without a pointer or a key, for the states
// pages: every rule of the page's style sheets whose selector holds `:hover`, `:active:hover`,
// `:focus-within` or `:focus-visible` is copied once with that pseudo-class replaced by an
// attribute (`[data-force~="hover"]`, `press`, `focus`), so the components keep their own CSS
// and know nothing of this. `use:force={{ state: 'hover', target: 'button' }}` on a cell
// gives the attribute to the cell's elements that match `target` (a pressed control is
// hovered too: `'hover press'`).

import type { Action } from 'svelte/action';

const PSEUDO: readonly [RegExp, string][] = [
  [/:active:hover/g, '[data-force~="press"]'],
  [/:hover/g, '[data-force~="hover"]'],
  [/:focus-within/g, '[data-force~="focus"]'],
  [/:focus-visible/g, '[data-force~="focus"]'],
];

let installed = false;

/** The copies of `rules` with the pseudo-classes forced, inside their media queries. */
function forced(rules: CSSRuleList): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const selector = rule.selectorText;
      if (!PSEUDO.some(([pattern]) => selector.match(pattern) !== null)) continue;
      const next = PSEUDO.reduce((text, [pattern, by]) => text.replace(pattern, by), selector);
      out.push(`${next} { ${rule.style.cssText} }`);
    } else if (rule instanceof CSSMediaRule) {
      const inner = forced(rule.cssRules);
      if (inner.length > 0) out.push(`@media ${rule.conditionText} { ${inner.join('\n')} }`);
    }
  }
  return out;
}

function install(): void {
  if (installed) return;
  installed = true;
  const copies = [...document.styleSheets].flatMap((sheet) => {
    try {
      return forced(sheet.cssRules);
    } catch {
      return [];
    }
  });
  const sheet = new CSSStyleSheet();
  for (const copy of copies) {
    try {
      sheet.insertRule(copy, sheet.cssRules.length);
    } catch {
      // A selector the engine does not take as a copy: that state is simply not forced.
    }
  }
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

export const force: Action<HTMLElement, { state: string; target?: string }> = (node, param) => {
  install();
  const apply = ({ state, target }: { state: string; target?: string }): void => {
    const nodes = target === undefined ? [node] : [...node.querySelectorAll(target)];
    for (const each of nodes) each.setAttribute('data-force', state);
  };
  apply(param);
  return { update: apply };
};
