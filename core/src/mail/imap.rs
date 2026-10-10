//! The mailbox over IMAP, read-only (`EXAMINE`, `BODY.PEEK`), so the server marks nothing as
//! read. Two ways to search, by the provider ([`MailProvider`]):
//!
//! - **Gmail** reads "All Mail" (the special-use `\All` mailbox, found by its attribute
//!   because its name is localized: "[Gmail]/Alle Nachrichten"): archiving a read alert and a
//!   filter that skips the inbox for the portals' alerts are common, and the inbox alone would
//!   never find those alerts. Trash and spam are not in All Mail; drafts and the user's own
//!   sent mails are left out by the search (`-in:drafts (in:inbox OR -in:sent)`), so an alert
//!   the user forwarded to someone else never counts. Without an `\All` mailbox the inbox is
//!   read. The search is Gmail's own (`X-GM-RAW`).
//! - **iCloud, GMX and WEB.DE** are read with standard IMAP: `UID SEARCH SINCE <day>` with
//!   `FROM` over the portals' sender domains (`OR`-chained), in the inbox and in every folder
//!   the server marks as the archive or all mail (special-use `\Archive`, `\All` in its `LIST`).
//!   A mail found in two of them counts once (by its Message-ID).
//!
//! The ids a search hands out are positions in its result (`(folder, UID)` behind them), so
//! the scan never needs to know the folders.

use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use async_imap::imap_proto::{AttributeValue, MailboxDatum, NameAttribute, Response, Status};

use jiff::civil::Date;
use rustls_platform_verifier::ConfigVerifierExt as _;
use tokio::net::TcpStream;
use tokio_io_timeout::TimeoutStream;
use tokio_rustls::client::TlsStream;
use tokio_util::sync::CancellationToken;

use super::provider::{IMAP_PORT, MailProvider};
use super::{RawHead, RawMail};
use crate::error::ErrorKind;
use crate::portal::Portal;
use crate::text::{one_line, truncate_chars};

/// If nothing at all arrives from the server for this long, the connection counts as hung.
const IDLE: Duration = Duration::from_secs(30);
/// Upper bound for a single step, even while data only trickles in.
const STEP_LIMIT: Duration = Duration::from_secs(10 * 60);
/// Never fetch more than this of one mail (alerts are small, large attachments are not needed).
const MAX_MAIL_BYTES: u32 = 4 * 1024 * 1024;
/// Mails per fetch.
pub const BATCH: usize = 25;
/// Message-IDs per fetch when copies are sorted out (a few dozen bytes each).
const ID_BATCH: usize = 200;
/// The inbox: every IMAP server has it under this name.
const INBOX: &str = "INBOX";

#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("no mailbox credentials stored")]
    NoCredentials,

    #[error("cannot connect to the mail server: {0}")]
    Connect(String),

    /// The computer has no connection to the internet: the name of the server did not
    /// resolve, or the network is down or unreachable ([`connect_error`]).
    #[error("no connection to the internet: {0}")]
    Offline(String),

    /// The server refused the address or the password. `allow_imap`: the provider reads
    /// IMAP only once the user allowed it in the web mailer
    /// ([`MailProvider::imap_must_be_allowed`]), which a refusal may mean as well.
    #[error("the mail server rejected the login: {text}")]
    Auth { text: String, allow_imap: bool },

    #[error("the mail server did not answer within 30 seconds")]
    Timeout,

    #[error("connection to the mail server lost: {0}")]
    Lost(String),

    #[error("server is not Gmail (no X-GM-EXT-1 capability)")]
    NotGmail,

    #[error("the mail server reported an error: {0}")]
    Server(String),

    #[error("cancelled")]
    Cancelled,
}

impl MailError {
    /// Stable error code for the interface.
    pub fn kind(&self) -> ErrorKind {
        match self {
            MailError::NoCredentials => ErrorKind::MailMissing,
            MailError::Connect(_) => ErrorKind::MailConnect,
            MailError::Offline(_) => ErrorKind::Offline,
            MailError::Auth { .. } => ErrorKind::MailAuth,
            MailError::Timeout => ErrorKind::MailTimeout,
            MailError::Lost(_) => ErrorKind::MailLost,
            MailError::NotGmail => ErrorKind::MailNotGmail,
            MailError::Server(_) => ErrorKind::MailServer,
            MailError::Cancelled => ErrorKind::MailCancelled,
        }
    }
}

