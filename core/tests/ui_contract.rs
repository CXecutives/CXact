//! Architecture rules of the UI (`ui/src`, Svelte 5 + TypeScript). They run without Node,
//! so `cargo test` alone keeps them: each rule protects a promise of the design system
//! that ESLint/Stylelint also enforce, or one that no linter can see (gallery coverage,
//! per-OS markup, the release build without gallery).
//!
//! Every test asserts how many files it scanned: a moved folder must not turn a rule into
//! a silent no-op.

use std::path::{Path, PathBuf};

/// File kinds of the UI source.
const EXTENSIONS: [&str; 3] = ["svelte", "ts", "css"];
/// Lower bounds of the scan (the foundation has more than this).
const MIN_FILES: usize = 55;
const MIN_SVELTE: usize = 35;
const MIN_COMPONENTS: usize = 24;

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

struct Source {
    /// Path relative to `ui/src`, with forward slashes.
    path: String,
    ext: String,
    /// The text with comments blanked out (line numbers stay valid).
    code: String,
}

impl Source {
    fn is(&self, path: &str) -> bool {
        self.path == path
    }

    fn under(&self, dir: &str) -> bool {
        self.path.starts_with(dir)
    }

    fn lines(&self) -> impl Iterator<Item = (usize, &str)> {
        self.code.lines().enumerate().map(|(i, l)| (i + 1, l))
    }
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else {
            out.push(path);
        }
    }
}

