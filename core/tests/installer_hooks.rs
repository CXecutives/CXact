//! DS-1: the Windows setup of CXact removes an install of the old name "Job-Alert-Monitor"
//! before it installs, silently and without its data, and never touches its own install.
//! Left in place, the old entry under Apps has an uninstaller whose "delete the app data" box
//! deletes the data folder both names share (same identifier): the database, its backups,
//! the settings. The hook (`src-tauri/windows/hooks.nsh`) is checked here against what it must
//! contain, and Tauri's NSIS template (in the CLI's binary) against what the hook relies on.
//!
//! By hand on Windows, with Job-Alert-Monitor 3.0.0 installed: run the new setup from the
//! Explorer, then `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Job-Alert-Monitor"`
//! fails, `%LOCALAPPDATA%\Job-Alert-Monitor` is gone, Apps and the Start menu show CXact only,
//! and `%LOCALAPPDATA%\de.cxecutives.job-alert-monitor\jobs.db` and `backups\` are unchanged.

use std::path::{Path, PathBuf};

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

fn read(relative: &str) -> String {
    std::fs::read_to_string(repo(relative))
        .unwrap_or_else(|e| panic!("{relative}: {e}"))
        .replace("\r\n", "\n")
}

/// The body of `!macro name` up to its `!macroend`.
fn nsis_macro<'a>(source: &'a str, name: &str) -> &'a str {
    let start = source
        .find(&format!("!macro {name}"))
        .unwrap_or_else(|| panic!("!macro {name} missing"));
    let rest = &source[start..];
    &rest[..rest.find("!macroend").expect("!macroend")]
}

/// The script lines of an NSIS text, trimmed, without comments and blank lines.
fn code(text: &str) -> Vec<&str> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with(';'))
        .collect()
}

/// Index of the first line containing `needle`.
fn line_of(lines: &[&str], needle: &str) -> usize {
    lines
        .iter()
        .position(|line| line.contains(needle))
        .unwrap_or_else(|| panic!("no line with {needle}"))
}

const OLD_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Job-Alert-Monitor";

