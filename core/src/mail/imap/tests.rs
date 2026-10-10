use std::fmt::Write as _;

use super::*;
use crate::mail::head_part;

const GMAIL: MailProvider = MailProvider::Gmail;
const GMX: MailProvider = MailProvider::Gmx;

#[test]
fn gmail_query_for_selected_portals() {
    let since = Date::new(2026, 3, 5).unwrap();
    assert_eq!(
        gmail_query(
            Some(since),
            &[Portal::LinkedIn, Portal::Freelancermap],
            false
        ),
        r#"SINCE 05-Mar-2026 X-GM-RAW "from:(linkedin.com OR freelancermap.de OR freelancermap.com) OR linkedin OR freelancermap""#
    );
    assert_eq!(
        gmail_query(None, &[Portal::FreelanceDe], false),
        r#"X-GM-RAW "from:(freelance.de) OR freelance.de""#
    );
    // All Mail: without drafts and the user's own sent mails.
    assert_eq!(
        gmail_query(None, &[Portal::FreelanceDe], true),
        r#"X-GM-RAW "(from:(freelance.de) OR freelance.de) -in:drafts (in:inbox OR -in:sent)""#
    );
}

/// The standard search asks for the same senders as Gmail's, each once, nested in IMAP's
/// two-key `OR`, after the day.
#[test]
fn standard_query_chains_the_senders() {
    let since = Date::new(2026, 3, 5).unwrap();
    assert_eq!(
        standard_query(
            Some(since),
            &[Portal::LinkedIn, Portal::Freelancermap, Portal::LinkedIn]
        ),
        r#"SINCE 05-Mar-2026 OR FROM "linkedin.com" OR FROM "freelancermap.de" FROM "freelancermap.com""#
    );
    assert_eq!(
        standard_query(None, &[Portal::FreelanceDe]),
        r#"FROM "freelance.de""#
    );
    assert_eq!(
        standard_query(None, &[Portal::LinkedIn, Portal::FreelanceDe]),
        r#"OR FROM "linkedin.com" FROM "freelance.de""#
    );
}

