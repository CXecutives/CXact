//! The mailbox providers the app reads alert mails from, with their IMAP server and the shape
//! of their password.

use serde::{Deserialize, Serialize};

/// Where the mailbox lives. Gmail has its own search ([`MailProvider::is_gmail`]); the others
/// are read with standard IMAP (`mail/imap.rs`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum MailProvider {
    #[default]
    Gmail,
    Icloud,
    Gmx,
    Webde,
}

/// Every provider's IMAP server takes TLS on this port.
pub const IMAP_PORT: u16 = 993;

/// Letters of an app password of Google and Apple (both show them in groups of four).
const APP_PASSWORD_LETTERS: usize = 16;

/// The domains of Apple's own iCloud addresses: their IMAP sign-in usually takes only the name
/// part of the address.
const APPLE_DOMAINS: [&str; 3] = ["icloud.com", "me.com", "mac.com"];

impl MailProvider {
    pub const ALL: [MailProvider; 4] = [
        MailProvider::Gmail,
        MailProvider::Icloud,
        MailProvider::Gmx,
        MailProvider::Webde,
    ];

    /// The IMAP server (TLS on [`IMAP_PORT`]).
    pub const fn host(self) -> &'static str {
        match self {
            MailProvider::Gmail => "imap.gmail.com",
            MailProvider::Icloud => "imap.mail.me.com",
            MailProvider::Gmx => "imap.gmx.net",
            MailProvider::Webde => "imap.web.de",
        }
    }

    /// Gmail is searched with its own extension (`X-GM-RAW` in All Mail), the others with
    /// standard IMAP.
    pub const fn is_gmail(self) -> bool {
        matches!(self, MailProvider::Gmail)
    }

    /// IMAP access is off until the user allows it in the provider's web mailer: a refused
    /// sign-in may mean that instead of a wrong password (`allowImap` on the auth error).
    pub const fn imap_must_be_allowed(self) -> bool {
        matches!(self, MailProvider::Gmx | MailProvider::Webde)
    }

    /// The password as the server takes it, from what the user typed: Google's app password
    /// without the blanks it is shown with; Apple's in the groups Apple shows
    /// (`abcd-efgh-ijkl-mnop`), however it was typed; GMX's and WEB.DE's account password
    /// exactly as typed (blanks may belong to it).
    pub fn password(self, typed: &str) -> String {
        match self {
            MailProvider::Gmail => typed.chars().filter(|c| !c.is_whitespace()).collect(),
            MailProvider::Icloud => {
                let letters: String = typed
                    .chars()
                    .filter(|c| !c.is_whitespace() && *c != '-')
                    .collect();
                if is_app_password(&letters) {
                    let chars: Vec<char> = letters.chars().collect();
                    chars
                        .chunks(4)
                        .map(|group| group.iter().collect::<String>())
                        .collect::<Vec<_>>()
                        .join("-")
                } else {
                    letters
                }
            }
            MailProvider::Gmx | MailProvider::Webde => typed.to_owned(),
        }
    }

    /// The password (as [`MailProvider::password`] made it) has a shape the server can
    /// accept: an app password of 16 letters for Gmail and iCloud, any password for GMX and
    /// WEB.DE.
    pub fn password_fits(self, password: &str) -> bool {
        match self {
            MailProvider::Gmail => is_app_password(password),
            MailProvider::Icloud => is_app_password(&password.replace('-', "")),
            MailProvider::Gmx | MailProvider::Webde => !password.is_empty(),
        }
    }

    /// The names to sign in with, in order: the address; for an address of Apple's own
    /// domains first its name part, which Apple's server usually wants.
    pub fn login_names(self, address: &str) -> Vec<&str> {
        match (self, address.split_once('@')) {
            (MailProvider::Icloud, Some((name, domain))) if APPLE_DOMAINS.contains(&domain) => {
                vec![name, address]
            }
            _ => vec![address],
        }
    }
}

/// 16 ASCII letters.
fn is_app_password(text: &str) -> bool {
    text.chars().count() == APP_PASSWORD_LETTERS && text.chars().all(|c| c.is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_has_its_server_and_key() {
        let keys: Vec<String> = MailProvider::ALL
            .iter()
            .map(|p| {
                serde_json::to_value(p)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(keys, ["gmail", "icloud", "gmx", "webde"]);
        let hosts: Vec<&str> = MailProvider::ALL.iter().map(|p| p.host()).collect();
        assert_eq!(
            hosts,
            [
                "imap.gmail.com",
                "imap.mail.me.com",
                "imap.gmx.net",
                "imap.web.de"
            ]
        );
        assert_eq!(MailProvider::default(), MailProvider::Gmail);
        let only_gmail: Vec<bool> = MailProvider::ALL.iter().map(|p| p.is_gmail()).collect();
        assert_eq!(only_gmail, [true, false, false, false]);
        let switch: Vec<bool> = MailProvider::ALL
            .iter()
            .map(|p| p.imap_must_be_allowed())
            .collect();
        assert_eq!(switch, [false, false, true, true]);
    }

    /// Google's blanks go, Apple's groups come back however they were typed, GMX's and
    /// WEB.DE's password stays as typed.
    #[test]
    fn each_password_takes_its_providers_shape() {
        let gmail = MailProvider::Gmail.password("abcd efgh\tijkl mnop");
        assert_eq!(gmail, "abcdefghijklmnop");
        assert!(MailProvider::Gmail.password_fits(&gmail));
        for typed in [
            "abcd-efgh-ijkl-mnop",
            "abcdefghijklmnop",
            " abcd efgh ijkl mnop ",
        ] {
            let apple = MailProvider::Icloud.password(typed);
            assert_eq!(apple, "abcd-efgh-ijkl-mnop", "{typed}");
            assert!(MailProvider::Icloud.password_fits(&apple));
        }
        assert!(!MailProvider::Icloud.password_fits(&MailProvider::Icloud.password("kurz")));
        assert!(!MailProvider::Gmail.password_fits("MyAccountPassword1!"));
        for provider in [MailProvider::Gmx, MailProvider::Webde] {
            assert_eq!(provider.password(" mein Passwort "), " mein Passwort ");
            assert!(provider.password_fits("MyAccountPassword1!"));
            assert!(!provider.password_fits(""));
        }
    }

    #[test]
    fn apple_addresses_sign_in_with_their_name_first() {
        assert_eq!(
            MailProvider::Icloud.login_names("erika@icloud.com"),
            ["erika", "erika@icloud.com"]
        );
        assert_eq!(
            MailProvider::Icloud.login_names("erika@me.com"),
            ["erika", "erika@me.com"]
        );
        // A domain of the user's own on iCloud+, and every other provider: the address.
        assert_eq!(
            MailProvider::Icloud.login_names("erika@muster.de"),
            ["erika@muster.de"]
        );
        assert_eq!(
            MailProvider::Gmx.login_names("erika@gmx.de"),
            ["erika@gmx.de"]
        );
        assert_eq!(
            MailProvider::Gmail.login_names("erika@gmail.com"),
            ["erika@gmail.com"]
        );
    }
}
