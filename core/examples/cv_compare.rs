//! One paid call of the CV worker, read and sent exactly as the app sends it (a developer's
//! check, to compare the worker's model and effort settings):
//!
//! `cargo run -p jobalert-core --example cv_compare -- <cv file> <answer.json>`
//!
//! It reads the CV with [`jobalert_core::profile::cv::read`] (text redacted on the way out),
//! sends it with [`jobalert_core::ai::CvClient`] under a fresh random install id (so the
//! per-install daily limit does not stop a comparison; the per-address limit still holds) and
//! writes the AI part of the profile to the answer file. It prints the code, the count per
//! field, the duration and the cost only, never a value. Never part of a test run; the CVs and
//! the answers belong in `core/tests/fixtures/private/` (ignored).

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use jobalert_core::ai::CvClient;
use jobalert_core::profile::cv;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("usage: cv_compare <cv file> <answer.json>");
        return ExitCode::from(2);
    };
    jobalert_core::install_crypto();
    let cv = match cv::read(&[PathBuf::from(input)]) {
        Ok(cv) => cv,
        Err(e) => return fail("read", &e),
    };
    println!("read: {:?}, size {}", cv.format, cv.size());
    let client = CvClient::new().expect("http client");
    let id = uuid::Uuid::new_v4().to_string();
    let started = Instant::now();
    let result = client.fill(&id, &cv, &CancellationToken::new()).await;
    let ms = started.elapsed().as_millis();
    let answer = match result {
        Ok(answer) => answer,
        Err(e) => {
            println!("duration: {ms} ms");
            return fail("worker", &e);
        }
    };
    let text = serde_json::to_string_pretty(&answer.profile).expect("serialisable");
    if let Err(e) = std::fs::write(output, text) {
        eprintln!("write: {}", e.kind());
        return ExitCode::FAILURE;
    }
    println!("ok, duration: {ms} ms, cost: {:?} USD", answer.cost_usd);
    for (key, value) in &answer.profile {
        let count = match value {
            Value::Array(items) => items.len().to_string(),
            Value::Null => "null".to_owned(),
            _ => "set".to_owned(),
        };
        println!("  {key}: {count}");
    }
    ExitCode::SUCCESS
}

fn fail(step: &str, error: &cv::CvError) -> ExitCode {
    let code = serde_json::to_value(error)
        .ok()
        .and_then(|v| v.get("code").and_then(Value::as_str).map(str::to_owned))
        .unwrap_or_default();
    println!("{step} failed: {code}");
    ExitCode::FAILURE
}