fn sources() -> Vec<Source> {
    let root = repo("ui/src");
    let mut paths = Vec::new();
    walk(&root, &mut paths);
    let mut out: Vec<Source> = paths
        .into_iter()
        .filter_map(|path| {
            let ext = path.extension()?.to_str()?.to_string();
            if !EXTENSIONS.contains(&ext.as_str()) {
                return None;
            }
            let text = std::fs::read_to_string(&path).ok()?;
            let rel = path
                .strip_prefix(&root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some(Source {
                path: rel,
                code: strip_comments(&text),
                ext,
            })
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// All sources, after checking that the scan found the UI at all.
fn scanned(min: usize) -> Vec<Source> {
    let all = sources();
    assert!(
        all.len() >= min,
        "only {} files scanned in ui/src (expected at least {min}) - did the UI move?",
        all.len()
    );
    all
}

/// Blank out `/* */`, `<!-- -->` and `//` comments, keeping newlines. A `//` only starts a
/// comment at the line start or after whitespace (URLs such as `https://` stay).
fn strip_comments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let starts = |i: usize, pat: &str| {
        pat.chars()
            .enumerate()
            .all(|(k, c)| chars.get(i + k) == Some(&c))
    };
    while i < chars.len() {
        let end = if starts(i, "/*") {
            Some("*/")
        } else if starts(i, "<!--") {
            Some("-->")
        } else {
            None
        };
        if let Some(end) = end {
            while i < chars.len() && !starts(i, end) {
                out.push(if chars[i] == '\n' { '\n' } else { ' ' });
                i += 1;
            }
            for _ in 0..end.len() {
                if i < chars.len() {
                    out.push(' ');
                    i += 1;
                }
            }
            continue;
        }
        let line_comment = starts(i, "//") && (i == 0 || chars[i - 1].is_whitespace());
        if line_comment {
            while i < chars.len() && chars[i] != '\n' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// The markup of a `.svelte` file: script and style blocks blanked out.
fn markup(code: &str) -> String {
    let mut out = code.to_string();
    for (open, close) in [("<script", "</script>"), ("<style", "</style>")] {
        while let Some(start) = out.find(open) {
            let Some(len) = out[start..].find(close) else {
                break;
            };
            let end = start + len + close.len();
            let blank: String = out[start..end]
                .chars()
                .map(|c| if c == '\n' { '\n' } else { ' ' })
                .collect();
            out.replace_range(start..end, &blank);
        }
    }
    out
}

/// Blank `{...}` expressions (nested braces included), keeping newlines.
fn without_expressions(text: &str) -> String {
    let mut depth = 0usize;
    text.chars()
        .map(|c| {
            let inside = depth > 0 || c == '{';
            if c == '{' {
                depth += 1;
            } else if c == '}' && depth > 0 {
                depth -= 1;
                return ' ';
            }
            if inside && c != '\n' { ' ' } else { c }
        })
        .collect()
}

fn fail(problems: &[String], rule: &str) {
    assert!(problems.is_empty(), "{rule}:\n  {}", problems.join("\n  "));
}

/// Lines of files outside `allowed` that contain one of `needles`.
fn find(all: &[Source], needles: &[&str], allowed: impl Fn(&Source) -> bool) -> Vec<String> {
    let mut problems = Vec::new();
    for source in all.iter().filter(|s| !allowed(s)) {
        for (n, line) in source.lines() {
            for needle in needles {
                if line.contains(needle) {
                    problems.push(format!("{}:{n}: {needle}", source.path));
                }
            }
        }
    }
    problems
}

#[test]
fn tauri_only_in_api() {
    let all = scanned(MIN_FILES);
    let mut problems = find(&all, &["@tauri-apps/", "__TAURI"], |s| {
        s.is("lib/ipc/api.ts") || s.under("lib/ipc/types/")
    });
    // The generated types may name Tauri's Channel type - as a type-only import, which
    // leaves no runtime access behind.
    for source in all.iter().filter(|s| s.under("lib/ipc/types/")) {
        for (n, line) in source.lines() {
            if line.contains("@tauri-apps/") && !line.trim_start().starts_with("import type") {
                problems.push(format!("{}:{n}: runtime import of Tauri", source.path));
            }
        }
    }
    fail(
        &problems,
        "Tauri is reached only through lib/ipc/api.ts (the harness swaps exactly that door)",
    );
}

#[test]
fn lucide_only_in_icon() {
    let all = scanned(MIN_FILES);
    fail(
        &find(&all, &["@lucide", "lucide-svelte"], |s| {
            s.is("components/Icon.svelte")
        }),
        "icons come only from components/Icon.svelte",
    );
}

#[test]
fn motion_libraries_only_in_lib_motion() {
    let all = scanned(MIN_FILES);
    fail(
        &find(
            &all,
            &[
                "svelte/transition",
                "svelte/animate",
                "svelte/motion",
                "svelte/easing",
                ".animate(",
            ],
            |s| s.under("lib/motion/"),
        ),
        "motion goes through lib/motion/ (tokens, reduced motion)",
    );
}

#[test]
fn raw_controls_only_in_components() {
    let all = scanned(MIN_FILES);
    let svelte: Vec<&Source> = all.iter().filter(|s| s.ext == "svelte").collect();
    assert!(
        svelte.len() >= MIN_SVELTE,
        "only {} .svelte files",
        svelte.len()
    );
    let mut problems = Vec::new();
    for source in svelte.iter().filter(|s| !s.under("components/")) {
        let text = without_expressions(&markup(&source.code));
        for (n, line) in text.lines().enumerate() {
            for tag in [
                "button", "input", "textarea", "select", "a", "svg", "img", "dialog",
            ] {
                let open = format!("<{tag}");
                for (at, _) in line.match_indices(&open) {
                    let next = line[at + open.len()..].chars().next();
                    if next.is_none_or(|c| c.is_whitespace() || c == '>' || c == '/') {
                        problems.push(format!("{}:{}: <{tag}>", source.path, n + 1));
                    }
                }
            }
        }
    }
    fail(
        &problems,
        "raw controls only inside components/ (use the design system)",
    );
}

#[test]
fn no_title_attribute_and_no_inline_style() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for source in &all {
        let text = if source.ext == "svelte" {
            without_expressions(&markup(&source.code))
        } else {
            String::new()
        };
        for (n, line) in text.lines().enumerate() {
            for bad in [" title=", " style=", " style:", "\ttitle=", "\tstyle="] {
                if line.contains(bad) {
                    problems.push(format!("{}:{}: {}", source.path, n + 1, bad.trim()));
                }
            }
        }
        for (n, line) in source.lines() {
            for bad in [
                "{title}",
                "style:",
                "cssText",
                "setAttribute('style'",
                "setAttribute('title'",
                ".title =",
            ] {
                // `style:` inside CSS (`font-style:` etc.) is fine; only markup directives count.
                if bad == "style:" && source.ext != "svelte" {
                    continue;
                }
                if bad == "style:" && !line.contains(" style:") {
                    continue;
                }
                if line.contains(bad) {
                    problems.push(format!("{}:{n}: {bad}", source.path));
                }
            }
        }
    }
    fail(
        &problems,
        "no native title (use the tooltip action) and no inline style (CSP; use cssVars)",
    );
}

#[test]
fn no_html_injection() {
    let all = scanned(MIN_FILES);
    fail(
        &find(
            &all,
            &[
                "{@html",
                "innerHTML",
                "outerHTML",
                "insertAdjacentHTML",
                "document.write",
            ],
            |_| false,
        ),
        "texts from mails are never inserted as HTML",
    );
}

#[test]
fn keyframes_only_in_motion_css() {
    let all = scanned(MIN_FILES);
    fail(
        &find(&all, &["@keyframes"], |s| s.is("styles/motion.css")),
        "@keyframes live only in styles/motion.css",
    );
}

#[test]
fn forbidden_css_features() {
    let all = scanned(MIN_FILES);
    let mut problems = find(
        &all,
        &[
            "prefers-color-scheme",
            "view-transition",
            "@starting-style",
            "scrollbar-gutter",
            "content-visibility",
            "!important",
        ],
        |_| false,
    );
    problems.extend(find(&all, &["color-mix("], |s| s.is("styles/tokens.css")));
    fail(
        &problems,
        "the palette is the one chosen in Einstellungen, never the OS's (no \
         prefers-color-scheme), Safari 17 baseline (no View Transitions, @starting-style, \
         scrollbar-gutter, content-visibility), colour maths only in tokens.css",
    );
}

#[test]
fn a_pressed_look_only_under_the_pointer() {
    // A control shows its pressed state only while the pointer is on it: pressed, then moved
    // off, it looks at rest again (like native buttons). So every `:active` style is
    // `:active:hover`; the scrollbar thumb keeps its drag look, a `:not(:active)` guard and
    // Svelte's `class:active` are no pressed styles.
    // Only the left button presses: the engines set `:active` for the right and the middle
    // button too, so input.ts marks such a press on :root (`data-aux-press`) and every pressed
    // style waits for `:root:not([data-aux-press])` (in a zero-specificity `:where`).
    const AUX_GUARD: &str = ":global(:where(:root:not([data-aux-press])))";
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    let mut unguarded = Vec::new();
    let mut pressed = 0;
    for source in &all {
        let mut previous = "";
        for (n, line) in source.lines() {
            // Prettier may put the guard on a line of its own before the selector.
            let guarded = line.trim_start().starts_with(AUX_GUARD) || previous.trim() == AUX_GUARD;
            previous = line;
            let mut rest = line;
            while let Some(i) = rest.find(":active") {
                let before = &rest[..i];
                let after = &rest[i + ":active".len()..];
                let directive = before.ends_with("class");
                let guard = before.trim_end().ends_with(',') || before.ends_with(":not(");
                let thumb = before.ends_with("scrollbar-thumb");
                let word = after.starts_with(|c: char| c.is_alphanumeric() || c == '-' || c == '_');
                let press = after.starts_with(":hover");
                if !(directive || guard || thumb || word || press) {
                    problems.push(format!("{}:{n}: {}", source.path, line.trim()));
                }
                if press && !thumb {
                    pressed += 1;
                    if !guarded {
                        unguarded.push(format!("{}:{n}: {}", source.path, line.trim()));
                    }
                }
                rest = after;
            }
        }
    }
    fail(
        &problems,
        "pressed styles are `:active:hover` (moving off a held control releases its look)",
    );
    assert!(
        pressed >= 10,
        "only {pressed} pressed styles found - did the rule move?"
    );
    fail(
        &unguarded,
        "pressed styles start with `:global(:where(:root:not([data-aux-press])))` (the right \
         and the middle button never press)",
    );
    let input = all
        .iter()
        .find(|s| s.is("lib/input/input.ts"))
        .expect("lib/input/input.ts");
    assert!(
        input.code.contains("dataset.auxPress") && input.code.contains("auxPress(true)"),
        "input.ts does not mark a press of the right or middle button (data-aux-press)"
    );
}

#[test]
fn palette_only_in_tokens() {
    let all = scanned(MIN_FILES);
    fail(
        &find(&all, &["var(--p-"], |s| s.is("styles/tokens.css")),
        "palette tokens (--p-*) are used only inside tokens.css; components use semantic tokens",
    );
}

#[test]
fn input_listeners_only_in_input_ts() {
    let all = scanned(MIN_FILES);
    let events = [
        "keydown",
        "keyup",
        "keypress",
        "contextmenu",
        "auxclick",
        "dblclick",
        "dragstart",
        "selectstart",
        "wheel",
        "gesturestart",
        "gesturechange",
    ];
    let needles: Vec<String> = events
        .iter()
        .flat_map(|e| [format!("'{e}'"), format!("\"{e}\""), format!("on{e}")])
        .collect();
    let needles: Vec<&str> = needles.iter().map(String::as_str).collect();
    fail(
        &find(&all, &needles, |s| s.is("lib/input/input.ts")),
        "key, context-menu, aux-button, wheel and gesture handling only in lib/input/input.ts",
    );
    let input = all
        .iter()
        .find(|s| s.is("lib/input/input.ts"))
        .expect("lib/input/input.ts");
    for event in [
        "keydown",
        "contextmenu",
        "mousedown",
        "mouseup",
        "click",
        "auxclick",
        "dblclick",
        "dragstart",
        "selectstart",
        "wheel",
    ] {
        assert!(
            input.code.contains(&format!("'{event}'")),
            "input.ts does not handle {event}"
        );
    }
    // Text a user would copy is marked `data-copy`: selectable (base.css) and let through
    // by the input policy (selection and Ctrl/Cmd+C).
    assert!(
        input.code.contains("[data-copy]"),
        "input.ts does not know the copyable text"
    );
    let base = all
        .iter()
        .find(|s| s.is("styles/base.css"))
        .expect("styles/base.css");
    assert!(
        base.code.contains("[data-copy]"),
        "base.css does not make the copyable text selectable"
    );
}

#[test]
fn every_component_is_in_the_gallery() {
    let all = scanned(MIN_FILES);
    let components: Vec<&Source> = all.iter().filter(|s| s.under("components/")).collect();
    assert!(
        components.len() >= MIN_COMPONENTS,
        "only {} components scanned",
        components.len()
    );
    let gallery: String = all
        .iter()
        .filter(|s| s.under("features/gallery/"))
        .map(|s| s.code.as_str())
        .collect();
    let missing: Vec<String> = components
        .iter()
        .filter(|c| !gallery.contains(&format!("$components/{}", &c.path["components/".len()..])))
        .map(|c| c.path.clone())
        .collect();
    fail(
        &missing,
        "every component appears in the gallery (features/gallery/)",
    );
}

/// Letter-bearing text in markup outside `{...}` expressions, or as a literal value of a
/// text prop. Texts come from `lib/i18n/de.ts` (gallery samples from its `gallery.ts`).
#[test]
fn no_text_literals_in_markup() {
    let all = scanned(MIN_FILES);
    let props = [
        "label=\"",
        "heading=\"",
        "text=\"",
        "placeholder=\"",
        "aria-label=\"",
        "alt=\"",
        "disabledReason=\"",
        "hint=\"",
        "message=\"",
    ];
    let mut problems = Vec::new();
    for source in all.iter().filter(|s| s.ext == "svelte") {
        let text = without_expressions(&markup(&source.code));
        // Text between tags: blank everything inside <...> (tags span lines).
        let mut depth = 0usize;
        let outside: String = text
            .chars()
            .map(|c| match c {
                '<' => {
                    depth += 1;
                    ' '
                }
                '>' => {
                    depth = depth.saturating_sub(1);
                    ' '
                }
                '\n' => '\n',
                _ if depth > 0 => ' ',
                _ => c,
            })
            .collect();
        for (n, line) in outside.lines().enumerate() {
            if line.chars().any(char::is_alphabetic) {
                problems.push(format!("{}:{}: \"{}\"", source.path, n + 1, line.trim()));
            }
        }
        for (n, line) in text.lines().enumerate() {
            for prop in props {
                for (at, _) in line.match_indices(prop) {
                    let value: String = line[at + prop.len()..]
                        .chars()
                        .take_while(|c| *c != '"')
                        .collect();
                    if value.chars().any(char::is_alphabetic) {
                        problems.push(format!("{}:{}: {prop}{value}\"", source.path, n + 1));
                    }
                }
            }
        }
        // The same props given a string literal in braces: `label={'Speichern'}`.
        for (n, line) in markup(&source.code).lines().enumerate() {
            for prop in props {
                let name = &prop[..prop.len() - 1];
                for quote in ['\'', '"', '`'] {
                    let open = format!("{name}{{{quote}");
                    for (at, _) in line.match_indices(&open) {
                        let starts_word = line[..at]
                            .chars()
                            .next_back()
                            .is_none_or(char::is_whitespace);
                        let value: String = line[at + open.len()..]
                            .chars()
                            .take_while(|c| *c != quote)
                            .collect();
                        if starts_word && value.chars().any(char::is_alphabetic) {
                            problems.push(format!("{}:{}: {open}{value}", source.path, n + 1));
                        }
                    }
                }
            }
        }
    }
    fail(
        &problems,
        "UI text only from lib/i18n/de.ts (fix: a key in de.ts and en.ts, read through t)",
    );
}

/// The keyboard stays native (audit 2026-09-24): fields take every character the layout
/// types, including `AltGr` (Windows) and Option (macOS, where @ is Option+L on a German
/// keyboard), and the editing keys of the OS; the macOS menu keeps its Cmd shortcuts
/// (Cmd+, too); Tab and Enter/Space work on controls; a modal dialog holds the focus; the
/// zoom guard is a wheel listener that exists only while Ctrl/Cmd is held. The behaviour
/// itself is tested in tools/ui-harness/specs/input.spec.ts on both engines.
#[test]
fn the_keyboard_stays_native() {
    let all = scanned(MIN_FILES);
    let file = |path: &str| -> &Source {
        all.iter()
            .find(|s| s.is(path))
            .unwrap_or_else(|| panic!("{path} missing"))
    };
    let input = &file("lib/input/input.ts").code;
    let platform = &file("lib/platform.ts").code;
    let mut problems = Vec::new();
    let mut need = |ok: bool, what: &str| {
        if !ok {
            problems.push(what.to_string());
        }
    };
    need(
        input.contains("getModifierState('AltGraph')") && input.contains("optionTypes"),
        "input.ts: AltGr and Option characters must type in fields",
    );
    need(
        platform.contains("optionTypes: mac"),
        "platform.ts: Option types characters on macOS",
    );
    need(
        input
            .lines()
            .any(|l| l.contains("MAC_MENU_KEYS = new Set(") && l.contains("','")),
        "input.ts: Cmd+, (Settings) must reach the macOS menu",
    );
    need(
        input.contains("EDITING_KEYS") && input.contains("redoWithY"),
        "input.ts: the editing keys of native fields (word, line, redo)",
    );
    need(
        input.contains("isFocusMove") && input.contains("pressesControl"),
        "input.ts: Tab moves the focus and Enter/Space press controls everywhere",
    );
    need(
        input.contains("[aria-modal=\"true\"]") && input.contains("cycleFocus"),
        "input.ts: a modal dialog holds the focus",
    );
    need(
        input.contains("removeEventListener('wheel'")
            && !input.contains("addEventListener(\n    'wheel'")
            && input.matches("addEventListener('wheel'").count() == 1,
        "input.ts: the non-passive wheel listener is attached only while Ctrl/Cmd is held",
    );
    let dialog = &file("components/Dialog.svelte").code;
    need(
        dialog.contains("aria-modal=\"true\"") && dialog.contains("tabindex=\"-1\""),
        "Dialog.svelte: modal and focusable (a click on its text keeps the focus inside)",
    );
    let field = &file("components/TextField.svelte").code;
    need(
        field.matches("inField").count() >= 2 && field.contains("use:formKeys"),
        "TextField.svelte: in-field buttons keep the caret; a search clears on Esc",
    );
    fail(&problems, "the keyboard stays native");
}

#[test]
fn per_os_code_only_in_platform_ts() {
    let all = scanned(MIN_FILES);
    fail(
        &find(
            &all,
            &[
                "'macos'",
                "\"macos\"",
                "'windows'",
                "\"windows\"",
                "userAgent",
                "data-platform",
            ],
            |s| {
                s.is("lib/platform.ts")
                    // Font smoothing and the scrollbars of the OS (documented differences).
                    || s.is("styles/base.css")
                    // `AppState.platform` is part of the IPC contract.
                    || s.under("lib/ipc/types/")
            },
        ),
        "per-OS differences live only in platform.ts (and base.css for font smoothing and \
         scrollbars); components ask platform.ts",
    );
}

fn config(name: &str) -> serde_json::Value {
    serde_json::from_str(&std::fs::read_to_string(repo(&format!("src-tauri/{name}"))).expect(name))
        .unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// The window has one top bar on both OS, drawn by the page like the Claude app's (user,
/// 2026-09-27): `TitleBar` above the sidebar and the sheet, the page's only drag region
/// (Tauri's drag script: its empty parts move the window, a double click maximizes). Windows
/// has no native title bar (`decorations: false`, the shadow, the rounded corners and the
/// resize borders stay): the page draws the caption buttons (`WindowButtons`, the only file
/// that presses them) and platform.rs answers the window procedure for the bar (`caption`:
/// `HTMAXBUTTON` over Maximieren opens the snap layouts). macOS keeps its native frame with
/// the traffic lights in the bar (`titleBarStyle` Overlay, the title hidden). The window only
/// through the app's commands in api.ts; no CSS app-region, no font of one OS for the glyphs.
#[test]
fn the_window_has_the_apps_own_top_bar() {
    let all = scanned(MIN_FILES);
    fail(
        &find(&all, &["data-tauri-drag-region"], |s| {
            s.is("features/shell/TitleBar.svelte")
        }),
        "drag regions only in the top bar",
    );
    fail(
        &find(
            &all,
            &[
                "app-region",
                "@tauri-apps/api/window",
                "getCurrentWindow",
                "startDragging",
                "Segoe Fluent",
                "Segoe MDL2",
            ],
            |_| false,
        ),
        "the window only through the app's commands (lib/ipc/api.ts); the caption glyphs are drawn",
    );
    fail(
        &find(&all, &["window_button"], |s| {
            s.is("components/WindowButtons.svelte")
                || s.is("lib/ipc/api.ts")
                || s.under("lib/ipc/types/")
        }),
        "only the caption buttons press the window's buttons",
    );
    let source = |path: &str| {
        all.iter()
            .find(|s| s.is(path))
            .unwrap_or_else(|| panic!("{path}"))
    };
    let bar = &source("features/shell/TitleBar.svelte").code;
    assert!(
        bar.contains("drawsWindowButtons()") && bar.contains("<WindowButtons"),
        "the top bar draws the caption buttons where platform.ts says so (Windows)"
    );
    assert!(
        source("App.svelte").code.contains("<TitleBar "),
        "the shell starts with the top bar"
    );

    let shared = config("tauri.conf.json");
    let window = &shared["app"]["windows"][0];
    assert_eq!(window["decorations"], false, "Windows: no native title bar");
    assert_eq!(
        window["shadow"], true,
        "the shadow, the rounded corners and the resize borders stay"
    );
    let windows = std::fs::read_to_string(repo("src-tauri/tauri.windows.conf.json"))
        .expect("tauri.windows.conf.json");
    for bad in ["decorations", "shadow", "titleBarStyle", "hiddenTitle"] {
        assert!(!windows.contains(bad), "tauri.windows.conf.json: {bad}");
    }
    let macos = config("tauri.macos.conf.json");
    let mac = &macos["app"]["windows"][0];
    assert_eq!(mac["decorations"], true, "macOS keeps its native frame");
    assert_eq!(
        mac["titleBarStyle"], "Overlay",
        "the traffic lights over the bar"
    );
    assert_eq!(mac["hiddenTitle"], true, "the title stays set but hidden");
    // The platform file replaces the window array: apart from the frame it is the same
    // window as the shared one.
    let mut same = mac.clone();
    let mut shared_window = window.clone();
    for key in [
        "decorations",
        "titleBarStyle",
        "hiddenTitle",
        "trafficLightPosition",
    ] {
        same.as_object_mut().expect("window").remove(key);
        shared_window.as_object_mut().expect("window").remove(key);
    }
    assert_eq!(same, shared_window, "one window, two frames");
    // Small enough to snap into every Windows 11 layout, quarters of 1366 x 768 included.
    let (min_width, min_height) = (window["minWidth"].as_u64(), window["minHeight"].as_u64());
    assert!(
        min_width.is_some_and(|w| w <= 480),
        "minWidth {min_width:?}"
    );
    assert!(
        min_height.is_some_and(|h| h <= 360),
        "minHeight {min_height:?}"
    );

    // Windows: the window procedure answers for the bar like a native caption.
    let platform = std::fs::read_to_string(repo("src-tauri/src/platform.rs")).expect("platform.rs");
    for needle in [
        "WM_NCHITTEST",
        "HTCAPTION",
        "HTMINBUTTON",
        "HTMAXBUTTON",
        "HTCLOSE",
        "SetWindowSubclass",
        "caption::attach(window)",
    ] {
        assert!(
            platform.contains(needle),
            "platform.rs: the caption of the top bar ({needle})"
        );
    }
}

/// The page's bar and the window procedure measure it the same: `--titlebar-height` and
/// `--titlebar-button-width` of tokens.css are core's `BAR_HEIGHT` and `CAPTION_BUTTON`, which
/// platform.rs hit-tests with (Windows, 36 px like Claude's bar there), and
/// `--titlebar-tools-start` and `--titlebar-tools-end` its `TOOLS_START` and `TOOLS_END`, the
/// room of the page's own buttons in the bar. On macOS the bar is
/// `--titlebar-height-macos` (44 px, base.css switches): the traffic lights sit 16 px from the
/// left and centred in it, and the bar keeps their room free.
#[test]
fn the_top_bar_measures_the_same_everywhere() {
    let tokens = std::fs::read_to_string(repo("ui/src/styles/tokens.css")).expect("tokens.css");
    let px = |name: &str| -> u64 {
        let line = tokens
            .lines()
            .find(|l| l.trim_start().starts_with(&format!("{name}:")))
            .unwrap_or_else(|| panic!("{name} missing"));
        line.split(':')
            .nth(1)
            .expect("value")
            .trim()
            .trim_end_matches(';')
            .trim_end_matches("px")
            .parse()
            .unwrap_or_else(|e| panic!("{name}: {e}"))
    };
    let bar = px("--titlebar-height");
    assert_eq!(
        bar,
        u64::from(jobalert_core::window::BAR_HEIGHT),
        "--titlebar-height = window::BAR_HEIGHT"
    );
    assert_eq!(
        px("--titlebar-button-width"),
        u64::from(jobalert_core::window::CAPTION_BUTTON),
        "--titlebar-button-width = window::CAPTION_BUTTON"
    );
    // Where the page draws its own buttons in the bar, the window over it leaves the pointer
    // to the page (`Bar::tools`).
    assert_eq!(
        px("--titlebar-tools-start"),
        u64::from(jobalert_core::window::TOOLS_START),
        "--titlebar-tools-start = window::TOOLS_START"
    );
    assert_eq!(
        px("--titlebar-tools-end"),
        u64::from(jobalert_core::window::TOOLS_END),
        "--titlebar-tools-end = window::TOOLS_END"
    );
    let lights =
        config("tauri.macos.conf.json")["app"]["windows"][0]["trafficLightPosition"].clone();
    let (x, y) = (
        lights["x"].as_u64().expect("x"),
        lights["y"].as_u64().expect("y"),
    );
    // Measured on the macOS CI runner (smoke line `SMOKE {"lights":...}`): the buttons are
    // 14 pt high and their centre sits 2 pt above `y` (y 18 gave centre 16), so y - 2 is the
    // centre that must meet the middle of the bar.
    let mac = px("--titlebar-height-macos");
    assert_eq!(y - 2, mac / 2, "traffic lights centred in the {mac} px bar");
    assert_eq!(x, 16, "traffic lights 16 px from the left, like Claude's");
    // Three buttons of 14 pt, 6 pt apart, and room to the right.
    assert!(
        x + 3 * 14 + 2 * 6 < px("--traffic-lights-width"),
        "the bar keeps room for the lights"
    );
    // The app places the lights itself (tao applies the inset only while its covered content
    // view draws) and reads the position from this configuration: one source, no second
    // number in the code.
    let platform = std::fs::read_to_string(repo("src-tauri/src/platform.rs")).expect("platform.rs");
    assert!(
        platform.contains("traffic_light_position") && platform.contains("pub mod lights"),
        "platform.rs places the traffic lights from trafficLightPosition"
    );
    for literal in [format!("{x}.0"), format!("{y}.0")] {
        assert!(
            !platform.contains(&literal),
            "platform.rs repeats the position ({literal}); read it from the configuration"
        );
    }
    // The one per-OS measure of the layout: the bar's height (below it the app is the same).
    let base = std::fs::read_to_string(repo("ui/src/styles/base.css")).expect("base.css");
    let mac_rules = base
        .split(":root[data-platform='macos'] {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .unwrap_or_default();
    assert_eq!(
        mac_rules.trim(),
        "--titlebar-height: var(--titlebar-height-macos);",
        "base.css: only the bar's height differs on macOS"
    );
}

/// The window wears the colour of the chosen palette before the page paints (platform.rs):
/// `--bg`, the colour of the top bar and the sidebar, which is also CXact's `backgroundColor`
/// in the configuration (the start before the choice is read). platform.rs names the token of
/// every palette and writes no colour of its own; the generated palette follows tokens.css
/// (core/tests/palette.rs).
#[test]
fn the_window_colour_is_the_token() {
    let platform = std::fs::read_to_string(repo("src-tauri/src/platform.rs")).expect("platform.rs");
    for (palette, prefix) in [("Cxact", ""), ("Light", "LIGHT_"), ("Dark", "DARK_")] {
        let arm = format!(
            "Palette::{palette} => WindowColours {{\n            \
             background: palette::{prefix}BG.rgb,\n        }}"
        );
        assert!(
            platform.contains(&arm),
            "window_colours({palette}) is --bg of the palette"
        );
    }
    let shared = config("tauri.conf.json");
    assert_eq!(
        shared["app"]["windows"][0]["backgroundColor"],
        jobalert_core::export::palette::BG.hex().as_str(),
        "backgroundColor = --bg"
    );
}

/// Motion stays snappy and calm (user test of the installed app): colour changes, entries,
/// view switches and dialogs within 180 ms, the fill of a ring within 400 ms, and no easing
/// that overshoots (no bounce). Nothing blurs a large area or animates layout.
#[test]
fn motion_stays_quick_and_calm() {
    let all = scanned(MIN_FILES);
    let tokens = all
        .iter()
        .find(|s| s.is("styles/tokens.css"))
        .expect("styles/tokens.css");
    let ms = |name: &str| -> u32 {
        let line = tokens
            .code
            .lines()
            .find(|l| l.trim_start().starts_with(&format!("{name}:")))
            .unwrap_or_else(|| panic!("{name} missing"));
        line.split(':')
            .nth(1)
            .expect("value")
            .trim()
            .trim_end_matches(';')
            .trim_end_matches("ms")
            .parse()
            .expect("milliseconds")
    };
    for name in [
        "--dur-instant",
        "--dur-hover",
        "--dur-fast",
        "--dur-base",
        "--dur-slow",
    ] {
        assert!(ms(name) <= 180, "{name} is {} ms (at most 180)", ms(name));
    }
    assert!(ms("--dur-reveal") <= 400, "--dur-reveal above 400 ms");
    let mut problems = Vec::new();
    for (n, line) in tokens.lines() {
        let Some(at) = line.find("cubic-bezier(") else {
            continue;
        };
        let inner = &line[at + "cubic-bezier(".len()..];
        let numbers: Vec<f64> = inner
            .split(')')
            .next()
            .unwrap_or_default()
            .split(',')
            .filter_map(|v| v.trim().parse().ok())
            .collect();
        if numbers.len() == 4
            && [numbers[1], numbers[3]]
                .iter()
                .any(|y| !(0.0..=1.0).contains(y))
        {
            problems.push(format!("tokens.css:{n}: easing overshoots"));
        }
    }
    problems.extend(find(
        &all,
        &["backdrop-filter", "filter: blur", "grid-template-rows var("],
        |_| false,
    ));
    fail(&problems, "quick, calm and cheap motion");
}

/// Two brand colours with two jobs (user decisions): coral acts, navy orients - and they
/// never blend. No second hue in a gradient (no coral-to-navy), no gradient text, no
/// "sparkles" cliché.
#[test]
fn the_brand_stays_coral() {
    let all = scanned(MIN_FILES);
    let tokens = all
        .iter()
        .find(|s| s.is("styles/tokens.css"))
        .expect("styles/tokens.css");
    let mut problems = Vec::new();
    let mut in_gradient = false;
    for (n, line) in tokens.lines() {
        if line.contains("gradient(") {
            in_gradient = true;
        }
        if in_gradient
            && [
                "--p-slate",
                "--p-navy",
                "--p-success",
                "--p-info",
                "--p-warning",
                "--p-danger",
            ]
            .iter()
            .any(|hue| line.contains(hue))
        {
            problems.push(format!("tokens.css:{n}: second hue in a gradient"));
        }
        if line.contains(';') {
            in_gradient = false;
        }
    }
    problems.extend(find(
        &all,
        &["background-clip: text", "'sparkles'", "\"sparkles\""],
        |_| false,
    ));
    fail(&problems, "coral-only brand");
}

#[test]
fn at_most_one_primary_button_per_view() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for source in all
        .iter()
        .filter(|s| s.ext == "svelte" && s.under("features/") && !s.under("features/gallery/"))
    {
        let count = source.code.matches("variant=\"primary\"").count();
        if count > 1 {
            problems.push(format!("{}: {count} primary buttons", source.path));
        }
    }
    fail(&problems, "at most one primary button per view");
}

#[test]
fn no_leftovers_from_development() {
    let all = scanned(MIN_FILES);
    fail(
        &find(
            &all,
            &["console.", "debugger", "TODO", "FIXME", "XXX"],
            |_| false,
        ),
        "no debugging leftovers in the UI",
    );
}

/// The UI catalogs: German, the source, and English, the same keys (a type error otherwise).
const CATALOGS: [&str; 2] = ["lib/i18n/de.ts", "lib/i18n/en.ts"];

fn catalog<'a>(all: &'a [Source], path: &str) -> &'a Source {
    all.iter()
        .find(|s| s.is(path))
        .unwrap_or_else(|| panic!("{path} missing"))
}

/// One word per thing (the glossary in the headers of de.ts and en.ts, the cleanup of
/// 2026-09-27); short texts, no walls of text.
#[test]
fn the_catalog_keeps_the_glossary() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for (n, line) in catalog(&all, "lib/i18n/de.ts").lines() {
        for (old, new) in [
            // The sources the app searches and those of alert mails (2026-10-01).
            ("Portal", "Quelle"),
            ("Portale", "Quellen"),
            ("Portals", "der Quelle"),
            ("Portalen", "Quellen"),
            ("Eintrag", "Job"),
            ("Volltext", "Anzeige"),
            ("Kandidat", "Job"),
            ("Treffer", "Übereinstimmung"),
            ("Passung", "Übereinstimmung"),
            ("Mailbox", "Postfach"),
            ("Details holen", "Anzeige laden"),
            // The work folder holds the profiles (and the overviews while they are written).
            ("Exportordner", "Arbeitsordner"),
            ("Ergebnisordner", "Arbeitsordner"),
            ("Dearchivieren", "Zurückholen"),
            ("Eingang", "Aktuell"),
            ("Farben", "Design"),
            ("Wartung", "App"),
            ("Favorit", "nothing (favourites are gone)"),
            ("Übersicht", "nothing (the overview is gone)"),
        ] {
            // Only the words the user reads count (keys like `fullMailbox` are code).
            if literals(line).iter().any(|text| words(text).contains(old)) {
                problems.push(format!("de.ts:{n}: \"{old}\" is called \"{new}\""));
            }
        }
    }
    for (n, line) in catalog(&all, "lib/i18n/en.ts").lines() {
        // An import names a file, not a thing the user reads.
        if line.trim_start().starts_with("import ") {
            continue;
        }
        for (old, new) in [
            ("Entry", "Job"),
            ("Entries", "Jobs"),
            ("Candidate", "Job"),
            ("Portal", "Source"),
            ("Portals", "Sources"),
            ("Full text", "Details"),
            ("Hit", "Match"),
            ("Hits", "Matches"),
            // "Inbox" is the place of the active jobs (next to Archive and Trash); the Gmail
            // account stays the "Mailbox".
            ("Pinned", "nothing (favourites are gone)"),
            ("Bookmark", "nothing (favourites are gone)"),
            ("Favourite", "nothing (favourites are gone)"),
            ("Overview", "nothing (the overview is gone)"),
            ("Fetch details", "Load ad"),
            ("Export folder", "Work folder"),
            ("Result folder", "Work folder"),
            ("Unarchive", "Move to inbox"),
            ("Colours", "Theme"),
            ("Maintenance", "App"),
            // Plain English, not German word for word (usability round 2): one message is
            // an "email", the profile's Wünsche are "preferences", Kompetenzen "skills", Orte
            // "locations", Offene Punkte "Needs attention".
            ("Mail", "Email"),
            ("Mails", "Emails"),
            ("Wish", "Preference"),
            ("Wishes", "Preferences"),
            ("Desired", "Preferred"),
            ("Competence", "Skill"),
            ("Competences", "Skills"),
            ("Places", "Locations"),
            ("Open points", "Needs attention"),
            ("Count anyway", "Include anyway"),
            // German says "endgültig" everywhere; English says Gmail's "forever".
            ("For good", "Forever"),
        ] {
            // Whole words in any case ("Hit" is no part of "white").
            let used = literals(line).iter().any(|text| {
                let plain: String = words(text)
                    .to_lowercase()
                    .chars()
                    .map(|c| if c.is_alphanumeric() { c } else { ' ' })
                    .collect();
                format!(" {plain} ").contains(&format!(" {} ", old.to_lowercase()))
            });
            if used {
                problems.push(format!("en.ts:{n}: \"{old}\" is called \"{new}\""));
            }
        }
    }
    for path in CATALOGS {
        let name = path.rsplit('/').next().unwrap_or(path);
        for (n, line) in catalog(&all, path).lines() {
            for quoted in line.split('\'').skip(1).step_by(2) {
                if quoted.chars().count() > 140 {
                    problems.push(format!(
                        "{name}:{n}: {} characters (max 140)",
                        quoted.chars().count()
                    ));
                }
            }
        }
    }
    fail(&problems, "glossary and length of the UI catalogs");
}

/// The keys of a table of a catalog that is typed open (`as Record<string, string>`): the
/// lines `key: ...` between `<name>: {` (or a constant `const <name>: ... = {` it names)
/// and the closing brace.
fn open_table_keys(catalog: &Source, name: &str) -> Vec<String> {
    let start = format!("{name}: {{");
    let constant = format!("const {name}: ");
    let mut keys = Vec::new();
    let mut inside = false;
    for (_, line) in catalog.lines() {
        let line = line.trim();
        if !inside {
            inside = line == start || (line.starts_with(&constant) && line.ends_with("= {"));
            continue;
        }
        if line.starts_with('}') {
            break;
        }
        if let Some((key, _)) = line.split_once(':') {
            keys.push(key.trim().to_owned());
        }
    }
    keys
}

/// The tables the type cannot hold to the German keys (typed `Record<string, string>`: the
/// countries) have the same keys in both catalogs.
#[test]
fn the_open_tables_have_the_same_keys() {
    let all = scanned(MIN_FILES);
    let (de, en) = (catalog(&all, CATALOGS[0]), catalog(&all, CATALOGS[1]));
    // English keeps the country names in a constant of its own (the exclusion reason
    // names the countries in words too).
    let german = open_table_keys(de, "country");
    assert!(german.len() >= 3, "country: {german:?}");
    assert_eq!(german, open_table_keys(en, "countryName"), "country");
}

/// The English catalog is English: no umlaut or sharp s and no German word in anything the
/// user reads. Product and portal names (CXact, freelance.de) and the name of
/// the German language (Deutsch) are no German words.
#[test]
fn the_english_catalog_has_no_german() {
    let all = scanned(MIN_FILES);
    let german = [
        "und",
        "der",
        "die",
        "das",
        "den",
        "dem",
        "nicht",
        "ist",
        "sind",
        "mit",
        "von",
        "für",
        "oder",
        "auf",
        "bei",
        "aus",
        "neu",
        "alle",
        "ein",
        "eine",
        "wird",
        "werden",
        "bitte",
        "noch",
        "kein",
        "keine",
        "zu",
        "im",
        "ohne",
        "abrufen",
        "passung",
        "postfach",
        "gemerkt",
        "merken",
        "profil",
        "einstellungen",
    ];
    let mut problems = Vec::new();
    let mut strings = 0;
    for (n, line) in catalog(&all, "lib/i18n/en.ts").lines() {
        for literal in literals(line) {
            let text = words(literal);
            strings += 1;
            if text.chars().any(|c| "äöüÄÖÜß„".contains(c)) {
                problems.push(format!("en.ts:{n}: German letters in \"{text}\""));
            }
            let lower = text.to_lowercase();
            for word in lower.split(|c: char| !c.is_alphanumeric()) {
                if german.contains(&word) {
                    problems.push(format!("en.ts:{n}: German \"{word}\" in \"{text}\""));
                }
            }
        }
    }
    assert!(strings >= 200, "only {strings} strings in en.ts");
    fail(&problems, "no German in the English catalog");
}

/// The string literals of one line: between single quotes and between backticks.
fn literals(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    for quote in ['\'', '`'] {
        out.extend(line.split(quote).skip(1).step_by(2));
    }
    out
}

/// The words of a literal: `${...}` expressions of a template blanked out.
fn words(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0usize;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if depth == 0 && c == '$' && chars.peek() == Some(&'{') {
            chars.next();
            depth = 1;
            out.push(' ');
        } else if depth > 0 {
            match c {
                '{' => depth += 1,
                '}' => depth -= 1,
                _ => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Both catalogs speak plainly (CLAUDE.md): no dash or em dash as a separator, no colon at
/// the end of a label or heading, no "X: Y" construction, no exclamation mark.
#[test]
fn the_catalog_has_no_ai_punctuation() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for path in CATALOGS {
        let name = path.rsplit('/').next().unwrap_or(path);
        let mut strings = 0;
        for (n, line) in catalog(&all, path).lines() {
            for literal in literals(line) {
                let text = words(literal);
                let text = text.as_str();
                strings += 1;
                // A lone dash is no separator: it stands for a value the ad does not state.
                for dash in [" - ", " – ", "–", "—"] {
                    if text.trim() != "–" && text.contains(dash) {
                        problems.push(format!("{name}:{n}: dash as a separator in \"{text}\""));
                    }
                }
                if text.trim_end().ends_with(':') {
                    problems.push(format!("{name}:{n}: colon at the end of \"{text}\""));
                }
                if text.contains(": ") {
                    problems.push(format!("{name}:{n}: \"X: Y\" in \"{text}\""));
                }
                let mut chars = text.chars().peekable();
                while let Some(c) = chars.next() {
                    if c == '!' && chars.peek() != Some(&'=') {
                        problems.push(format!("{name}:{n}: exclamation mark in \"{text}\""));
                    }
                }
            }
        }
        assert!(strings >= 200, "only {strings} strings in {name}");
    }
    fail(&problems, "plain punctuation in the UI catalogs");
}

/// Every text of a catalog is a single-quoted string or a template literal, the two kinds the
/// rules above read (a double-quoted one would slip past all of them). English writes its
/// apostrophes like its quotes, typographically ("The app’s", “Rewrite”), and joins two
/// main clauses with a conjunction, never with ", then" (the header of en.ts).
#[test]
fn the_catalog_texts_are_checked_and_plain() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for path in CATALOGS {
        let name = path.rsplit('/').next().unwrap_or(path);
        for (n, line) in catalog(&all, path).lines() {
            if line.contains('"') {
                problems.push(format!(
                    "{name}:{n}: a double-quoted text in \"{}\"",
                    line.trim()
                ));
            }
        }
    }
    let mut strings = 0;
    for (n, line) in catalog(&all, "lib/i18n/en.ts").lines() {
        let chars: Vec<char> = line.chars().collect();
        let straight = chars
            .windows(3)
            .any(|w| w[1] == '\'' && w[0].is_alphabetic() && w[2].is_alphabetic());
        if straight {
            problems.push(format!(
                "en.ts:{n}: a straight apostrophe in \"{}\"",
                line.trim()
            ));
        }
        for literal in literals(line) {
            strings += 1;
            if words(literal).contains(", then ") {
                problems.push(format!(
                    "en.ts:{n}: \", then\" joins two clauses in \"{literal}\""
                ));
            }
        }
    }
    assert!(strings >= 200, "only {strings} strings in en.ts");
    fail(&problems, "every catalog text checked, plain English");
}

/// Every number a catalog writes goes through its formatter `n` ("1.860 ausgewählt", not
/// "1860"): a parameter named `n` would hide the formatter in its function, so none is.
#[test]
fn the_catalog_formats_every_number() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for path in CATALOGS {
        let name = path.rsplit('/').next().unwrap_or(path);
        let source = catalog(&all, path);
        assert!(
            source
                .code
                .contains("const n = (value: number): string => formatNumber(value);"),
            "{name}: the number formatter `n` moved"
        );
        for (line, code) in source.lines() {
            // A parameter `n`, typed or not, first, later or alone.
            let declared = ["(n:", ", n:", "(n)", "(n,", ", n)", "(n =", " n =>"];
            if declared.iter().any(|pattern| code.contains(pattern)) {
                problems.push(format!(
                    "{name}:{line}: a parameter hides the formatter `n`"
                ));
            }
        }
    }
    fail(&problems, "numbers in the UI catalogs");
}

/* ------------------------------------------------------ one pattern per role */

fn source<'a>(all: &'a [Source], path: &str) -> &'a Source {
    all.iter()
        .find(|s| s.is(path))
        .unwrap_or_else(|| panic!("{path} missing"))
}

/// The attributes of every `<Name ...>` tag of a component in a file (up to its `/>`), with
/// the line it starts on.
fn component_tags(code: &str, name: &str) -> Vec<(usize, String)> {
    let open = format!("<{name}");
    let mut out = Vec::new();
    let mut rest = code;
    let mut offset = 0;
    while let Some(start) = rest.find(&open) {
        let after = &rest[start + open.len()..];
        if !after.starts_with(|c: char| c.is_whitespace() || c == '/' || c == '>') {
            offset += start + 1;
            rest = &rest[start + 1..];
            continue;
        }
        let end = after.find("/>").map_or(after.len(), |e| e + 2);
        let line = code[..offset + start].matches('\n').count() + 1;
        out.push((line, after[..end].to_string()));
        offset += start + 1;
        rest = &rest[start + 1..];
    }
    out
}

/// The icon map of lib/icons.ts: (meaning, glyph) in its order.
fn icon_map(all: &[Source]) -> Vec<(String, String)> {
    source(all, "lib/icons.ts")
        .lines()
        .filter_map(|(_, line)| {
            let (meaning, rest) = line.trim().split_once(": '")?;
            let glyph = rest.strip_suffix("',")?;
            let word = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric());
            (word(meaning)
                && glyph
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'))
            .then(|| (meaning.to_string(), glyph.to_string()))
        })
        .collect()
}

/// The string literals of `text` (single or double quoted, on one line).
fn quoted(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(['\'', '"']) {
        let quote = &rest[start..=start];
        let after = &rest[start + 1..];
        let Some(end) = after.find(quote) else { break };
        out.push(&after[..end]);
        rest = &after[end + 1..];
    }
    out
}

/// Icons by meaning: lib/icons.ts maps each meaning to one Lucide glyph and no glyph to two
/// meanings; every icon position in the UI names a meaning (`icon="trash"`), never a glyph.
#[test]
fn icons_by_meaning() {
    // The texts (the catalogs, the gallery's words) name no icons.
    const TEXTS: [&str; 3] = [
        "lib/i18n/de.ts",
        "lib/i18n/en.ts",
        "features/gallery/gallery.ts",
    ];
    let all = scanned(MIN_FILES);
    let map = icon_map(&all);
    assert!(
        map.len() >= 50,
        "only {} icon meanings read from lib/icons.ts",
        map.len()
    );
    let mut problems = Vec::new();
    let mut glyphs = std::collections::HashMap::new();
    for (meaning, glyph) in &map {
        if let Some(other) = glyphs.insert(glyph.as_str(), meaning.as_str()) {
            problems.push(format!(
                "lib/icons.ts: {glyph} means both {other} and {meaning}"
            ));
        }
    }
    let meanings: std::collections::HashSet<&str> = map.iter().map(|(m, _)| m.as_str()).collect();
    let icon = source(&all, "components/Icon.svelte");
    for glyph in glyphs.keys() {
        let key = if glyph.contains('-') {
            format!("'{glyph}':")
        } else {
            format!("{glyph}:")
        };
        if !icon.code.contains(&key) {
            problems.push(format!("Icon.svelte: no import for {glyph}"));
        }
    }
    let mut checked = 0;
    for source in all.iter().filter(|s| {
        !s.is("lib/icons.ts")
            && !s.is("components/Icon.svelte")
            && !TEXTS.contains(&s.path.as_str())
    }) {
        for (n, line) in source.lines() {
            // icon="x", trailing="x", icon: 'x', icon = 'x', name="x" on an Icon, and every
            // literal of an icon expression (icon={a ? 'x' : 'y'}) except a compared value.
            let mut spots: Vec<&str> = Vec::new();
            for key in ["icon=\"", "trailing=\"", "icon: '", "icon?: '", "icon = '"] {
                let mut rest = line;
                while let Some(at) = rest.find(key) {
                    let after = &rest[at + key.len()..];
                    let end = after.find(['"', '\'']).unwrap_or(after.len());
                    spots.push(&after[..end]);
                    rest = &after[end..];
                }
            }
            if line.contains("<Icon ")
                && let Some(at) = line.find("name=\"")
            {
                let after = &line[at + 6..];
                spots.push(&after[..after.find('"').unwrap_or(after.len())]);
            }
            for key in ["icon={", "name={"] {
                if key == "name={" && !line.contains("<Icon ") {
                    continue;
                }
                if let Some(at) = line.find(key) {
                    let expr = &line[at + key.len()..];
                    let expr = &expr[..expr.find('}').unwrap_or(expr.len())];
                    let mut rest = expr;
                    for literal in quoted(expr) {
                        let at = rest.find(literal).unwrap_or(0);
                        let before = rest[..at].trim_end_matches(['\'', '"']).trim_end();
                        if !before.ends_with("===") && !before.ends_with("!==") {
                            spots.push(literal);
                        }
                        rest = &rest[at + literal.len()..];
                    }
                }
            }
            for spot in spots {
                checked += 1;
                if !meanings.contains(spot) {
                    problems.push(format!("{}:{n}: '{spot}' is no icon meaning", source.path));
                }
            }
        }
    }
    assert!(
        checked >= 100,
        "only {checked} icon positions found - did the rule move?"
    );
    fail(
        &problems,
        "icons by meaning (lib/icons.ts): one glyph per meaning, meanings everywhere",
    );
}

/// Buttons have one height, 28 px (user 2026-10-01): no size to choose (a button inside a
/// field is a notch lower, a part of it), every glyph one size, one type.
#[test]
fn buttons_have_one_height() {
    let all = scanned(MIN_FILES);
    let button = source(&all, "components/Button.svelte");
    let mut problems = Vec::new();
    for gone in [
        "ButtonSize",
        "size?:",
        "--control-md",
        "--control-lg",
        "--type-md",
    ] {
        if button.code.contains(gone) {
            problems.push(format!("Button.svelte: {gone} (buttons have one height)"));
        }
    }
    for source in all.iter().filter(|s| s.ext == "svelte") {
        for (line, tag) in component_tags(&source.code, "Button") {
            if tag.contains(" size=") || tag.contains("{size}") {
                problems.push(format!("{}:{line}: <Button> with a size", source.path));
            }
        }
    }
    fail(&problems, "buttons have one height (28 px)");
}

/// A toast comes only through the toast API (lib/state/toasts.svelte.ts) and is drawn only
/// by components/Toast.svelte from its kinds table; nothing else draws a toast.
#[test]
fn toasts_only_through_the_toast_api() {
    let all = scanned(MIN_FILES);
    let mut problems = find(&all, &["toasts.items", "TOAST_KINDS", "TOAST_LIFE"], |s| {
        s.is("lib/state/toasts.svelte.ts") || s.is("components/Toast.svelte")
    });
    problems.extend(find(&all, &["data-testid=\"toast\""], |s| {
        s.is("components/Toast.svelte")
    }));
    let state = source(&all, "lib/state/toasts.svelte.ts");
    for kind in ["success:", "info:", "warning:"] {
        if !state.code.contains(kind) {
            problems.push(format!("toasts.svelte.ts: TOAST_KINDS has no {kind}"));
        }
    }
    fail(
        &problems,
        "toasts only through lib/state/toasts.svelte.ts and Toast.svelte",
    );
}

/// One tooltip: the `tooltip` action feeds the one layer (components/Tooltip.svelte), with
/// one delay (--delay-tooltip through lib/motion) and one look; no other bubble.
#[test]
fn one_tooltip() {
    let all = scanned(MIN_FILES);
    let mut problems = find(&all, &["tooltipState"], |s| {
        s.is("lib/actions/tooltip.ts")
            || s.is("lib/state/tooltip.svelte.ts")
            || s.is("components/Tooltip.svelte")
    });
    // The attribute (a selector that skips the layer, `[role="tooltip"]`, is no bubble).
    problems.extend(find(&all, &[" role=\"tooltip\""], |s| {
        s.is("components/Tooltip.svelte")
    }));
    problems.extend(find(&all, &["--delay-tooltip"], |s| {
        s.is("styles/tokens.css") || s.is("lib/motion/motion.ts")
    }));
    fail(&problems, "one tooltip layer, one delay, one look");
}

/// A success whose result shows nowhere else is a toast, never a lasting note in the view.
/// The notes below still say one inline; their views move them to a toast.
#[test]
fn quiet_successes_are_toasts() {
    const MOVING: [&str; 3] = [
        "features/profile/ProfileEditor.svelte",
        "features/settings/SettingsView.svelte",
        "features/first-run/FirstRunView.svelte",
    ];
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    let mut notices = 0;
    for source in all.iter().filter(|s| {
        s.ext == "svelte" && !s.under("features/gallery/") && !MOVING.contains(&s.path.as_str())
    }) {
        for (line, tag) in component_tags(&source.code, "Notice") {
            notices += 1;
            if tag.contains("tone=\"success\"") || tag.contains("'success'") {
                problems.push(format!("{}:{line}: a success Notice", source.path));
            }
        }
    }
    assert!(
        notices >= 10,
        "only {notices} Notices found - did the rule move?"
    );
    fail(
        &problems,
        "a quiet success is a toast (toasts.show), not a Notice",
    );
}

/// Every control answers by the kind of its surface (tokens.css "one answer per surface
/// kind"): the components read the kind tokens, not the washes behind them. The files below
/// belong to views that move to the kind tokens.
#[test]
fn one_answer_per_surface_kind() {
    const MOVING: [&str; 3] = [
        "components/JobRow.svelte",
        "components/ReasonItem.svelte",
        "components/StatTile.svelte",
    ];
    let all = scanned(MIN_FILES);
    let tokens = source(&all, "styles/tokens.css");
    let mut problems = Vec::new();
    for kind in [
        "--quiet-hover:",
        "--quiet-press:",
        "--control-hover:",
        "--control-hover-edge:",
        "--raised-hover-edge:",
        "--raised-hover-shadow:",
        "--raised-press:",
        "--label-hover:",
        "--label-press:",
    ] {
        if !tokens.code.contains(kind) {
            problems.push(format!("tokens.css: {kind} missing"));
        }
    }
    problems.extend(find(
        &all,
        &[
            "var(--surface-hover)",
            "var(--surface-press)",
            "var(--sh-hover)",
        ],
        |s| s.is("styles/tokens.css") || MOVING.contains(&s.path.as_str()),
    ));
    fail(&problems, "controls read the kind tokens of their surface");
}

/// No shortcuts of the app's own (user decision 2026-09-27): only what every program does
/// stays (typing and editing in fields, Tab, Enter, Esc, arrows in menus). No shortcuts table,
/// no key names in tooltips or menus, no fetch, view or search keys.
#[test]
fn no_app_shortcuts() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    if all.iter().any(|s| s.is("lib/input/keys.ts")) {
        problems.push("lib/input/keys.ts: the shortcuts table is gone".to_owned());
    }
    problems.extend(find(
        &all,
        &[
            "'F5'",
            "'mod+",
            "\"mod+",
            "Digit1",
            "isFetchKey",
            "onFetchKey",
            "LIST_KEYS",
            "KeysHelp",
        ],
        |_| false,
    ));
    fail(&problems, "no shortcuts of the app's own");
}

