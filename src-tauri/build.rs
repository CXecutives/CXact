use std::fmt::Write as _;

/// The command table: one command per line (`name  { arguments }  -> result`), `#` comments.
const COMMANDS: &str = "commands.txt";
/// The capability of the main window, written from the table.
const CAPABILITY: &str = "capabilities/main.json";

fn main() {
    // Without these lines Cargo would not notice a new icon.ico or interface: the build
    // script would not run again and the finished exe would keep the old icon.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=capabilities");
    println!("cargo:rerun-if-changed={COMMANDS}");
    println!("cargo:rerun-if-changed=../ui");

    let names = command_names();
    write_capability(&names);

    // With an AppManifest the app's own commands are under the ACL too: only windows whose
    // capability names `allow-<command>` may call them. The names come from commands.txt
    // (`core/tests/contract.rs` checks them against `generate_handler!`).
    let names: Vec<&'static str> = names
        .into_iter()
        .map(|name| &*Box::leak(name.into_boxed_str()))
        .collect();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(names.leak())),
    )
    .expect("tauri-build failed");
}

/// The names of the table, in its order.
fn command_names() -> Vec<String> {
    let table = std::fs::read_to_string(COMMANDS).expect("src-tauri/commands.txt");
    table
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let name = line.split_whitespace().next().unwrap_or_default();
            assert!(
                !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "commands.txt: bad name in {line:?}"
            );
            assert!(line.contains(" -> "), "commands.txt: no result in {line:?}");
            name.to_owned()
        })
        .collect()
}

/// `capabilities/main.json`: the main window may call every command of the table and listen
/// to events - nothing else, no remote entry, no portal window. Written only when it changes
/// (a rewrite would run this script again).
fn write_capability(names: &[String]) {
    let mut permissions = String::new();
    for name in names {
        let _ = writeln!(permissions, "    \"allow-{}\",", name.replace('_', "-"));
    }
    let json = format!(
        "{{\n  \"$schema\": \"../gen/schemas/desktop-schema.json\",\n  \"identifier\": \"main\",\n  \
         \"description\": \"Rights of the app's own interface - the main window only. Written by \
         build.rs from commands.txt. Portal windows are deliberately in no capability; there is \
         never a remote entry.\",\n  \"windows\": [\n    \"main\"\n  ],\n  \"permissions\": [\n\
         {permissions}    \"core:event:allow-listen\",\n    \"core:event:allow-unlisten\",\n    \
         \"core:resources:allow-close\"\n  ]\n}}\n"
    );
    if std::fs::read_to_string(CAPABILITY).ok().as_deref() != Some(json.as_str()) {
        std::fs::write(CAPABILITY, json).expect("capabilities/main.json");
    }
}
