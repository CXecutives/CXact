//! The mailbox's address and password in the system keychain (the Credential Manager on
//! Windows, the keychain elsewhere). The app stores **only** this one credential - the job
//! sources need no account, and the freelance.de login lives solely in the session window's
//! profile. The mailbox's provider is no secret: the settings keep it
//! (`Settings::mail_provider`).

use crate::error::{ErrorKind, InvalidInput};
use crate::mail::MailProvider;
use crate::mail::imap::Credentials;

/// Service name in the keychain.
pub(crate) const SERVICE: &str = "de.cxecutives.job-alert-monitor";
/// The entry's account name, whatever the provider: a new name would leave the secret stored
/// under this one behind in the keychain.
const ACCOUNT: &str = "gmail";

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("cannot access the system keychain: {0}")]
    Store(String),
    /// Never overwrite silently: the user decides whether to enter it again.
    #[error("stored mailbox credentials are unreadable")]
    Corrupt,
    #[error("invalid credentials: {0}")]
    Invalid(InvalidInput),
}

impl SecretError {
    /// Stable error code for the interface.
    pub fn kind(&self) -> ErrorKind {
        match self {
            SecretError::Store(_) => ErrorKind::SecretStore,
            SecretError::Corrupt => ErrorKind::SecretCorrupt,
            SecretError::Invalid(_) => ErrorKind::Invalid,
        }
    }
}

/// One entry in the keychain; tests use their own service name.
pub struct Vault {
    service: String,
}

impl Vault {
    pub fn app() -> Vault {
        Vault {
            service: SERVICE.into(),
        }
    }

    /// Separate entry for tests only - a test must never touch the app's credentials.
    #[cfg(test)]
    pub(crate) fn for_tests(name: &str) -> Vault {
        Vault {
            service: format!("{SERVICE}.test.{name}.{}", std::process::id()),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(&self.service, ACCOUNT).map_err(|e| SecretError::Store(e.to_string()))
    }

    /// The stored credentials of the mailbox at `provider` (the settings' provider: it says
    /// how the password is read); `None` if none are stored.
    pub fn load(&self, provider: MailProvider) -> Result<Option<Credentials>, SecretError> {
        let secret = match self.entry()?.get_password() {
            Ok(secret) => secret,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(e) => return Err(SecretError::Store(e.to_string())),
        };
        let value: serde_json::Value =
            serde_json::from_str(&secret).map_err(|_| SecretError::Corrupt)?;
        match (value["user"].as_str(), value["password"].as_str()) {
            (Some(user), Some(password)) => Ok(Some(Credentials::new(provider, user, password))),
            _ => Err(SecretError::Corrupt),
        }
    }

    /// Validates and stores address and password. The shape is checked again here
    /// ([`Credentials::validate`], the same rule "Verbinden" applies before any sign-in): only
    /// an address and a password of the provider's shape ever reach the vault.
    pub fn save(&self, credentials: &Credentials) -> Result<(), SecretError> {
        credentials.validate().map_err(SecretError::Invalid)?;
        let secret = serde_json::json!({
            "user": credentials.user,
            "password": credentials.password(),
        })
        .to_string();
        self.entry()?
            .set_password(&secret)
            .map_err(|e| SecretError::Store(e.to_string()))
    }

    /// Removes the credentials; `false` if there were none.
    pub fn delete(&self) -> Result<bool, SecretError> {
        match self.entry()?.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(SecretError::Store(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real keychain with a dedicated test service and dummy values.
    #[cfg(windows)]
    #[test]
    fn round_trip_in_the_vault() {
        let vault = Vault {
            service: format!("{SERVICE}.selftest.{}", std::process::id()),
        };
        assert!(vault.load(MailProvider::Gmail).unwrap().is_none());
        let c = Credentials::new(
            MailProvider::Gmail,
            " Test@Example.org ",
            "abcd efgh ijkl mnop",
        );
        vault.save(&c).unwrap();
        let back = vault.load(MailProvider::Gmail).unwrap().unwrap();
        assert_eq!(
            (back.user.as_str(), back.password()),
            ("test@example.org", "abcdefghijklmnop")
        );
        // A GMX password is kept exactly, blanks included.
        vault
            .save(&Credentials::new(
                MailProvider::Gmx,
                "test@gmx.de",
                " ein Satz ",
            ))
            .unwrap();
        let back = vault.load(MailProvider::Gmx).unwrap().unwrap();
        assert_eq!(back.password(), " ein Satz ");
        assert!(vault.delete().unwrap());
        assert!(!vault.delete().unwrap());
        assert!(vault.load(MailProvider::Gmail).unwrap().is_none());
    }

    #[test]
    fn obviously_wrong_input_is_refused_before_storing() {
        let vault = Vault {
            service: "never-used".into(),
        };
        for (provider, user, password) in [
            (MailProvider::Gmail, "no-at-sign", "abcdefghijklmnop"),
            (MailProvider::Gmail, "ich@gmail.com", "MyAccountPassword1!"),
            (MailProvider::Gmail, "ich@gmail.com", "abcd efgh ijkl"),
            (
                MailProvider::Icloud,
                "ich@icloud.com",
                "MyAccountPassword1!",
            ),
            (MailProvider::Webde, "ich@web.de", ""),
        ] {
            assert!(matches!(
                vault.save(&Credentials::new(provider, user, password)),
                Err(SecretError::Invalid(_))
            ));
        }
    }
}