/// Protocol errors after login. Only a real rejection at login is a credentials error -
/// a dropped connection never is (it used to count as a "wrong password").
fn protocol(error: async_imap::error::Error) -> MailError {
    use async_imap::error::Error as E;
    match error {
        E::Io(e) => io_error(&e),
        E::ConnectionLost => MailError::Lost("disconnected by the server".into()),
        E::No(text) | E::Bad(text) => MailError::Server(clean(&text)),
        E::Parse(_) => MailError::Server(UNREADABLE.into()),
        other => MailError::Server(clean(&other.to_string())),
    }
}

const UNREADABLE: &str = "unreadable reply from the mail server";

/// The start of std's text for a name that did not resolve on Unix (`getaddrinfo` failed:
/// "failed to lookup address information: nodename nor servname provided, or not known").
/// Its kind there is not public, so the text is the only mark.
const LOOKUP_FAILED: &str = "failed to lookup address information";

/// Windows' codes for a name that did not resolve (`WSAHOST_NOT_FOUND`, `WSATRY_AGAIN`,
/// `WSANO_DATA`): offline, the DNS server is out of reach. They mean something else on
/// other systems.
const WINDOWS_LOOKUP_FAILED: [i32; 3] = [11001, 11002, 11004];

/// The TCP connection to the mail server failed: without a network (the name of the server
/// did not resolve, the network is down or unreachable) it is `Offline`, the page then says
/// "Keine Verbindung zum Internet"; any other failure (refused, reset, a firewall) is
/// `Connect`, the server is not reachable.
fn connect_error(error: &std::io::Error) -> MailError {
    use std::io::ErrorKind as Kind;
    let lookup_failed = error.to_string().starts_with(LOOKUP_FAILED)
        || (cfg!(windows)
            && error
                .raw_os_error()
                .is_some_and(|code| WINDOWS_LOOKUP_FAILED.contains(&code)));
    let no_network = matches!(
        error.kind(),
        Kind::NetworkDown | Kind::NetworkUnreachable | Kind::HostUnreachable
    );
    if lookup_failed || no_network {
        MailError::Offline(clean(&error.to_string()))
    } else {
        MailError::Connect(clean(&error.to_string()))
    }
}

/// I/O errors. Parser errors from async-imap carry the whole unread buffer (i.e. mail
/// content) in their text - that never ends up in a message or the log.
fn io_error(error: &std::io::Error) -> MailError {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::TimedOut => MailError::Timeout,
        ErrorKind::Other | ErrorKind::InvalidData => MailError::Server(UNREADABLE.into()),
        kind => MailError::Lost(clean(&kind.to_string())),
    }
}

/// Server texts for messages: one line, at most 200 characters.
fn clean(text: &str) -> String {
    truncate_chars(&one_line(text), 200)
}

/// Errors at login: only a rejection of the credentials is a credentials problem.
/// Transient rejections (the server overloaded, too many connections, bandwidth limit)
/// are not - otherwise the user would change a correct password.
fn login_error(error: async_imap::error::Error, provider: MailProvider) -> MailError {
    match error {
        async_imap::error::Error::No(text) | async_imap::error::Error::Bad(text) => {
            let upper = text.to_ascii_uppercase();
            let transient = [
                "UNAVAILABLE",
                "THROTTLED",
                "OVERQUOTA",
                "LIMIT",
                "TOO MANY",
                "TEMPORARY",
                "TRY AGAIN",
            ]
            .iter()
            .any(|w| upper.contains(w));
            if transient {
                MailError::Server(format!("{} (temporary, try again later)", clean(&text)))
            } else {
                MailError::Auth {
                    text: clean(&text),
                    allow_imap: provider.imap_must_be_allowed(),
                }
            }
        }
        other => protocol(other),
    }
}

