//! Safety invariants of saving the mailbox in `src-tauri`, as far as they can be checked
//! without a window (the app's own test executables do not run on Windows, see
//! `src-tauri/Cargo.toml`); the rules themselves are tested in `core/src/mail/check.rs`.
//!
//! CRED-1: "Verbinden" signs in and counts for up to two minutes. While it does, the app is
//! held (`Activity::Mailbox`), so no fetch starts with the account being replaced and writes
//! its scan state after the switch cleared it; "Abbrechen" and closing the window stop the
//! check (`cancel_run`); a run that read the vault while a save ended reads it again.

use std::path::Path;

fn read(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{relative}: {e}"))
        .replace("\r\n", "\n")
}

/// The first function `name` in `source`, up to its closing brace (indented like the `fn`
/// line, as rustfmt writes it).
fn body<'a>(source: &'a str, name: &str) -> &'a str {
    let at = source
        .find(&format!("fn {name}("))
        .unwrap_or_else(|| panic!("fn {name} missing"));
    let line = source[..at].rfind('\n').map_or(0, |n| n + 1);
    let indent = source[line..].chars().take_while(|c| *c == ' ').count();
    let rest = &source[line..];
    let end = rest
        .find(&format!("\n{}}}\n", " ".repeat(indent)))
        .unwrap_or_else(|| panic!("end of fn {name}"));
    &rest[..end]
}

/// `first` comes before `then` in `text`.
fn before(text: &str, first: &str, then: &str) -> bool {
    match (text.find(first), text.find(then)) {
        (Some(a), Some(b)) => a < b,
        _ => false,
    }
}

#[test]
fn cred_1_saving_the_mailbox_holds_the_app_and_can_be_stopped() {
    let mailbox = read("src-tauri/src/commands/mailbox.rs");
    let save = body(&mailbox, "save_mailbox");
    assert!(
        before(save, "state.claim_mailbox(&app)?", "check_mailbox("),
        "save_mailbox must hold the app before it signs in"
    );
    assert!(
        save.contains("guard.cancel.clone()"),
        "the check must stop with the held slot's token (cancel_run)"
    );
    assert!(
        before(save, "store_account(", "drop(guard)"),
        "the app stays held until the account is stored"
    );
    let remove = body(&mailbox, "remove_mailbox");
    assert!(
        before(remove, "state.claim_mailbox(&app)?", "delete_gmail()"),
        "removing the mailbox holds the app too"
    );
    for (name, text) in [("save_mailbox", save), ("remove_mailbox", remove)] {
        assert!(
            !text.contains("CancellationToken::new()") && !text.contains("ensure_idle"),
            "{name}: a check that only looks at the slot, or a token nobody can cancel"
        );
    }

    let commands = read("src-tauri/src/commands/mod.rs");
    assert!(commands.contains("Mailbox(CancellationToken),"));
    assert!(
        body(&commands, "activity_name")
            .contains("Activity::Mailbox(_) => Some(\"mailbox\".into())"),
        "the busy error and the closing note name the check"
    );
    let cancel = body(&commands, "cancel_run");
    assert!(
        cancel.contains("Activity::Mailbox(cancel)") && cancel.contains("cancel.cancel()"),
        "cancel_run stops the mailbox check"
    );
    let claim = body(&commands, "claim_mailbox");
    assert!(
        before(
            claim,
            "lock(&self.activity)",
            "Activity::Mailbox(cancel.clone())"
        ) && claim.contains("if !matches!(*activity, Activity::Idle)"),
        "checked and claimed under one lock"
    );
    let release = &commands[commands
        .find("impl Drop for MailboxGuard")
        .expect("MailboxGuard frees the slot")..];
    let release = &release[..release.find("\n}\n").unwrap()];
    assert!(
        before(
            release,
            "lock(&self.state.activity)",
            "mailbox_epoch.fetch_add"
        ) && before(
            release,
            "mailbox_epoch.fetch_add",
            "*activity = Activity::Idle"
        ),
        "the epoch moves under the lock, before the slot is free"
    );
    assert!(
        release.contains("scoring::after_run(&self.app)"),
        "a rescore held up by the check starts afterwards"
    );

    // A run reads the vault outside the lock: when a save or removal ended meanwhile, what
    // it read may be the old account, and it reads again.
    let run = read("src-tauri/src/commands/run.rs");
    let launch = body(&run, "launch");
    assert!(
        before(
            launch,
            "let epoch = state.mailbox_epoch();",
            "run_context(state, &request)"
        ),
        "the epoch is taken before the vault is read"
    );
    assert!(
        before(
            launch,
            "lock(&state.activity)",
            "if state.mailbox_epoch() == epoch"
        ),
        "the epoch is compared under the activity lock"
    );

    // The page words the busy error and the closing note of the check.
    for catalog in ["ui/src/lib/i18n/de.ts", "ui/src/lib/i18n/en.ts"] {
        let text = read(catalog);
        let busy = &text[text.find("type Busy").unwrap()..];
        let busy = &busy[..busy.find("const errors").unwrap()];
        assert!(
            busy.contains("'mailbox'"),
            "{catalog}: Busy knows the check"
        );
        assert_eq!(
            busy.matches("\n  mailbox: ").count(),
            2,
            "{catalog}: a busy sentence and a closing note for the check"
        );
    }
}

/// CRED-2 follow-up: `save_mailbox` looks at the shape of address and app password before
/// it does anything else, so a typo is named at once, also while a fetch holds the app (the
/// stub answers the same way), and nothing is sent or held for a password that cannot be
/// right. `check_mailbox` checks it again (core's tests).
#[test]
fn cred_2_the_shape_is_checked_before_the_app_is_held() {
    let mailbox = read("src-tauri/src/commands/mailbox.rs");
    let save = body(&mailbox, "save_mailbox");
    assert!(
        before(save, "credentials.validate()", "state.claim_mailbox(&app)?"),
        "the shape comes before the busy check"
    );
    assert!(before(save, "credentials.validate()", "check_mailbox("));
    let stub = read("tools/ui-harness/stub.ts");
    let stub = &stub[stub
        .find("  save_mailbox: ")
        .expect("the stub's save_mailbox")..];
    assert!(
        before(stub, "reason: 'appPassword'", "throw fail('busy')"),
        "the stub answers like the command"
    );
}