#[test]
fn ds_1_the_setup_removes_the_old_install_and_keeps_its_data() {
    let hooks = read("src-tauri/windows/hooks.nsh");
    let lines = code(nsis_macro(&hooks, "NSIS_HOOK_PREINSTALL"));

    // Only a build under another name removes "Job-Alert-Monitor".
    assert_eq!(
        lines.get(1).copied(),
        Some(r#"!if "${PRODUCTNAME}" != "Job-Alert-Monitor""#)
    );
    // The value Tauri really writes, from the old name's own entry (never CXact's).
    let uninstall = line_of(&lines, "\"UninstallString\"");
    assert_eq!(
        lines[uninstall],
        format!(r#"ReadRegStr $0 HKCU "{OLD_KEY}" "UninstallString""#)
    );
    assert!(
        lines.contains(&format!(r#"ReadRegStr $1 HKCU "{OLD_KEY}" "DisplayName""#).as_str())
            && lines.contains(&r#"${AndIf} $1 == "Job-Alert-Monitor""#),
        "only an entry that is the old app's"
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("QuietUninstallString")),
        "Tauri never writes QuietUninstallString: the old install would never go"
    );
    assert!(
        lines
            .iter()
            .filter(|line| line.contains("Uninstall\\"))
            .all(|line| line.contains(OLD_KEY)),
        "no other Apps entry is read"
    );

    // Silent (so the delete-app-data box is never read), in place and waited for.
    let exec: Vec<&&str> = lines
        .iter()
        .filter(|line| line.starts_with("ExecWait"))
        .collect();
    assert_eq!(
        exec,
        [&r#"ExecWait '"$2\uninstall.exe" /S _?=$2' $1"#],
        "/S keeps the data, _?= (last, unquoted) makes ExecWait wait"
    );
    assert!(
        lines.iter().all(|line| !line.contains("/UPDATE")),
        "the old shortcuts go too"
    );
    // The user is asked before the old uninstaller closes the app (same binary as CXact).
    assert!(
        line_of(&lines, "!insertmacro CheckIfAppIsRunning") < line_of(&lines, "ExecWait"),
        "the running app is handled before the old uninstaller kills it silently"
    );
    // Its leftovers go only after it succeeded; a failure keeps its uninstaller.
    let ok = line_of(&lines, "${AndIf} $1 = 0");
    assert!(line_of(&lines, "ExecWait") < ok);
    assert!(ok < line_of(&lines, r#"Delete "$2\uninstall.exe""#));
    assert!(ok < line_of(&lines, r#"RMDir "$2""#));
    assert!(line_of(&lines, r#"RMDir "$2""#) < line_of(&lines, "SetOutPath $INSTDIR"));

    // Nothing here deletes data: no recursive delete, no data folder, no identifier.
    for line in &lines {
        let lower = line.to_ascii_lowercase();
        assert!(
            !lower.contains("rmdir /r")
                && !lower.contains("appdata")
                && !line.contains("${BUNDLEID}")
                && !lower.contains("de.cxecutives"),
            "the hook touches data: {line}"
        );
    }
    // The registers it borrows go back as they were.
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.starts_with("Push "))
            .count(),
        lines.iter().filter(|line| line.starts_with("Pop ")).count()
    );

    // The setup is per user under the new name, and runs this hook.
    let windows: serde_json::Value =
        serde_json::from_str(&read("src-tauri/tauri.windows.conf.json")).unwrap();
    let nsis = &windows["bundle"]["windows"]["nsis"];
    assert_eq!(
        nsis["installMode"], "currentUser",
        "the old entry is in HKCU"
    );
    assert_eq!(nsis["installerHooks"], "./windows/hooks.nsh");
    let conf: serde_json::Value = serde_json::from_str(&read("src-tauri/tauri.conf.json")).unwrap();
    assert_ne!(conf["productName"], "Job-Alert-Monitor");
    assert_eq!(conf["identifier"], "de.cxecutives.job-alert-monitor");
}

/// Tauri's NSIS template as the CLI in `node_modules` embeds it (any platform's binary), or
/// `None` before `npm ci`.
fn nsis_template() -> Option<String> {
    let dir = repo("node_modules/@tauri-apps");
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        if !entry.file_name().to_string_lossy().starts_with("cli-") {
            continue;
        }
        for file in std::fs::read_dir(entry.path()).ok()?.flatten() {
            if file.path().extension().is_some_and(|e| e == "node") {
                let bytes = std::fs::read(file.path()).ok()?;
                let text = String::from_utf8_lossy(&bytes);
                let start = text.find("Unicode true")?;
                let end = start + text[start..].find("Function CreateOrUpdateDesktopShortcut")?;
                return Some(text[start..end].replace("\r\n", "\n"));
            }
        }
    }
    None
}

/// What the hook relies on in Tauri's template: the Apps entry is named by the product and
/// holds `UninstallString` (no `QuietUninstallString`), and its uninstaller deletes the data
/// folder only after the box on its confirm page was ticked (so never when silent).
#[test]
fn ds_1_tauris_template_still_works_as_the_hook_assumes() {
    let Some(template) = nsis_template() else {
        eprintln!("no Tauri CLI in node_modules (npm ci): the template is not checked");
        return;
    };
    for line in [
        r#"!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}""#,
        r#"WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}""#,
        r#"WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\"""#,
        "!insertmacro NSIS_HOOK_PREINSTALL",
        r#"RmDir /r "$LOCALAPPDATA\${BUNDLEID}""#,
    ] {
        assert!(template.contains(line), "the template changed: {line}");
    }
    assert!(!template.contains("QuietUninstallString"));
    // The data goes only when the box was ticked, and the box is read only when its page is
    // left, which a silent uninstall never shows.
    let state: Vec<&str> = template
        .lines()
        .map(str::trim)
        .filter(|line| line.contains("$DeleteAppDataCheckboxState"))
        .collect();
    assert_eq!(
        state,
        [
            "SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState",
            "${If} $DeleteAppDataCheckboxState = 1",
        ],
        "the template decides about the app data differently now"
    );
    let leave = &template[template.find("Function un.ConfirmLeave").unwrap()..];
    assert!(
        leave[..leave.find("FunctionEnd").unwrap()].contains("$DeleteAppDataCheckboxState"),
        "the box is read when the confirm page is left"
    );
    let delete = template
        .find("${If} $DeleteAppDataCheckboxState = 1")
        .unwrap();
    assert!(
        template[delete..]
            .find(r#"RmDir /r "$LOCALAPPDATA\${BUNDLEID}""#)
            .unwrap()
            < 800
    );
}