/// The mailbox's credentials: its provider, the address and the password. Address and
/// password are normalised in **one** place: the address trimmed and lowercased, the password
/// in the shape the provider's server takes ([`MailProvider::password`]).
#[derive(Clone)]
pub struct Credentials {
    pub provider: MailProvider,
    pub user: String,
    password: String,
}

impl Credentials {
    pub fn new(provider: MailProvider, user: &str, password: &str) -> Credentials {
        Credentials {
            provider,
            user: user.trim().to_lowercase(),
            password: provider.password(password),
        }
    }

    pub fn password(&self) -> &str {
        &self.password
    }
}

/// The password never appears in debug output or logs.
impl fmt::Debug for Credentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Credentials")
            .field("provider", &self.provider)
            .field("user", &self.user)
            .finish_non_exhaustive()
    }
}

/// Where the mails come from - the IMAP server, or a fake in tests.
pub trait MailSource {
    /// Ids of the matches since `since` (`None` = all), ascending: the source's own handles
    /// for the mails it found, valid until its next search.
    fn search(
        &mut self,
        since: Option<Date>,
        portals: &[Portal],
    ) -> impl Future<Output = Result<Vec<u32>, MailError>> + Send;

    /// The heads of the mails for `ids` (sender, subject, date, message id) - a few hundred
    /// bytes each; the bodies stay on the server. Mails deleted in the meantime are missing.
    fn heads(
        &mut self,
        ids: &[u32],
    ) -> impl Future<Output = Result<Vec<RawHead>, MailError>> + Send;

    /// The whole mails for `ids` - only for mails whose head made them a candidate. Mails
    /// deleted in the meantime are simply missing; a mail without content comes back with
    /// empty bytes (counted as defective, never silently dropped).
    fn fetch(
        &mut self,
        ids: &[u32],
    ) -> impl Future<Output = Result<Vec<RawMail>, MailError>> + Send;

    /// Ends the session after the scan (IMAP `LOGOUT`); errors do not matter. Sources
    /// without a session do nothing.
    fn logout(self) -> impl Future<Output = ()> + Send
    where
        Self: Sized,
    {
        async {}
    }
}

/// The head fields a scan needs to decide whether a mail may be an alert.
const HEAD_FIELDS: &str = "FROM SUBJECT DATE MESSAGE-ID";

/// The sender domains of `portals`, each once.
fn sender_domains(portals: &[Portal]) -> Vec<&'static str> {
    let mut domains: Vec<&'static str> = Vec::new();
    for domain in portals
        .iter()
        .flat_map(|p| p.sender_domains().iter().copied())
    {
        if !domains.contains(&domain) {
            domains.push(domain);
        }
    }
    domains
}

/// IMAP's day for `SINCE` (month names are English; jiff writes them whatever the system
/// language).
fn imap_day(date: Date) -> String {
    date.strftime("%d-%b-%Y").to_string()
}

/// Gmail's search: the portals' sender domains **or** their keywords (forwarded alerts come
/// from the user themselves). `X-GM-RAW` is Gmail's own search - server-side, fast and
/// without downloading the mailbox. In All Mail (`all_mail`) drafts and the user's own sent
/// mails stay out - a mail the user sent to themselves is in the inbox and counts.
fn gmail_query(since: Option<Date>, portals: &[Portal], all_mail: bool) -> String {
    let domains = sender_domains(portals);
    let terms: Vec<&str> = portals
        .iter()
        .flat_map(|p| p.search_terms().iter().copied())
        .collect();
    let raw = if all_mail {
        format!(
            r#"X-GM-RAW "(from:({}) OR {}) -in:drafts (in:inbox OR -in:sent)""#,
            domains.join(" OR "),
            terms.join(" OR ")
        )
    } else {
        format!(
            r#"X-GM-RAW "from:({}) OR {}""#,
            domains.join(" OR "),
            terms.join(" OR ")
        )
    };
    match since {
        Some(date) => format!("SINCE {} {raw}", imap_day(date)),
        None => raw,
    }
}

