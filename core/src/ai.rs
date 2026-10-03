//! The client of the CV worker (`cv-worker/`, a Cloudflare Worker in CXact's account): it
//! sends a CV read by [`crate::profile::cv`] and receives the AI part of the profile (the
//! worker's `schema.json`), or a code ([`CvError`]). Its own HTTP client with a long time limit
//! (the AI reads a whole CV); cancelling ends the request.
//!
//! **Never in the dry run:** the caller (the command) answers `DryRun` before it calls
//! [`CvClient::fill`], so CI never reaches the paid worker. The address is a constant.
//!
//! The install id ([`install_id`]) is a random UUID in a small file next to `policy.json` in
//! the app's data folder; a reset keeps it (it is not among the reset's targets), so a reset
//! never gives new tries. The worker counts tries by it and, unseen, by the address.
//!
//! Logs: code, format, size, duration and cost only; never the id, a name, a path, the text
//! or the answer.

use std::path::Path;
use std::time::{Duration, Instant};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use reqwest::header::{ACCEPT, CONTENT_TYPE};
use reqwest::{Client, Response};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tokio_util::sync::CancellationToken;
use url::Url;

use crate::profile::cv::{Cv, CvError, CvInput};

/// The worker's address (its route `POST /v1/cv`).
pub const WORKER_URL: &str = "https://cxact-cv.cxact.workers.dev/v1/cv";
/// Version of the request; the worker answers `outdated` to any other.
pub const REQUEST_SCHEMA: u32 = 1;
/// The install id's file in the app's data folder, next to [`crate::POLICY_FILE`].
pub const INSTALL_ID_FILE: &str = "install-id";
/// Above the worker's own limit for the AI (150 s), so its code arrives.
const TIMEOUT: Duration = Duration::from_secs(160);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// An answer larger than this is no profile.
const MAX_ANSWER: usize = 1024 * 1024;

/// The worker's answer: the AI part of the profile as JSON (still to be read by the profile
/// form and capped there), the tries left today, from when on it works again when none are
/// left, and what the call cost.
#[derive(Debug, Clone, PartialEq)]
pub struct CvAnswer {
    pub profile: Map<String, Value>,
    pub remaining_today: u32,
    pub until: Option<String>,
    pub cost_usd: Option<f64>,
}

pub struct CvClient {
    client: Client,
    url: Url,
}

impl CvClient {
    pub fn new() -> Result<CvClient, reqwest::Error> {
        Self::with_url(Url::parse(WORKER_URL).expect("valid worker address"))
    }