/// No "·" as a separator (user decision 2026-09-27): company and place carry their icons,
/// everything else takes a comma or a line of its own. Nothing the user reads writes the dot:
/// no markup, no CSS `content`, no catalog text, also not as an escape. Comments may name it;
/// the gallery (a developer board) is left out.
#[test]
fn no_middle_dot() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    let mut scanned_files = 0;
    for source in all.iter().filter(|s| !s.under("features/gallery/")) {
        scanned_files += 1;
        for (n, line) in source.lines() {
            let lower = line.to_lowercase();
            for dot in [
                "\u{b7}", "\\u00b7", "\\u{b7}", "\\00b7", "\\0000b7", "&middot;", "&#183;",
                "&#xb7;",
            ] {
                if lower.contains(dot) {
                    problems.push(format!("{}:{n}: {dot}", source.path));
                }
            }
        }
    }
    assert!(scanned_files >= MIN_FILES, "only {scanned_files} files");
    fail(
        &problems,
        "no middle dot as a separator (an icon, a comma or a line of its own)",
    );
}

/// Tooltips only where something is missing (user decision 2026-09-27): a button that shows
/// only its glyph, text that is cut off, the reason a control waits. A tooltip never repeats
/// the words that stand there: `Button` has no second tooltip line (`hint`) and no key
/// (`keys`), and it names its label in a tooltip only while it shows no words; the sidebar
/// names an entry in a tooltip only while it is a rail of icons.
#[test]
fn tooltips_only_where_something_is_missing() {
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    let button = source(&all, "components/Button.svelte");
    for prop in ["hint?:", "keys?:", "hint =", "keys ="] {
        if button.code.contains(prop) {
            problems.push(format!(
                "components/Button.svelte: the prop `{prop}` is gone"
            ));
        }
    }
    let tip = button
        .code
        .split_once("const tip = $derived(")
        .and_then(|(_, rest)| rest.split_once(");"))
        .map(|(expression, _)| expression.to_string())
        .unwrap_or_default();
    if !tip.contains("disabledReason") || !tip.contains("iconOnly") {
        problems.push(format!(
            "components/Button.svelte: its tooltip is the reason it waits or, with only its glyph, its label: {tip:?}"
        ));
    }
    let mut buttons = 0;
    for source in all.iter().filter(|s| s.ext == "svelte") {
        for (line, tag) in component_tags(&source.code, "Button") {
            buttons += 1;
            for bad in [" hint=", " keys=", "{hint}", "{keys}"] {
                if tag.contains(bad) {
                    problems.push(format!("{}:{line}: <Button {}>", source.path, bad.trim()));
                }
            }
        }
    }
    assert!(buttons >= 30, "only {buttons} <Button> tags found");
    let nav = source(&all, "components/SideNav.svelte");
    let mut labelled = 0;
    for (at, _) in nav.code.match_indices("use:tooltip={") {
        let rest = &nav.code[at..];
        let mut depth = 0usize;
        let mut end = rest.len();
        for (i, c) in rest.char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i;
                        break;
                    }
                }
                _ => {}
            }
        }
        let expression = &rest[..end];
        if expression.contains("item.label") {
            labelled += 1;
            if !expression.contains("collapsed") {
                problems.push(format!(
                    "components/SideNav.svelte: an entry's name is its tooltip only in the rail: {expression}"
                ));
            }
        }
    }
    assert!(
        labelled >= 1,
        "SideNav names no entry in a tooltip - did the rail move?"
    );
    fail(
        &problems,
        "a tooltip only where something is missing, never the words that stand there",
    );
}