/// The standard search: from one of the portals' sender domains (IMAP's `FROM` matches a part
/// of the sender, so `linkedin.com` also finds `e.linkedin.com`), since `since`. IMAP's `OR`
/// takes two keys, so more domains nest: `OR FROM "a" OR FROM "b" FROM "c"`.
fn standard_query(since: Option<Date>, portals: &[Portal]) -> String {
    let senders = sender_domains(portals)
        .into_iter()
        .map(|domain| format!("FROM \"{domain}\""))
        .rev()
        .reduce(|later, key| format!("OR {key} {later}"))
        .unwrap_or_default();
    match since {
        Some(date) => format!("SINCE {} {senders}", imap_day(date)),
        None => senders,
    }
}

/// The folders to read, from the server's `LIST` (name and attributes, in its order). Gmail:
/// All Mail (`\All`), else the inbox. The others: the inbox, then every selectable folder
/// marked as the archive or all mail.
fn folders(
    provider: MailProvider,
    listed: &[(String, Vec<NameAttribute<'static>>)],
) -> Vec<String> {
    let marked = |attributes: &[NameAttribute<'static>], wanted: &[NameAttribute<'static>]| {
        !attributes.contains(&NameAttribute::NoSelect)
            && attributes.iter().any(|a| wanted.contains(a))
    };
    if provider.is_gmail() {
        let all = listed
            .iter()
            .find(|(_, attributes)| marked(attributes, &[NameAttribute::All]))
            .map(|(name, _)| name.clone());
        return vec![all.unwrap_or_else(|| INBOX.to_owned())];
    }
    let mut folders = vec![INBOX.to_owned()];
    for (name, attributes) in listed {
        if marked(attributes, &[NameAttribute::Archive, NameAttribute::All])
            && !name.eq_ignore_ascii_case(INBOX)
            && !folders.contains(name)
        {
            folders.push(name.clone());
        }
    }
    folders
}

/// The Message-ID in a mail's head, if it has one.
fn message_id(head: &[u8]) -> Option<String> {
    super::parse_mail(head)?
        .message_id
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

/// Connection to the mail server: TCP with an idle limit, TLS on top.
pub(crate) type Stream = TlsStream<Pin<Box<TimeoutStream<TcpStream>>>>;

/// A signed-in IMAP session, read-only.
pub struct Imap<T = Stream>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + fmt::Debug + Send,
{
    session: async_imap::Session<T>,
    cancel: CancellationToken,
    provider: MailProvider,
    /// The folders searched, in order ([`folders`]).
    folders: Vec<String>,
    /// Gmail: All Mail is the folder (else the inbox).
    all_mail: bool,
    /// The folder open now (`EXAMINE`), by its place in `folders`.
    open: Option<usize>,
    /// The matches of the last search: id `n` is `found[n - 1]`, (folder, UID).
    found: Vec<(usize, u32)>,
}

impl Imap {
    /// Connect to the provider's server, log in, find the folders and open the first one
    /// read-only.
    pub async fn connect(
        credentials: &Credentials,
        cancel: CancellationToken,
    ) -> Result<Imap, MailError> {
        let host = credentials.provider.host();
        let config = rustls::ClientConfig::with_platform_verifier()
            .map_err(|e| MailError::Connect(e.to_string()))?;
        let tls = tokio_rustls::TlsConnector::from(Arc::new(config));
        let server = rustls::pki_types::ServerName::try_from(host)
            .map_err(|e| MailError::Connect(e.to_string()))?;
        let tcp = guarded(&cancel, TcpStream::connect((host, IMAP_PORT)), |e| {
            connect_error(&e)
        })
        .await?;
        // Idle limit instead of a total limit: a large mail on a slow line may take its
        // time as long as data flows; a hung connection ends after 30 s.
        let mut tcp = TimeoutStream::new(tcp);
        tcp.set_read_timeout(Some(IDLE));
        tcp.set_write_timeout(Some(IDLE));
        let stream = guarded(&cancel, tls.connect(server, Box::pin(tcp)), |e| {
            MailError::Connect(e.to_string())
        })
        .await?;
        let mut client = async_imap::Client::new(stream);
        guarded(&cancel, client.read_response(), |e| {
            MailError::Connect(e.to_string())
        })
        .await?
        .ok_or_else(|| MailError::Connect("no greeting from the server".into()))?;
        // Boxed: the client and its buffers move into the sign-in.
        let mut session = Box::pin(login(client, credentials, &cancel)).await?;
        if credentials.provider.is_gmail() {
            let capabilities = guarded(&cancel, session.capabilities(), protocol).await?;
            if !capabilities.has_str("X-GM-EXT-1") {
                return Err(MailError::NotGmail);
            }
        }
        let mut imap = Imap::new(session, cancel, credentials.provider);
        imap.open_folders().await?;
        Ok(imap)
    }
}

/// Signs in with each of the provider's names for the address in turn
/// ([`MailProvider::login_names`]); only a refusal of the credentials tries the next one, on
/// the same connection.
async fn login<T>(
    mut client: async_imap::Client<T>,
    credentials: &Credentials,
    cancel: &CancellationToken,
) -> Result<async_imap::Session<T>, MailError>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + fmt::Debug + Send,
{
    let names = credentials.provider.login_names(&credentials.user);
    let mut names = names.iter().peekable();
    while let Some(name) = names.next() {
        let attempt = client.login(name, credentials.password());
        let attempt = guarded(
            cancel,
            async { Ok(attempt.await) },
            |never: std::convert::Infallible| match never {},
        )
        .await?;
        match attempt {
            Ok(session) => return Ok(session),
            Err((error, back)) => {
                let error = login_error(error, credentials.provider);
                if !matches!(error, MailError::Auth { .. }) || names.peek().is_none() {
                    return Err(error);
                }
                client = back;
            }
        }
    }
    Err(MailError::NoCredentials)
}

impl<T> Imap<T>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + fmt::Debug + Send,
{
    /// A session signed in, with the inbox as its folder until [`Imap::open_folders`].
    fn new(
        session: async_imap::Session<T>,
        cancel: CancellationToken,
        provider: MailProvider,
    ) -> Self {
        Imap {
            session,
            cancel,
            provider,
            folders: vec![INBOX.to_owned()],
            all_mail: false,
            open: None,
            found: Vec::new(),
        }
    }

    /// Finds the folders to read in the server's `LIST` ([`folders`]: by their special-use
    /// attribute, whatever their localized name) and opens the first one read-only.
    async fn open_folders(&mut self) -> Result<(), MailError> {
        let mut listed = Vec::new();
        self.command(r#"LIST "" "*""#, |response| {
            if let Response::MailboxData(MailboxDatum::List {
                name_attributes,
                name,
                ..
            }) = response
            {
                // Only the attributes [`folders`] reads (the others may borrow the reply).
                let kept: Vec<NameAttribute<'static>> = name_attributes
                    .iter()
                    .filter_map(|attribute| match attribute {
                        NameAttribute::NoSelect => Some(NameAttribute::NoSelect),
                        NameAttribute::All => Some(NameAttribute::All),
                        NameAttribute::Archive => Some(NameAttribute::Archive),
                        _ => None,
                    })
                    .collect();
                listed.push((name.to_string(), kept));
            }
        })
        .await?;
        self.folders = folders(self.provider, &listed);
        self.all_mail = self.provider.is_gmail() && self.folders[0] != INBOX;
        self.open = None;
        self.found.clear();
        self.examine(0).await
    }

    /// Opens the folder `index` read-only, unless it is open already.
    async fn examine(&mut self, index: usize) -> Result<(), MailError> {
        if self.open == Some(index) {
            return Ok(());
        }
        let name = self.folders[index].clone();
        let cancel = self.cancel.clone();
        // A failure leaves no folder open: the next step opens it again.
        self.open = None;
        guarded(&cancel, self.session.examine(&name), protocol).await?;
        self.open = Some(index);
        Ok(())
    }

    /// Log out; errors here do not matter (the connection ends either way).
    pub async fn close(mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(5), self.session.logout()).await;
    }

    /// Sends a command and reads up to its completion response. `NO`/`BAD` is an error -
    /// async-imap itself does not check this for SEARCH and FETCH; a failed search would
    /// otherwise look like "no mails".
    async fn command(
        &mut self,
        command: &str,
        mut on_data: impl FnMut(&Response<'_>),
    ) -> Result<(), MailError> {
        let tag = guarded(&self.cancel, self.session.run_command(command), protocol).await?;
        loop {
            let data = guarded(&self.cancel, self.session.read_response(), |e| io_error(&e))
                .await?
                .ok_or_else(|| MailError::Lost("disconnected by the server".into()))?;
            match data.parsed() {
                Response::Done {
                    tag: done,
                    status,
                    information,
                    ..
                } if *done == tag => {
                    return match status {
                        Status::Ok => Ok(()),
                        _ => Err(MailError::Server(clean(
                            information.as_deref().unwrap_or("command rejected"),
                        ))),
                    };
                }
                other => on_data(other),
            }
        }
    }

    /// The UIDs `query` finds in the open folder, ascending and each once.
    async fn search_open(&mut self, query: &str) -> Result<Vec<u32>, MailError> {
        let mut uids = Vec::new();
        self.command(&format!("UID SEARCH {query}"), |response| {
            if let Response::MailboxData(MailboxDatum::Search(ids)) = response {
                uids.extend(ids.iter().copied());
            }
        })
        .await?;
        uids.sort_unstable();
        uids.dedup();
        Ok(uids)
    }

    /// The standard search in every folder; with more than one folder a mail whose
    /// Message-ID came up before (a copy in the archive or in all mail) is left out.
    async fn search_folders(&mut self, query: &str) -> Result<Vec<(usize, u32)>, MailError> {
        let several = self.folders.len() > 1;
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        for folder in 0..self.folders.len() {
            self.examine(folder).await?;
            let uids = self.search_open(query).await?;
            if !several {
                found.extend(uids.into_iter().map(|uid| (folder, uid)));
                continue;
            }
            let mut ids = BTreeMap::new();
            for chunk in uids.chunks(ID_BATCH) {
                ids.extend(self.head_fields(chunk, "MESSAGE-ID").await?);
            }
            for uid in uids {
                let copy = ids
                    .get(&uid)
                    .and_then(|head| message_id(head))
                    .is_some_and(|id| !seen.insert(id));
                if !copy {
                    found.push((folder, uid));
                }
            }
        }
        Ok(found)
    }

    /// The asked head fields of the mails `uids` in the open folder, by UID; mails the
    /// server does not return (deleted meanwhile) are missing.
    async fn head_fields(
        &mut self,
        uids: &[u32],
        fields: &str,
    ) -> Result<BTreeMap<u32, Vec<u8>>, MailError> {
        let wanted: HashSet<u32> = uids.iter().copied().collect();
        let mut heads = BTreeMap::new();
        let command = format!(
            "UID FETCH {} (UID BODY.PEEK[HEADER.FIELDS ({fields})])",
            uid_set(uids)
        );
        self.command(&command, |response| {
            let Response::Fetch(_, attributes) = response else {
                return;
            };
            let (mut uid, mut bytes) = (None, None);
            for attribute in attributes {
                match attribute {
                    AttributeValue::Uid(u) => uid = Some(*u),
                    AttributeValue::BodySection { data, .. } => {
                        bytes = Some(data.as_deref().unwrap_or_default().to_vec());
                    }
                    _ => {}
                }
            }
            if let (Some(uid), Some(bytes)) = (uid, bytes)
                && wanted.contains(&uid)
            {
                heads.insert(uid, bytes);
            }
        })
        .await?;
        Ok(heads)
    }

    /// The ids of the last search grouped by folder, each with its UID: `(folder, [(UID,
    /// id)])` in the folders' order. Ids the search did not hand out are left out.
    fn by_folder(&self, ids: &[u32]) -> Vec<(usize, Vec<(u32, u32)>)> {
        let mut groups: BTreeMap<usize, Vec<(u32, u32)>> = BTreeMap::new();
        for &id in ids {
            let found = usize::try_from(id)
                .ok()
                .and_then(|n| n.checked_sub(1))
                .and_then(|n| self.found.get(n));
            if let Some(&(folder, uid)) = found {
                groups.entry(folder).or_default().push((uid, id));
            }
        }
        groups.into_iter().collect()
    }
}

impl<T> MailSource for Imap<T>
where
    T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + fmt::Debug + Send,
{
    async fn logout(self) {
        self.close().await;
    }

    async fn search(
        &mut self,
        since: Option<Date>,
        portals: &[Portal],
    ) -> Result<Vec<u32>, MailError> {
        self.found.clear();
        if portals.is_empty() {
            return Ok(Vec::new());
        }
        self.found = if self.provider.is_gmail() {
            self.examine(0).await?;
            let query = gmail_query(since, portals, self.all_mail);
            let uids = self.search_open(&query).await?;
            uids.into_iter().map(|uid| (0, uid)).collect()
        } else {
            let query = standard_query(since, portals);
            self.search_folders(&query).await?
        };
        Ok((1..=self.found.len())
            .filter_map(|n| u32::try_from(n).ok())
            .collect())
    }

    async fn heads(&mut self, ids: &[u32]) -> Result<Vec<RawHead>, MailError> {
        let mut heads = BTreeMap::new();
        for (folder, pairs) in self.by_folder(ids) {
            self.examine(folder).await?;
            let uids: Vec<u32> = pairs.iter().map(|&(uid, _)| uid).collect();
            let mut got = self.head_fields(&uids, HEAD_FIELDS).await?;
            for (uid, id) in pairs {
                if let Some(bytes) = got.remove(&uid) {
                    heads.insert(id, RawHead { uid: id, bytes });
                }
            }
        }
        Ok(heads.into_values().collect())
    }

    async fn fetch(&mut self, ids: &[u32]) -> Result<Vec<RawMail>, MailError> {
        let mut mails = BTreeMap::new();
        // Gmail adds its message id for the link to the mail in Gmail; other servers know no
        // such item and would refuse the whole command.
        let items = if self.provider.is_gmail() {
            "UID X-GM-MSGID"
        } else {
            "UID"
        };
        for (folder, pairs) in self.by_folder(ids) {
            self.examine(folder).await?;
            let by_uid: BTreeMap<u32, u32> = pairs.iter().copied().collect();
            let uids: Vec<u32> = by_uid.keys().copied().collect();
            let command = format!(
                "UID FETCH {} ({items} BODY.PEEK[]<0.{MAX_MAIL_BYTES}>)",
                uid_set(&uids)
            );
            self.command(&command, |response| {
                let Response::Fetch(_, attributes) = response else {
                    return;
                };
                let (mut uid, mut gmail_id, mut body) = (None, None, None);
                for attribute in attributes {
                    match attribute {
                        AttributeValue::Uid(u) => uid = Some(*u),
                        AttributeValue::GmailMsgId(id) => gmail_id = Some(*id),
                        AttributeValue::BodySection {
                            section: None,
                            data,
                            ..
                        } => body = Some(data.as_deref().unwrap_or_default().to_vec()),
                        _ => {}
                    }
                }
                // Only requested mails with content, each once - pure status updates
                // (e.g. "read in the meantime") are not a mail.
                if let (Some(uid), Some(bytes)) = (uid, body)
                    && let Some(&id) = by_uid.get(&uid)
                {
                    mails.insert(id, RawMail { gmail_id, bytes });
                }
            })
            .await?;
        }
        Ok(mails.into_values().collect())
    }
}

/// An IMAP UID set: `7,9,12`.
fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// Runs one network step, cancellable. The idle limit sits on the connection; this
/// overall limit only catches whatever could hang beyond that.
async fn guarded<T, E>(
    cancel: &CancellationToken,
    step: impl Future<Output = Result<T, E>>,
    map: impl FnOnce(E) -> MailError,
) -> Result<T, MailError> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(MailError::Cancelled),
        result = tokio::time::timeout(STEP_LIMIT, step) => match result {
            Err(_) => Err(MailError::Timeout),
            Ok(result) => result.map_err(map),
        },
    }
}

#[cfg(test)]
mod tests;