/// Gmail reads All Mail alone (else the inbox); the others read the inbox, then every folder
/// marked as the archive or all mail, by its attribute whatever its name, each once. Sent
/// mails, drafts, trash and folders that cannot be opened stay out.
#[test]
fn the_folders_come_from_their_attributes() {
    use NameAttribute as A;
    let listed =
        |rows: &[(&str, &[NameAttribute<'static>])]| -> Vec<(String, Vec<NameAttribute<'static>>)> {
            rows.iter()
                .map(|(name, attributes)| ((*name).to_owned(), attributes.to_vec()))
                .collect()
        };
    let gmail = listed(&[
        ("INBOX", &[]),
        ("[Gmail]", &[A::NoSelect]),
        ("[Gmail]/Alle Nachrichten", &[A::All]),
        ("[Gmail]/Gesendet", &[A::Sent]),
    ]);
    assert_eq!(folders(GMAIL, &gmail), ["[Gmail]/Alle Nachrichten"]);
    assert_eq!(folders(GMAIL, &listed(&[("INBOX", &[])])), ["INBOX"]);

    let other = listed(&[
        ("INBOX", &[]),
        ("Archiv", &[A::Archive]),
        ("Gesendet", &[A::Sent]),
        ("Entw&APw-rfe", &[A::Drafts]),
        ("Papierkorb", &[A::Trash]),
        ("Alle", &[A::All, A::Archive]),
        ("Kaputt", &[A::Archive, A::NoSelect]),
        ("Archiv", &[A::Archive]),
        ("inbox", &[A::All]),
    ]);
    assert_eq!(folders(GMX, &other), ["INBOX", "Archiv", "Alle"]);
    // Without an archive the inbox alone.
    assert_eq!(
        folders(GMX, &listed(&[("INBOX", &[]), ("Gesendet", &[A::Sent])])),
        ["INBOX"]
    );
    assert_eq!(folders(MailProvider::Icloud, &[]), ["INBOX"]);
}

/// All Mail is found by its special-use attribute, whatever its localized name; the search
/// then leaves drafts and sent mails out. Without it the inbox is read.
#[tokio::test]
async fn all_mail_by_its_attribute_else_the_inbox() {
    let list = "* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n\
                * LIST (\\HasChildren \\Noselect) \"/\" \"[Gmail]\"\r\n\
                * LIST (\\All \\HasNoChildren) \"/\" \"[Gmail]/Alle Nachrichten\"\r\n\
                * LIST (\\HasNoChildren \\Sent) \"/\" \"[Gmail]/Gesendet\"\r\n\
                {tag} OK Success\r\n";
    let (mut gmail, sent) = scripted_logging(
        GMAIL,
        vec![
            list.into(),
            EXAMINED.into(),
            "* SEARCH 7\r\n{tag} OK SEARCH completed\r\n".into(),
        ],
    )
    .await;
    gmail.open_folders().await.unwrap();
    assert!(gmail.all_mail);
    gmail.search(None, &[Portal::LinkedIn]).await.unwrap();
    let commands = sent.lock().unwrap().join("\n");
    assert!(
        commands.contains(r#"EXAMINE "[Gmail]/Alle Nachrichten""#),
        "{commands}"
    );
    assert!(commands.contains("(in:inbox OR -in:sent)"), "{commands}");

    let list = "* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n{tag} OK Success\r\n";
    let (mut gmail, sent) = scripted_logging(GMAIL, vec![list.into(), EXAMINED.into()]).await;
    gmail.open_folders().await.unwrap();
    assert!(!gmail.all_mail);
    let commands = sent.lock().unwrap().join("\n");
    assert!(commands.contains(r#"EXAMINE "INBOX""#), "{commands}");
}

/// The reply to `EXAMINE`.
const EXAMINED: &str =
    "* FLAGS (\\Seen)\r\n* 3 EXISTS\r\n{tag} OK [READ-ONLY] EXAMINE completed\r\n";

/// A fetch reply of head fields: `(uid, head)` each.
fn heads_reply(fields: &str, heads: &[(u32, &str)]) -> String {
    let mut reply = String::new();
    for (n, (uid, head)) in heads.iter().enumerate() {
        let _ = write!(
            reply,
            "* {} FETCH (UID {uid} BODY[HEADER.FIELDS ({fields})] {{{}}}\r\n{head})\r\n",
            n + 1,
            head.len()
        );
    }
    reply.push_str("{tag} OK Success\r\n");
    reply
}

/// A fetch reply of whole mails without a Gmail id: `(uid, mail)` each.
fn bodies_reply(mails: &[(u32, &str)]) -> String {
    let mut reply = String::new();
    for (n, (uid, mail)) in mails.iter().enumerate() {
        let _ = write!(
            reply,
            "* {} FETCH (UID {uid} BODY[]<0> {{{}}}\r\n{mail})\r\n",
            n + 1,
            mail.len()
        );
    }
    reply.push_str("{tag} OK Success\r\n");
    reply
}

/// An alert of LinkedIn with one job, by its Message-ID.
fn linkedin_alert(message_id: &str, job: u64) -> String {
    format!(
        "From: LinkedIn <jobalerts-noreply@linkedin.com>\r\nSubject: Neue Jobs\r\n\
         Date: Thu, 03 Sep 2026 08:15:00 +0200\r\nMessage-ID: <{message_id}>\r\n\
         Content-Type: text/html\r\n\r\n\
         <a href=\"https://www.linkedin.com/jobs/view/{job}/\">Rolle {job}</a>"
    )
}

/// A GMX mailbox with an archive: its `LIST`, then a scan's replies. The inbox holds 7 (an
/// alert, Message-ID `eins`) and 8 (no alert, no Message-ID); the archive 20 (a copy of 7)
/// and 21 (another alert, `zwei`).
fn inbox_and_archive() -> Vec<String> {
    let list = "* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n\
                * LIST (\\HasNoChildren \\Archive) \"/\" \"Archiv\"\r\n\
                * LIST (\\HasNoChildren \\Sent) \"/\" \"Gesendet\"\r\n\
                {tag} OK LIST completed\r\n";
    let first = linkedin_alert("eins@linkedin.com", 4_100_000_001);
    let second = linkedin_alert("zwei@linkedin.com", 4_100_000_002);
    let head = |mail: &str| {
        head_part(mail.as_bytes())
            .iter()
            .map(|&b| char::from(b))
            .collect::<String>()
    };
    let id = |message_id: &str| format!("Message-ID: <{message_id}>\r\n\r\n");
    vec![
        list.into(),
        EXAMINED.into(),
        // The search: the inbox (open), its Message-IDs, the archive, its Message-IDs.
        "* SEARCH 7 8\r\n{tag} OK SEARCH completed\r\n".into(),
        heads_reply("MESSAGE-ID", &[(7, &id("eins@linkedin.com")), (8, "\r\n")]),
        EXAMINED.into(),
        "* SEARCH 20 21\r\n{tag} OK SEARCH completed\r\n".into(),
        heads_reply(
            "MESSAGE-ID",
            &[
                (20, &id("eins@linkedin.com")),
                (21, &id("zwei@linkedin.com")),
            ],
        ),
        // The heads, folder by folder.
        EXAMINED.into(),
        heads_reply(
            HEAD_FIELDS,
            &[(7, &head(&first)), (8, "Subject: Hallo\r\n\r\n")],
        ),
        EXAMINED.into(),
        heads_reply(HEAD_FIELDS, &[(21, &head(&second))]),
        // The candidates' bodies, folder by folder.
        EXAMINED.into(),
        bodies_reply(&[(7, &first)]),
        EXAMINED.into(),
        bodies_reply(&[(21, &second)]),
    ]
}

/// GMX: the inbox and its archive are searched with standard IMAP, from the portals' senders
/// since the day; the archive's copy of an inbox mail (same Message-ID) counts once, a mail
/// without one always. The scan then reads each mail in its folder, without Gmail's id.
#[tokio::test]
async fn a_standard_mailbox_searches_inbox_and_archive_and_counts_a_copy_once() {
    use crate::mail::scan::{ScanSummary, Scope, scan};
    let (mut gmx, sent) = scripted_logging(GMX, inbox_and_archive()).await;
    gmx.open_folders().await.unwrap();
    assert_eq!(gmx.folders, ["INBOX", "Archiv"]);
    let store = crate::store::Store::in_memory().unwrap();
    let run = store.begin_run().unwrap();
    let mut summary = ScanSummary::default();
    scan(
        &mut gmx,
        &store,
        run,
        Scope::Days(7),
        &[Portal::LinkedIn],
        "2026-09-19T08:00:00Z".parse().unwrap(),
        &CancellationToken::new(),
        &mut summary,
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(gmx.found, [(0, 7), (0, 8), (1, 21)], "the copy 20 is out");
    assert_eq!(
        (
            summary.mails_found,
            summary.mails_checked,
            summary.alert_mails,
            summary.new
        ),
        (3, 3, 2, 2)
    );
    let commands = sent.lock().unwrap().clone();
    let searches: Vec<&String> = commands
        .iter()
        .filter(|c| c.contains("UID SEARCH"))
        .collect();
    assert_eq!(searches.len(), 2, "{commands:?}");
    for search in searches {
        assert!(
            search.ends_with(r#"UID SEARCH SINCE 12-Sep-2026 FROM "linkedin.com""#),
            "{search}"
        );
    }
    let all = commands.join("\n");
    assert!(all.contains(r#"EXAMINE "Archiv""#), "{all}");
    assert!(
        !all.contains("Gesendet"),
        "sent mails are never read: {all}"
    );
    assert!(!all.contains("X-GM-"), "no Gmail extension: {all}");
    let bodies: Vec<&String> = commands
        .iter()
        .filter(|c| c.contains("BODY.PEEK[]"))
        .collect();
    assert_eq!(bodies.len(), 2, "{commands:?}");
    assert!(
        bodies[0].contains("UID FETCH 7 (UID BODY.PEEK[]"),
        "{}",
        bodies[0]
    );
    assert!(
        bodies[1].contains("UID FETCH 21 (UID BODY.PEEK[]"),
        "{}",
        bodies[1]
    );
}

/// With the inbox alone there is nothing to sort out: no Message-ID is fetched.
#[tokio::test]
async fn the_inbox_alone_needs_no_message_ids() {
    let list = "* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n{tag} OK LIST completed\r\n";
    let (mut gmx, sent) = scripted_logging(
        GMX,
        vec![
            list.into(),
            EXAMINED.into(),
            "* SEARCH 9 3 5 3\r\n{tag} OK SEARCH completed\r\n".into(),
        ],
    )
    .await;
    gmx.open_folders().await.unwrap();
    let ids = gmx.search(None, &[Portal::LinkedIn]).await.unwrap();
    assert_eq!(ids, [1, 2, 3]);
    assert_eq!(gmx.found, [(0, 3), (0, 5), (0, 9)]);
    let commands = sent.lock().unwrap().join("\n");
    assert!(!commands.contains("FETCH"), "{commands}");
    assert!(
        commands.ends_with(r#"UID SEARCH FROM "linkedin.com""#),
        "{commands}"
    );
}

/// An id the last search did not hand out reads nothing.
#[tokio::test]
async fn an_unknown_id_reads_nothing() {
    let (mut gmx, sent) = scripted_logging(GMX, vec![]).await;
    assert!(gmx.heads(&[0, 1, 99]).await.unwrap().is_empty());
    assert!(gmx.fetch(&[5]).await.unwrap().is_empty());
    assert!(!sent.lock().unwrap().iter().any(|c| c.contains("FETCH")));
}

/// Formerly: whitespace in the app password was only removed when saving, and the
/// address was case-sensitive.
#[test]
fn credentials_are_normalised_and_never_printed() {
    let c = Credentials::new(
        GMAIL,
        "  Erika.Mueller@Example.com ",
        "abcd efgh\tijkl mnop",
    );
    assert_eq!(c.user, "erika.mueller@example.com");
    assert_eq!(c.password(), "abcdefghijklmnop");
    assert!(!format!("{c:?}").contains("abcd"));
    let apple = Credentials::new(MailProvider::Icloud, "Erika@iCloud.com", "abcdefghijklmnop");
    assert_eq!(apple.password(), "abcd-efgh-ijkl-mnop");
    let gmx = Credentials::new(GMX, "erika@gmx.de", "Geheim 1!");
    assert_eq!(gmx.password(), "Geheim 1!");
    assert!(!format!("{gmx:?}").contains("Geheim"));
}

/// No network is `Offline` ("Keine Verbindung zum Internet"): a name that does not
/// resolve (std's text on Unix, Windows' codes) or a network that is down or unreachable.
/// Everything else stays `Connect` (the server is not reachable).
#[test]
fn no_network_is_offline_anything_else_a_connect_error() {
    use std::io::{Error, ErrorKind as Kind};
    let offline = [
        Error::other(
            "failed to lookup address information: nodename nor servname provided, or not known",
        ),
        Error::other("failed to lookup address information: Temporary failure in name resolution"),
        Error::new(Kind::NetworkUnreachable, "network is unreachable"),
        Error::new(Kind::NetworkDown, "network is down"),
        Error::new(Kind::HostUnreachable, "no route to host"),
    ];
    for error in &offline {
        let mail = connect_error(error);
        assert!(matches!(mail, MailError::Offline(_)), "{error}: {mail}");
        assert_eq!(mail.kind(), ErrorKind::Offline);
    }
    for error in [
        Error::new(Kind::ConnectionRefused, "connection refused"),
        Error::new(Kind::ConnectionReset, "connection reset"),
        Error::new(Kind::TimedOut, "timed out"),
        Error::new(Kind::PermissionDenied, "blocked by a firewall"),
        Error::other("the lookup of the address failed"),
    ] {
        let mail = connect_error(&error);
        assert!(matches!(mail, MailError::Connect(_)), "{error}: {mail}");
        assert_eq!(mail.kind(), ErrorKind::MailConnect);
    }
    // Windows says it by a code: no host of that name, try again, no data.
    #[cfg(windows)]
    for code in [11001, 11002, 11004] {
        let mail = connect_error(&Error::from_raw_os_error(code));
        assert!(matches!(mail, MailError::Offline(_)), "{code}: {mail}");
    }
    #[cfg(windows)]
    assert!(matches!(
        connect_error(&Error::from_raw_os_error(10061)),
        MailError::Connect(_)
    ));
    // The page reads the code, never a text.
    assert_eq!(
        serde_json::to_value(crate::error::ErrorInfo::from(&connect_error(&offline[0]))).unwrap(),
        serde_json::json!({"kind": "offline", "params": {}})
    );
}

/// A dropped connection at login is not a wrong password.
#[test]
fn only_a_rejection_is_an_auth_error() {
    use async_imap::error::Error as E;
    assert!(matches!(
        login_error(
            E::No("[AUTHENTICATIONFAILED] Invalid credentials".into()),
            GMAIL
        ),
        MailError::Auth { .. }
    ));
    let eof = std::io::Error::from(std::io::ErrorKind::UnexpectedEof);
    assert!(matches!(login_error(E::Io(eof), GMAIL), MailError::Lost(_)));
    assert!(matches!(
        login_error(E::ConnectionLost, GMAIL),
        MailError::Lost(_)
    ));
}

/// A refused sign-in is `mailAuth`; at GMX and WEB.DE, where IMAP must be allowed in the web
/// mailer first, it says so (`allowImap`), at Gmail and iCloud not.
#[test]
fn a_refusal_at_gmx_and_webde_names_the_imap_switch() {
    use async_imap::error::Error as E;
    let refused = |provider| {
        crate::error::ErrorInfo::from(&login_error(
            E::No("[AUTHENTICATIONFAILED] Authentication failed".into()),
            provider,
        ))
    };
    for provider in [MailProvider::Gmx, MailProvider::Webde] {
        assert_eq!(
            serde_json::to_value(refused(provider)).unwrap(),
            serde_json::json!({"kind": "mailAuth", "params": {"allowImap": true}}),
            "{provider:?}"
        );
    }
    for provider in [MailProvider::Gmail, MailProvider::Icloud] {
        assert_eq!(
            serde_json::to_value(refused(provider)).unwrap(),
            serde_json::json!({"kind": "mailAuth", "params": {}}),
            "{provider:?}"
        );
    }
}

/// An iCloud address of Apple's domains signs in with its name part first and, refused,
/// with the whole address on the same connection; a refusal of both is `mailAuth`. Other
/// providers try the address once.
#[tokio::test]
async fn icloud_signs_in_with_the_name_part_then_the_address() {
    let cancel = CancellationToken::new();
    let apple = Credentials::new(MailProvider::Icloud, "erika@icloud.com", "abcdefghijklmnop");
    let (stream, sent) = fake_server(vec![
        "{tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n".into(),
        "{tag} OK LOGIN completed\r\n".into(),
    ]);
    let mut client = async_imap::Client::new(stream);
    client.read_response().await.unwrap().unwrap();
    login(client, &apple, &cancel).await.unwrap();
    let logins: Vec<String> = sent
        .lock()
        .unwrap()
        .iter()
        .map(|line| line.split(' ').nth(2).unwrap_or_default().to_owned())
        .collect();
    assert_eq!(logins, ["\"erika\"", "\"erika@icloud.com\""]);

    let (stream, sent) = fake_server(vec![
        "{tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n".into(),
        "{tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n".into(),
    ]);
    let mut client = async_imap::Client::new(stream);
    client.read_response().await.unwrap().unwrap();
    let refused = login(client, &apple, &cancel).await.err().unwrap();
    assert!(
        matches!(
            refused,
            MailError::Auth {
                allow_imap: false,
                ..
            }
        ),
        "{refused}"
    );
    assert_eq!(sent.lock().unwrap().len(), 2);

    let gmx = Credentials::new(GMX, "erika@gmx.de", "Geheim");
    let (stream, sent) = fake_server(vec![
        "{tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n".into(),
    ]);
    let mut client = async_imap::Client::new(stream);
    client.read_response().await.unwrap().unwrap();
    let refused = login(client, &gmx, &cancel).await.err().unwrap();
    assert!(
        matches!(
            refused,
            MailError::Auth {
                allow_imap: true,
                ..
            }
        ),
        "{refused}"
    );
    assert_eq!(sent.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cancel_and_timeout_are_errors() {
    let cancel = CancellationToken::new();
    cancel.cancel();
    let never = std::future::pending::<Result<(), ()>>();
    let result = guarded(&cancel, never, |()| MailError::Lost(String::new())).await;
    assert!(matches!(result, Err(MailError::Cancelled)));
}

/// A mail server at protocol level: greets, then answers every line the client sends with the
/// next prepared reply (`{tag}` is replaced). Also returns every line the client sent.
fn fake_server(
    replies: Vec<String>,
) -> (tokio::io::DuplexStream, Arc<std::sync::Mutex<Vec<String>>>) {
    use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
    let (client_side, server_side) = tokio::io::duplex(1 << 20);
    let sent: Arc<std::sync::Mutex<Vec<String>>> = Arc::default();
    let log = sent.clone();
    tokio::spawn(async move {
        let (read, mut write) = tokio::io::split(server_side);
        let mut read = BufReader::new(read);
        write.write_all(b"* OK IMAP ready\r\n").await.unwrap();
        for reply in replies {
            let mut line = String::new();
            if read.read_line(&mut line).await.unwrap_or(0) == 0 {
                return;
            }
            let tag = line.split(' ').next().unwrap_or_default().to_string();
            if let Ok(mut log) = log.lock() {
                log.push(line.trim_end().to_string());
            }
            write
                .write_all(reply.replace("{tag}", &tag).as_bytes())
                .await
                .unwrap();
        }
    });
    (client_side, sent)
}

/// Mailbox fake of `provider`, signed in, the inbox open: answers every command with the next
/// prepared reply.
async fn scripted(replies: Vec<String>) -> Imap<tokio::io::DuplexStream> {
    scripted_logging(GMAIL, replies).await.0
}

/// Like [`scripted`], for `provider`, and also returns every command the client sent after
/// the login.
async fn scripted_logging(
    provider: MailProvider,
    replies: Vec<String>,
) -> (
    Imap<tokio::io::DuplexStream>,
    Arc<std::sync::Mutex<Vec<String>>>,
) {
    let replies = std::iter::once("{tag} OK LOGIN done\r\n".to_string())
        .chain(replies)
        .collect();
    let (stream, sent) = fake_server(replies);
    let mut client = async_imap::Client::new(stream);
    client.read_response().await.unwrap().unwrap();
    let session = client
        .login("ich@example.org", "pw")
        .await
        .map_err(|(e, _)| e)
        .unwrap();
    sent.lock().unwrap().clear();
    let mut imap = Imap::new(session, CancellationToken::new(), provider);
    imap.open = Some(0);
    (imap, sent)
}

/// Safety invariant: the mailbox is only ever read. Folders are opened with `EXAMINE`
/// (never `SELECT`), mails are fetched with `BODY.PEEK` - so the server marks nothing as
/// read, and no command ever changes anything.
#[tokio::test]
async fn the_mailbox_is_only_ever_read() {
    let body = "Subject: Neue Jobs\r\n\r\nText";
    let reply = format!(
        "* 1 FETCH (UID 7 X-GM-MSGID 1234 BODY[]<0> {{{len}}}\r\n{body})\r\n{{tag}} OK Success\r\n",
        len = body.len()
    );
    let (mut gmail, sent) = scripted_logging(
        GMAIL,
        vec!["* SEARCH 7\r\n{tag} OK SEARCH completed\r\n".into(), reply],
    )
    .await;
    let ids = gmail.search(None, &[Portal::LinkedIn]).await.unwrap();
    gmail.fetch(&ids).await.unwrap();
    let (mut gmx, sent_gmx) = scripted_logging(
        GMX,
        vec![
            "* SEARCH 7\r\n{tag} OK SEARCH completed\r\n".into(),
            bodies_reply(&[(7, body)]),
        ],
    )
    .await;
    let ids = gmx.search(None, &[Portal::LinkedIn]).await.unwrap();
    assert_eq!(gmx.fetch(&ids).await.unwrap().len(), 1);
    for sent in [sent, sent_gmx] {
        let commands = sent.lock().unwrap().join("\n").to_uppercase();
        assert!(commands.contains("BODY.PEEK["), "{commands}");
        for forbidden in [
            "SELECT", "STORE", "EXPUNGE", "DELETE", "APPEND", "COPY", "MOVE", "\\SEEN",
        ] {
            assert!(!commands.contains(forbidden), "{forbidden}: {commands}");
        }
    }
    // A folder is opened in one place - that code says `examine`, never `select`. The
    // search text is assembled here, otherwise the test would find itself.
    let source = include_str!("../imap.rs");
    assert!(source.contains(&format!("session{}", ".examine(&name)")));
    assert!(!source.contains(&format!("session{}", ".select(")));
}

/// Two phases over IMAP: the heads of all matches, then the whole mail only for the
/// candidates - a newsletter the keyword search found is never loaded whole.
#[tokio::test]
async fn only_candidate_bodies_are_fetched() {
    use crate::mail::scan::{ScanSummary, Scope, scan};
    let alert = "From: LinkedIn <jobalerts-noreply@linkedin.com>\r\nSubject: Neue Jobs\r\n\r\n";
    let news = "From: News <news@example.org>\r\nSubject: Unlocked: your notetaker\r\n\r\n";
    let heads = heads_reply(HEAD_FIELDS, &[(7, alert), (8, news)]);
    let body =
        format!("{alert}<a href=\"https://www.linkedin.com/jobs/view/4123456789/\">Rolle</a>");
    let bodies = format!(
        "* 1 FETCH (UID 7 X-GM-MSGID 1234 BODY[]<0> {{{}}}\r\n{body})\r\n{{tag}} OK Success\r\n",
        body.len()
    );
    let (mut gmail, sent) = scripted_logging(
        GMAIL,
        vec![
            "* SEARCH 7 8\r\n{tag} OK SEARCH completed\r\n".into(),
            heads,
            bodies,
        ],
    )
    .await;
    let store = crate::store::Store::in_memory().unwrap();
    let run = store.begin_run().unwrap();
    let mut summary = ScanSummary::default();
    scan(
        &mut gmail,
        &store,
        run,
        Scope::All,
        &[Portal::LinkedIn],
        "2026-09-19T08:00:00Z".parse().unwrap(),
        &CancellationToken::new(),
        &mut summary,
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(
        (summary.mails_checked, summary.alert_mails, summary.new),
        (2, 1, 1)
    );
    let commands = sent.lock().unwrap().clone();
    let fetches: Vec<&String> = commands
        .iter()
        .filter(|c| c.contains("UID FETCH"))
        .collect();
    assert_eq!(fetches.len(), 2, "{commands:?}");
    assert!(fetches[0].contains("UID FETCH 7,8 (UID BODY.PEEK[HEADER.FIELDS"));
    assert!(
        fetches[1].contains("UID FETCH 7 (UID X-GM-MSGID"),
        "only the candidate"
    );
    assert!(fetches[1].contains("BODY.PEEK[]"));
}

/// A failed search is an error, not "0 mails" - otherwise the scan state would
/// advance and the mails would be missing forever.
#[tokio::test]
async fn failed_search_is_an_error() {
    let mut gmail = scripted(vec![
        "{tag} NO [UNAVAILABLE] Temporary System Problem (Failure)\r\n".into(),
    ])
    .await;
    let result = gmail.search(None, &[Portal::LinkedIn]).await;
    assert!(matches!(result, Err(MailError::Server(_))), "{result:?}");

    let mut gmail = scripted(vec![
        "* SEARCH 9 3 5 3\r\n{tag} OK SEARCH completed\r\n".into(),
    ])
    .await;
    assert_eq!(
        gmail.search(None, &[Portal::LinkedIn]).await.unwrap(),
        [1, 2, 3]
    );
    assert_eq!(gmail.found, [(0, 3), (0, 5), (0, 9)]);
}

/// Status updates without content are not a mail; a rejected fetch is an error.
#[tokio::test]
async fn fetch_takes_only_requested_mails_with_content() {
    let body = "Subject: Neue Jobs\r\n\r\nText";
    let reply = format!(
        "* 1 FETCH (UID 7 FLAGS (\\Seen))\r\n\
         * 2 FETCH (UID 99 X-GM-MSGID 5 BODY[]<0> {{{len}}}\r\n{body})\r\n\
         * 1 FETCH (UID 7 X-GM-MSGID 1234 BODY[]<0> {{{len}}}\r\n{body})\r\n\
         {{tag}} OK Success\r\n",
        len = body.len()
    );
    let mut gmail = scripted(vec![
        "* SEARCH 7\r\n{tag} OK SEARCH completed\r\n".into(),
        reply,
    ])
    .await;
    let ids = gmail.search(None, &[Portal::LinkedIn]).await.unwrap();
    let mails = gmail.fetch(&ids).await.unwrap();
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].gmail_id, Some(1234));
    assert_eq!(mails[0].bytes, body.as_bytes());

    let mut gmail = scripted(vec![
        "* SEARCH 7\r\n{tag} OK SEARCH completed\r\n".into(),
        "{tag} NO Some messages could not be FETCHed (Failure)\r\n".into(),
    ])
    .await;
    let ids = gmail.search(None, &[Portal::LinkedIn]).await.unwrap();
    assert!(matches!(gmail.fetch(&ids).await, Err(MailError::Server(_))));
}

/// An unreadable reply brings no mail content into the message.
#[tokio::test]
async fn unreadable_answer_leaks_no_content() {
    let mut gmail = scripted(vec![
        "* SEARCH 1\r\n{tag} OK SEARCH completed\r\n".into(),
        "* 1 FETCH (UID 1 BODY[] {33}\r\nSubject: Gehalt\r\n\r\nVERTRAULICH X-UNBEKANNT 5)\r\n"
            .into(),
    ])
    .await;
    let ids = gmail.search(None, &[Portal::LinkedIn]).await.unwrap();
    let error = gmail.fetch(&ids).await.unwrap_err();
    let text = error.to_string();
    assert!(
        !text.contains("VERTRAULICH") && text.chars().count() < 300,
        "{text}"
    );
}

/// A temporary rejection is not a wrong password.
#[test]
fn temporary_login_rejection_is_no_auth_error() {
    use async_imap::error::Error as E;
    for text in [
        "[UNAVAILABLE] Temporary System Problem (Failure)",
        "[ALERT] Too many simultaneous connections. (Failure)",
        "[OVERQUOTA] Account exceeded command or bandwidth limits.",
    ] {
        assert!(
            matches!(login_error(E::No(text.into()), GMX), MailError::Server(_)),
            "{text}"
        );
    }
    assert!(matches!(
        login_error(
            E::No("[ALERT] Application-specific password required".into()),
            GMAIL
        ),
        MailError::Auth { .. }
    ));
    let stalled = std::io::Error::from(std::io::ErrorKind::TimedOut);
    assert!(matches!(io_error(&stalled), MailError::Timeout));
}