/// Coral means act, new and where you are (tokens.css): each coral role is drawn only by the
/// components of that role, so coral cannot creep into a heading, a link or a hover.
#[test]
fn coral_only_in_its_roles() {
    const ROLES: [(&str, &[&str]); 8] = [
        // The one primary action of a view.
        ("var(--primary", &["components/Button.svelte"]),
        // A switch that is on, and the check of a chosen row.
        (
            "var(--toggle-on",
            &["components/Toggle.svelte", "components/JobRow.svelte"],
        ),
        // The dot of a job not opened yet, what is new in a place (the tab's count) and the
        // dot of a filter that is on (the approved design, 2026-09-26).
        (
            "var(--unread",
            &[
                "components/JobRow.svelte",
                "components/Tabs.svelte",
                "components/Button.svelte",
            ],
        ),
        // Where you are: the selected row, its bar and its ring track, the active view.
        (
            "var(--surface-selected",
            &["components/ListRow.svelte", "components/JobRow.svelte"],
        ),
        (
            "var(--selection-bar",
            &["components/ListRow.svelte", "features/jobs/RowBar.svelte"],
        ),
        ("var(--ring-track-selected", &["components/ListRow.svelte"]),
        (
            "var(--nav-active-icon",
            &["components/SideNav.svelte", "components/Tabs.svelte"],
        ),
        // New: the soft count and the coral tone of a badge, a tile and a stat.
        (
            "var(--accent",
            &[
                "components/Badge.svelte",
                "components/IconTile.svelte",
                "components/StatTile.svelte",
            ],
        ),
    ];
    let all = scanned(MIN_FILES);
    let mut problems = Vec::new();
    for (needle, allowed) in ROLES {
        problems.extend(find(&all, &[needle], |s| {
            s.is("styles/tokens.css")
                || s.under("features/gallery/")
                || allowed.contains(&s.path.as_str())
        }));
    }
    problems.extend(find(&all, &["var(--count-soft-"], |s| {
        s.is("styles/tokens.css") || s.is("components/Count.svelte")
    }));
    problems.extend(find(&all, &["var(--p-coral"], |s| {
        s.is("styles/tokens.css")
    }));
    fail(
        &problems,
        "coral only in its roles (act, new, where you are)",
    );
}

/// The release build must not ship the gallery (it is compiled out via `__GALLERY__`).
#[test]
fn the_release_build_has_no_gallery() {
    scanned(MIN_FILES);
    let dist = repo("ui/dist");
    if !dist.exists() {
        return;
    }
    let mut files = Vec::new();
    walk(&dist, &mut files);
    let mut problems = Vec::new();
    let mut checked = 0;
    for file in files {
        let Some(ext) = file.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if !["js", "css", "html"].contains(&ext) {
            continue;
        }
        checked += 1;
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        for bad in ["Galerie", "gallery", "ColourBoard", "MotionBoard"] {
            if text.contains(bad) {
                problems.push(format!("{}: {bad}", file.display()));
            }
        }
    }
    assert!(
        checked >= 2,
        "ui/dist exists but holds no build ({checked} files)"
    );
    fail(&problems, "the gallery is development-only");
}