    /// Like [`CvClient::new`], with another address (tests: a local server).
    pub(crate) fn with_url(url: Url) -> Result<CvClient, reqwest::Error> {
        let client = Client::builder()
            .user_agent(concat!("CXact/", env!("CARGO_PKG_VERSION")))
            .timeout(TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()?;
        Ok(CvClient { client, url })
    }

    /// Sends the CV and reads the answer. Never call it in the dry run (see the module docs).
    pub async fn fill(
        &self,
        install_id: &str,
        cv: &Cv,
        cancel: &CancellationToken,
    ) -> Result<CvAnswer, CvError> {
        let started = Instant::now();
        let body = serde_json::to_vec(&request(install_id, &cv.input)).expect("serialisable");
        let sent = body.len();
        let result = tokio::select! {
            biased;
            () = cancel.cancelled() => Err(CvError::Cancelled),
            result = self.send(body) => result,
        };
        let code = match &result {
            Ok(_) => "ok".to_owned(),
            Err(e) => serde_json::to_value(e)
                .ok()
                .and_then(|v| v.get("code").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_default(),
        };
        let cost = result.as_ref().ok().and_then(|a| a.cost_usd);
        log::info!(
            "cv: {code}, {:?}, {} in, {sent} bytes sent, {} ms, cost {cost:?} USD",
            cv.format,
            cv.size(),
            started.elapsed().as_millis()
        );
        result
    }

    async fn send(&self, body: Vec<u8>) -> Result<CvAnswer, CvError> {
        let response = self
            .client
            .post(self.url.clone())
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| net_error(&e))?;
        let success = response.status().is_success();
        let bytes = read_body(response).await?;
        answer(success, &bytes)
    }
}

/// The request: schema, install id and either the text or the files (base64, neutral names:
/// the user's own file name may carry their name).
fn request(install_id: &str, input: &CvInput) -> Value {
    match input {
        CvInput::Text(text) => json!({
            "schema": REQUEST_SCHEMA,
            "installId": install_id,
            "kind": "text",
            "text": text,
        }),
        CvInput::Files(files) => {
            let files: Vec<Value> = files
                .iter()
                .enumerate()
                .map(|(i, file)| {
                    let extension = file.mime.rsplit('/').next().unwrap_or("bin");
                    json!({
                        "name": format!("cv-{}.{extension}", i + 1),
                        "mime": file.mime,
                        "dataBase64": STANDARD.encode(&file.bytes),
                    })
                })
                .collect();
            json!({
                "schema": REQUEST_SCHEMA,
                "installId": install_id,
                "kind": "files",
                "files": files,
            })
        }
    }
}

fn net_error(error: &reqwest::Error) -> CvError {
    if error.is_timeout() {
        CvError::Timeout
    } else {
        CvError::Offline
    }
}

async fn read_body(mut response: Response) -> Result<Vec<u8>, CvError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| net_error(&e))? {
        if bytes.len() + chunk.len() > MAX_ANSWER {
            return Err(CvError::Unavailable);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Success {
    profile: Map<String, Value>,
    remaining_today: u32,
    #[serde(default)]
    until: Option<String>,
    #[serde(default)]
    cost_usd: Option<f64>,
}

#[derive(Deserialize)]
struct Failure {
    code: String,
    #[serde(default)]
    params: Map<String, Value>,
}

/// The worker's answer: the profile, or its code (anything unknown, a page of the platform
/// instead of JSON included, is `unavailable`).
fn answer(success: bool, body: &[u8]) -> Result<CvAnswer, CvError> {
    if success {
        let ok: Success = serde_json::from_slice(body).map_err(|_| CvError::Unavailable)?;
        return Ok(CvAnswer {
            profile: ok.profile,
            remaining_today: ok.remaining_today,
            until: ok.until,
            cost_usd: ok.cost_usd,
        });
    }
    let Ok(failure) = serde_json::from_slice::<Failure>(body) else {
        return Err(CvError::Unavailable);
    };
    Err(match failure.code.as_str() {
        "limit" => CvError::Limit {
            until: failure
                .params
                .get("until")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        },
        "paused" => CvError::Paused,
        "outdated" => CvError::Outdated,
        "tooLarge" => CvError::TooLarge,
        "refused" => CvError::Refused,
        // `invalid` would be a fault of this app; for the user it is the same.
        _ => CvError::Unavailable,
    })
}

/// The install id: read from [`INSTALL_ID_FILE`] in `data_dir`, created on first use (a
/// random UUID). An unreadable file is replaced by a new id.
pub fn install_id(data_dir: &Path) -> crate::Result<String> {
    let path = data_dir.join(INSTALL_ID_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) if is_install_id(text.trim()) => return Ok(text.trim().to_owned()),
        Ok(_) => log::warn!("ai: install id unreadable, a new one is made"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(source) => return Err(crate::Error::Io { path, source }),
    }
    let id = uuid::Uuid::new_v4().to_string();
    crate::export::write_atomic(&path, id.as_bytes())?;
    Ok(id)
}

/// A UUID of version 4 in the lower-case hyphenated form the worker takes.
fn is_install_id(text: &str) -> bool {
    uuid::Uuid::parse_str(text)
        .is_ok_and(|id| id.get_version_num() == 4 && id.hyphenated().to_string() == text)
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::profile::cv::{CvFile, Format};

    const ID: &str = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

    fn text_cv() -> Cv {
        Cv {
            input: CvInput::Text("Controlling, SAP S/4HANA".into()),
            format: Format::Txt,
        }
    }

    fn client(server: &MockServer) -> CvClient {
        crate::install_crypto();
        CvClient::with_url(Url::parse(&format!("{}/v1/cv", server.uri())).unwrap()).unwrap()
    }

    #[tokio::test]
    async fn sends_the_text_and_reads_the_profile() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/cv"))
            .and(body_partial_json(json!({
                "schema": 1, "installId": ID, "kind": "text", "text": "Controlling, SAP S/4HANA"
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "profile": { "wunschrollen": ["Interim CFO"] },
                "remainingToday": 0,
                "until": "2026-10-04",
                "costUsd": 0.0123
            })))
            .expect(1)
            .mount(&server)
            .await;
        let answer = client(&server)
            .fill(ID, &text_cv(), &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(answer.profile["wunschrollen"], json!(["Interim CFO"]));
        assert_eq!(answer.remaining_today, 0);
        assert_eq!(answer.until.as_deref(), Some("2026-10-04"));
        assert_eq!(answer.cost_usd, Some(0.0123));
    }

    #[tokio::test]
    async fn reads_the_codes_of_the_worker() {
        let cases = [
            (
                429,
                json!({"code": "limit", "params": {"until": "2026-11-01"}}),
                CvError::Limit {
                    until: "2026-11-01".into(),
                },
            ),
            (
                503,
                json!({"code": "paused", "params": {}}),
                CvError::Paused,
            ),
            (
                400,
                json!({"code": "outdated", "params": {}}),
                CvError::Outdated,
            ),
            (
                413,
                json!({"code": "tooLarge", "params": {}}),
                CvError::TooLarge,
            ),
            (
                422,
                json!({"code": "refused", "params": {}}),
                CvError::Refused,
            ),
            (
                502,
                json!({"code": "unavailable", "params": {}}),
                CvError::Unavailable,
            ),
            (
                400,
                json!({"code": "invalid", "params": {}}),
                CvError::Unavailable,
            ),
        ];
        for (status, body, expected) in cases {
            let server = MockServer::start().await;
            Mock::given(method("POST"))
                .respond_with(ResponseTemplate::new(status).set_body_json(body))
                .mount(&server)
                .await;
            let result = client(&server)
                .fill(ID, &text_cv(), &CancellationToken::new())
                .await;
            assert_eq!(result, Err(expected));
        }
    }

    #[tokio::test]
    async fn a_page_instead_of_json_is_unavailable() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(502).set_body_string("<html>Bad gateway</html>"))
            .mount(&server)
            .await;
        let result = client(&server)
            .fill(ID, &text_cv(), &CancellationToken::new())
            .await;
        assert_eq!(result, Err(CvError::Unavailable));
    }

    #[tokio::test]
    async fn no_server_is_offline_and_cancelling_ends_it() {
        crate::install_crypto();
        let nowhere = CvClient::with_url(Url::parse("http://127.0.0.1:9/v1/cv").unwrap()).unwrap();
        let result = nowhere
            .fill(ID, &text_cv(), &CancellationToken::new())
            .await;
        assert_eq!(result, Err(CvError::Offline));
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert_eq!(
            nowhere.fill(ID, &text_cv(), &cancel).await,
            Err(CvError::Cancelled)
        );
    }

    #[test]
    fn files_go_as_base64_with_neutral_names() {
        let input = CvInput::Files(vec![CvFile {
            mime: "application/pdf",
            bytes: b"%PDF-1.4".to_vec(),
        }]);
        let body = request(ID, &input);
        assert_eq!(
            body,
            json!({
                "schema": 1,
                "installId": ID,
                "kind": "files",
                "files": [{ "name": "cv-1.pdf", "mime": "application/pdf", "dataBase64": "JVBERi0xLjQ=" }]
            })
        );
    }

    #[test]
    fn the_install_id_is_made_once_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let first = install_id(dir.path()).unwrap();
        assert!(is_install_id(&first), "{first}");
        assert_eq!(install_id(dir.path()).unwrap(), first);
        std::fs::write(dir.path().join(INSTALL_ID_FILE), "not an id").unwrap();
        let second = install_id(dir.path()).unwrap();
        assert!(is_install_id(&second));
        assert_ne!(second, first);
    }

    #[test]
    fn the_errors_are_codes_with_params() {
        assert_eq!(
            serde_json::to_value(CvError::Limit {
                until: "2026-10-04".into()
            })
            .unwrap(),
            json!({"code": "limit", "params": {"until": "2026-10-04"}})
        );
        assert_eq!(
            serde_json::to_value(CvError::TooLarge).unwrap(),
            json!({"code": "tooLarge"})
        );
    }
}
