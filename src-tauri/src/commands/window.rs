//! The window buttons of the top bar (`ui/src/components/WindowButtons.svelte`, Windows): a
//! click the page receives itself (in the app the caption window of `platform.rs` performs
//! it) and whether the window is maximized (Maximieren then shows Verkleinern). Closing goes
//! the usual way: a close request, so unsaved changes and a running fetch still ask.

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri passes command arguments by value"
)]

use jobalert_core::error::{ErrorInfo, ErrorKind};
use serde::Deserialize;
use tauri::WebviewWindow;

use super::CmdResult;

/// A caption button (`WindowButton` of `ui/src/lib/ipc/api.ts`).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowButton {
    Minimize,
    /// Maximizes the window, or restores a maximized one.
    Maximize,
    Close,
}

#[tauri::command]
pub fn window_button(window: WebviewWindow, button: WindowButton) -> CmdResult<()> {
    let done = match button {
        WindowButton::Minimize => window.minimize(),
        WindowButton::Maximize if window.is_maximized().unwrap_or(false) => window.unmaximize(),
        WindowButton::Maximize => window.maximize(),
        WindowButton::Close => window.close(),
    };
    done.map_err(|e| {
        log::warn!("window button {button:?}: {e}");
        ErrorInfo::new(ErrorKind::Internal)
    })
}

#[tauri::command]
pub fn window_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}
