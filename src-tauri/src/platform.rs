//! The only place in `src-tauri` with per-OS code (docs/PLAN.md, "Platforms").
//!
//! The app is a tool, not a browser: no browser context menu, no browser shortcuts
//! (reload, print, find, zoom, devtools), no pinch or swipe gestures, no autofill, no
//! navigation away from the app, no pop-up windows. Editing inside fields stays
//! (Ctrl/Cmd+C/V/X/A/Z). The same rules apply in every build, so exactly what ships is
//! what gets tested.
//!
//! The window has one top bar on both OS, drawn by the page like the Claude app's
//! (`ui/src/features/shell/TitleBar.svelte`, user 2026-09-27); below it the app is the same.
//! Only the window buttons differ: Windows has no native title bar (`decorations: false`; the
//! shadow, the rounded corners and the resize borders stay) and the page draws its caption
//! buttons, which [`caption`] turns into a native caption for the OS (moving, double click,
//! system menu, the snap layouts over Maximieren); macOS keeps its traffic lights, centred in
//! the bar. Further documented differences: WebView2 switches (Windows) vs. a minimal app
//! menu, link preview and first-mouse clicks (macOS), how a file is shown in its folder
//! (Explorer, Finder) and the user agent of the HTTP client. What differs inside the page
//! (the window buttons, dialog button order, scrollbars, OS words) lives in
//! `ui/src/lib/platform.ts`.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use jobalert_core::export::palette;
use jobalert_core::settings::{Language, Palette};
use tauri::webview::{NewWindowResponse, PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Manager, Runtime, Url, Webview, WebviewWindow, WebviewWindowBuilder};

/// Label of the app's own window (`tauri.conf.json`).
pub const MAIN: &str = "main";

// ------------------------------------------------------------------ window colours

// The colour of the window in the palette the user chose (Einstellungen, Darstellung): the
// window behind the page on both OS, the colour of the top bar and the sidebar. A token of
// `ui/src/styles/tokens.css`, read through the palette `tools/tokens.mjs` generates. A new
// colour is a change of tokens.css and `npm run regen` (docs/CHANGING.md); pointing the
// window at another token is a change here (`core/tests/ui_contract.rs` checks which one).

/// What the window wears in one palette.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowColours {
    /// `--bg`: the window before the page paints (the colour of the top bar and the sidebar).
    pub background: Rgb,
}

/// The window's colours in a palette.
pub const fn window_colours(chosen: Palette) -> WindowColours {
    match chosen {
        Palette::Light => WindowColours {
            background: palette::BG.rgb,
        },
        Palette::Dark => WindowColours {
            background: palette::DARK_BG.rgb,
        },
    }
}

/// A colour as red, green and blue bytes.
pub type Rgb = [u8; 3];

/// Dresses the window in a palette at once: its background before the page paints and the
/// system's light or dark frame (the macOS traffic lights; on Windows the system menu and the
/// window's edge). At the start before the window shows (the stored choice), then on every
/// choice in Einstellungen (`save_settings`).
pub fn dress<R: Runtime>(window: &WebviewWindow<R>, palette: Palette) {
    let colours = window_colours(palette);
    let [r, g, b] = colours.background;
    if let Err(e) = window.set_background_color(Some(tauri::window::Color(r, g, b, u8::MAX))) {
        log::warn!("window background not set: {e}");
    }
    let theme = if palette == Palette::Dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    };
    if let Err(e) = window.set_theme(Some(theme)) {
        log::warn!("window theme not set: {e}");
    }
}

// ------------------------------------------------------------------ user agent

/// Current stable Edge on Windows (checked 2026-09-24: Edge stable 153.0.4234.48, the same
/// major version as the WebView2 runtime). Like Edge itself it names only the major version
/// (User-Agent Reduction).
const WINDOWS_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0";

/// Current Safari on macOS (checked 2026-09-24: Safari 27.0, released 2026-09-14). Safari
/// freezes the OS and `WebKit` parts of its user agent; only `Version/` moves.
const MACOS_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
    AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";

/// Oldest versions the constants above may name. When updating a user agent, raise its
/// minimum with it: a user agent that no current browser sends is what bot detection
/// reacts to.
const MIN_EDGE_MAJOR: u32 = 153;
const MIN_SAFARI_MAJOR: u32 = 27;

/// User agent of the HTTP client (`jobalert_core::fetch::http::HttpFetcher`): a real,
/// current browser of the OS the app runs on. Linux is no target; it gets the Windows value.
pub const USER_AGENT: &str = if cfg!(target_os = "macos") {
    MACOS_USER_AGENT
} else {
    WINDOWS_USER_AGENT
};

// Checked at compile time on every OS (the app binary has no test harness, see Cargo.toml):
// each constant names its OS, and neither is older than its minimum.
const _: () = {
    assert!(contains(
        WINDOWS_USER_AGENT,
        "(Windows NT 10.0; Win64; x64)"
    ));
    assert!(major_after(WINDOWS_USER_AGENT, "Chrome/") >= MIN_EDGE_MAJOR);
    assert!(major_after(WINDOWS_USER_AGENT, "Edg/") == major_after(WINDOWS_USER_AGENT, "Chrome/"));
    assert!(contains(
        MACOS_USER_AGENT,
        "(Macintosh; Intel Mac OS X 10_15_7)"
    ));
    assert!(major_after(MACOS_USER_AGENT, "Version/") >= MIN_SAFARI_MAJOR);
    assert!(contains(MACOS_USER_AGENT, "Safari/605.1.15"));
    #[cfg(windows)]
    assert!(contains(USER_AGENT, "Windows NT"));
    #[cfg(target_os = "macos")]
    assert!(contains(USER_AGENT, "Macintosh"));
};

/// Byte offset of `needle` in `haystack` (`usize::MAX` if absent). `const` so that the user
/// agent checks above run in every build.
const fn find(haystack: &str, needle: &str) -> usize {
    let (h, n) = (haystack.as_bytes(), needle.as_bytes());
    let mut start = 0;
    while start + n.len() <= h.len() {
        let mut i = 0;
        while i < n.len() && h[start + i] == n[i] {
            i += 1;
        }
        if i == n.len() {
            return start;
        }
        start += 1;
    }
    usize::MAX
}

const fn contains(haystack: &str, needle: &str) -> bool {
    find(haystack, needle) != usize::MAX
}

/// The number right after `marker` (`0` if the marker is missing).
const fn major_after(haystack: &str, marker: &str) -> u32 {
    let at = find(haystack, marker);
    if at == usize::MAX {
        return 0;
    }
    let bytes = haystack.as_bytes();
    let mut i = at + marker.len();
    let mut major = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        major = major * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }
    major
}

// ------------------------------------------------------------------ language

/// The language of the OS (macOS: the first of Language & Region), German only when it is
/// German. The macOS menu and the startup dialog follow it, as the OS's own menus and
/// dialogs do; the app's own language starts German (`Language::DEFAULT`) until the user
/// picks one.
pub fn system_language() -> Language {
    Language::from_locale(sys_locale::get_locale().as_deref())
}

// ------------------------------------------------------------------ app

/// App-wide options: the first page load reveals the main window; on macOS a minimal menu
/// replaces Tauri's default one.
pub fn app<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let builder = builder.on_page_load(on_page_load);
    #[cfg(target_os = "macos")]
    let builder = builder
        .enable_macos_default_menu(false)
        .menu(macos::menu)
        .on_menu_event(macos::on_menu_event);
    builder
}

// ------------------------------------------------------------------ main window

/// Options of the main window before it is built.
///
/// File drops: Tauri's drag-drop handler stays on (`dragDropEnabled` in `tauri.conf.json`).
/// It takes every drop away from the web view, which would otherwise open the file in place
/// of the app, and reports it as an event nobody listens to - the drop is swallowed.
pub fn harden<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    config: &tauri::Config,
) -> WebviewWindowBuilder<'a, R, M> {
    let origins = AppOrigins::new(config);
    let builder = builder
        // Release builds never offer the inspector; debug builds keep it for `--devtools`.
        .devtools(cfg!(debug_assertions))
        .zoom_hotkeys_enabled(false)
        .general_autofill_enabled(false)
        .on_navigation(move |url| {
            let own = origins.allows(url);
            if !own {
                // Scheme and host only: a full URL could carry personal data into the log.
                log::warn!(
                    "navigation blocked: {}://{}",
                    url.scheme(),
                    url.host_str().unwrap_or_default()
                );
            }
            own
        })
        .on_new_window(|url, _features| {
            log::warn!(
                "new window blocked: {}://{}",
                url.scheme(),
                url.host_str().unwrap_or_default()
            );
            NewWindowResponse::Deny
        });
    // A click into the inactive window acts at once (as on Windows); a force click on a
    // link shows no preview.
    #[cfg(target_os = "macos")]
    let builder = builder.accept_first_mouse(true).allow_link_preview(false);
    builder
}

/// Settings that exist only on the built web view.
///
/// macOS (`WKWebView`) has no counterpart and needs none: it binds neither reload, print,
/// find nor the inspector to keys, the minimal app menu adds no such items, and the UI
/// blocks the context menu in JavaScript on both OS.
#[cfg(windows)]
pub fn apply<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    use tauri::Emitter as _;

    // The page's top bar answers the OS like a native caption.
    caption::attach(window);
    // Maximieren shows Verkleinern while the window is maximized (`window-state`,
    // `ui/src/lib/ipc/api.ts` `onWindowState`).
    let watched = window.clone();
    let maximized = AtomicBool::new(window.is_maximized().unwrap_or(false));
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Resized(_) = event {
            let now = watched.is_maximized().unwrap_or(false);
            if maximized.swap(now, Ordering::SeqCst) != now
                && let Err(e) = watched.emit(WINDOW_STATE, serde_json::json!({ "maximized": now }))
            {
                log::warn!("window state not sent to the page: {e}");
            }
        }
    });
    window.with_webview(|webview| {
        if let Err(error) = webview2::disable_browser_features(&webview.controller()) {
            log::warn!("WebView2 settings not applied: {error}");
        }
    })
}

/// The event that tells the page whether the window is maximized.
#[cfg(windows)]
const WINDOW_STATE: &str = "window-state";

/// macOS: the traffic lights of the unified title bar sit where `trafficLightPosition` says
/// (centred in the page's top bar), and stay there whenever macOS lays the title bar out
/// again: on resize (fullscreen exit and zoom included), focus, theme and scale changes, and
/// once the window is shown ([`reveal`]).
#[cfg(target_os = "macos")]
#[allow(
    clippy::unnecessary_wraps,
    reason = "same signature as the Windows variant"
)]
pub fn apply<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    lights::place(window);
    let watched = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Focused(_)
                | tauri::WindowEvent::ThemeChanged(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            lights::place(&watched);
        }
    });
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
#[allow(
    clippy::unnecessary_wraps,
    reason = "same signature as the Windows variant"
)]
pub fn apply<R: Runtime>(_window: &WebviewWindow<R>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(windows)]
mod webview2 {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, ICoreWebView2Settings3, ICoreWebView2Settings4,
        ICoreWebView2Settings5, ICoreWebView2Settings6,
    };
    use windows_core::Interface as _;

    /// One of the app's few `unsafe` spots (the others are the caption of the Windows top
    /// bar and the macOS traffic lights): Tauri does not pass these WebView2 switches
    /// through, so they are set on WebView2 directly.
    #[expect(
        unsafe_code,
        reason = "WebView2 switches that Tauri does not pass through"
    )]
    pub fn disable_browser_features(
        controller: &ICoreWebView2Controller,
    ) -> windows_core::Result<()> {
        // SAFETY: `with_webview` calls us on the UI thread with this window's valid
        // controller; these are plain COM setters without pointers from Rust.
        unsafe {
            let settings = controller.CoreWebView2()?.Settings()?;
            // Back, reload, print, inspect ...
            settings.SetAreDefaultContextMenusEnabled(false)?;
            // The URL bubble in the bottom corner while hovering a link.
            settings.SetIsStatusBarEnabled(false)?;
            // F5/Ctrl+R, Ctrl+P, Ctrl+F, F12, Ctrl+Shift+I ...
            settings
                .cast::<ICoreWebView2Settings3>()?
                .SetAreBrowserAcceleratorKeysEnabled(false)?;
            let settings4 = settings.cast::<ICoreWebView2Settings4>()?;
            settings4.SetIsPasswordAutosaveEnabled(false)?;
            settings4.SetIsGeneralAutofillEnabled(false)?;
            settings
                .cast::<ICoreWebView2Settings5>()?
                .SetIsPinchZoomEnabled(false)?;
            settings
                .cast::<ICoreWebView2Settings6>()?
                .SetIsSwipeNavigationEnabled(false)
        }
    }
}

/// The page's top bar as the OS sees it (Windows). The window has no native title bar; the
/// page draws the bar and its caption buttons (`ui/src/components/WindowButtons.svelte`). The
/// web view's windows belong to the engine's own processes, so a window of ours lies over the
/// bar (`CXactCaption`: without a surface of its own, the page shows through it)
/// and answers `WM_NCHITTEST` like a native caption, by the geometry of
/// [`jobalert_core::window::Bar`]: the empty bar is `HTCAPTION` (moving, Aero Snap, a double
/// click maximizes; a right click opens the system menu, `system_menu`), the top edge of a window that is
/// not maximized `HTTOP`, and the buttons `HTMINBUTTON`, `HTMAXBUTTON` and `HTCLOSE` - only
/// such an answer opens the snap layouts of Windows 11 over Maximieren. It hands the
/// caption's mouse messages to the main window, whose default procedure moves, sizes and
/// opens the menu (the main window answers `WM_NCHITTEST` for the bar the same way, for the
/// hit test of the menu); it performs a click on a button itself (`WM_SYSCOMMAND`, so
/// Schließen is a normal close request: unsaved changes and a running fetch still ask) and
/// reports which button the pointer is over and which one is pressed (`caption`), which the
/// page shows. Where the page draws its own buttons in the bar (`Bar::tools`: the sidebar,
/// Zurück and Vor at the left, the reader before the caption buttons) the window leaves a
/// hole, and the page takes the pointer there. It follows the window's size and DPI; Tauri's
/// strip that sizes the window at its top edge stays above it.
#[cfg(windows)]
pub mod caption {
    #![expect(
        unsafe_code,
        reason = "the window procedure of the top bar: Win32 calls that Tauri does not make"
    )]

    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Mutex, OnceLock, PoisonError};

    use jobalert_core::window::{Bar, BarHit};
    use tauri::{Emitter as _, Runtime, WebviewWindow};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, RGN_DIFF, ScreenToClient, SetWindowRgn,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT, TrackMouseEvent,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, EnableMenuItem, FindWindowExW, GetClientRect, GetParent,
        GetSystemMenu, HTCAPTION, HTCLOSE, HTMAXBUTTON, HTMINBUTTON, HTTOP, HTTRANSPARENT,
        HWND_TOP, IDC_ARROW, IsZoomed, LoadCursorW, MF_BYCOMMAND, MF_ENABLED, MF_GRAYED,
        PostMessageW, RegisterClassExW, SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE,
        SC_SIZE, SM_CYFRAME, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SendMessageW, SetWindowPos,
        TPM_RETURNCMD, TPM_RIGHTBUTTON, TrackPopupMenu, WM_DPICHANGED, WM_NCHITTEST,
        WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_NCMOUSEMOVE,
        WM_NCRBUTTONDBLCLK, WM_NCRBUTTONDOWN, WM_NCRBUTTONUP, WM_SIZE, WM_SYSCOMMAND, WNDCLASSEXW,
        WS_CHILD, WS_CLIPSIBLINGS, WS_EX_NOREDIRECTIONBITMAP, WS_VISIBLE,
    };
    use windows::core::{PCWSTR, w};

    /// The class of the window over the bar.
    const CLASS: PCWSTR = w!("CXactCaption");
    /// Tauri's strip at the top edge that sizes an undecorated window
    /// (`tauri-runtime-wry`, `undecorated_resizing.rs`).
    const TAURI_EDGE: PCWSTR = w!("TAURI_DRAG_RESIZE_BORDERS");
    /// Our subclass of the main window's procedure.
    const SUBCLASS_ID: usize = 0x4358_4254; // "CXBT"
    /// The event that tells the page the state of the buttons (`ui/src/lib/ipc/api.ts`,
    /// `onCaption`).
    const EVENT: &str = "caption";

    /// A caption button of the bar.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Button {
        Minimize,
        Maximize,
        Close,
    }

    impl Button {
        /// Its name in the page (`WindowButton` of `ui/src/lib/ipc/api.ts`).
        pub const fn name(self) -> &'static str {
            match self {
                Button::Minimize => "minimize",
                Button::Maximize => "maximize",
                Button::Close => "close",
            }
        }

        /// The button of a hit-test code.
        fn of(code: u32) -> Option<Button> {
            match code {
                HTMINBUTTON => Some(Button::Minimize),
                HTMAXBUTTON => Some(Button::Maximize),
                HTCLOSE => Some(Button::Close),
                _ => None,
            }
        }
    }

    /// What the buttons show: the one under the pointer and the one pressed.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct Shown {
        hover: Option<Button>,
        pressed: Option<Button>,
    }

    const AT_REST: Shown = Shown {
        hover: None,
        pressed: None,
    };

    static SHOWN: Mutex<Shown> = Mutex::new(AT_REST);
    /// `TrackMouseEvent` is asked once per stay over the bar.
    static TRACKING: AtomicBool = AtomicBool::new(false);
    /// Sends the state of the buttons to the page.
    static REPORT: OnceLock<Box<dyn Fn(Shown) + Send + Sync>> = OnceLock::new();

    /// Lays the window over the bar of the main window.
    pub fn attach<R: Runtime>(window: &WebviewWindow<R>) {
        let Ok(parent) = window.hwnd() else {
            return;
        };
        let page = window.clone();
        let _ = REPORT.set(Box::new(move |shown: Shown| {
            let payload = serde_json::json!({
                "hover": shown.hover.map(Button::name),
                "pressed": shown.pressed.map(Button::name),
            });
            if let Err(e) = page.emit(EVENT, payload) {
                log::warn!("caption state not sent to the page: {e}");
            }
        }));
        match create(parent) {
            Ok(()) => log::info!("top bar: the caption window answers for it"),
            Err(e) => log::warn!("top bar: no caption window ({e}); the page's bar stays"),
        }
    }

    fn create(parent: HWND) -> windows::core::Result<()> {
        // SAFETY: plain Win32 calls on the live main window (Tauri's, on the main thread,
        // where `apply` runs); the class names are static wide strings; the window procedures
        // below only read their arguments and the main window's state.
        unsafe {
            let module = GetModuleHandleW(PCWSTR::null())?;
            let instance = HINSTANCE(module.0);
            let class = WNDCLASSEXW {
                cbSize: u32::try_from(size_of::<WNDCLASSEXW>()).unwrap_or_default(),
                lpfnWndProc: Some(bar_proc),
                hInstance: instance,
                hCursor: LoadCursorW(None, IDC_ARROW)?,
                lpszClassName: CLASS,
                ..WNDCLASSEXW::default()
            };
            // Registered once per process: a second main window never exists.
            let _ = RegisterClassExW(&raw const class);
            // Without a surface of its own it takes the pointer and draws nothing: the page shows
            // through it. (A layered child window would need the app manifest to name Windows 8.)
            let bar = CreateWindowExW(
                WS_EX_NOREDIRECTIONBITMAP,
                CLASS,
                PCWSTR::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                0,
                0,
                0,
                0,
                Some(parent),
                None,
                Some(instance),
                None,
            )?;
            place(parent, bar);
            if !SetWindowSubclass(
                parent,
                Some(main_proc),
                SUBCLASS_ID,
                bar.0.expose_provenance(),
            )
            .as_bool()
            {
                return Err(windows::core::Error::from_win32());
            }
            Ok(())
        }
    }

    /// The bar of the main window as the OS measures it now.
    unsafe fn bar_of(parent: HWND) -> Option<Bar> {
        let mut client = RECT::default();
        // SAFETY: `parent` is the live main window, `client` a RECT on this stack frame.
        unsafe { GetClientRect(parent, &raw mut client) }.ok()?;
        // SAFETY: plain queries of the live main window.
        let (dpi, maximized) = unsafe { (GetDpiForWindow(parent), IsZoomed(parent).as_bool()) };
        let edge = if maximized {
            0
        } else {
            // SAFETY: a plain system metric.
            unsafe { GetSystemMetricsForDpi(SM_CYFRAME, dpi) }
        };
        Some(Bar {
            width: client.right - client.left,
            dpi,
            edge,
        })
    }

    /// What the screen point `at` is on the main window's bar.
    unsafe fn hit_at(parent: HWND, at: POINT) -> BarHit {
        let mut local = at;
        // SAFETY: `local` is a POINT on this stack frame.
        if !unsafe { ScreenToClient(parent, &raw mut local) }.as_bool() {
            return BarHit::Page;
        }
        // SAFETY: see `bar_of`.
        unsafe { bar_of(parent) }.map_or(BarHit::Page, |bar| bar.hit(local.x, local.y))
    }

    /// The hit-test code of a point of the bar (`None`: the page's, or the frame's).
    fn code(hit: BarHit) -> Option<u32> {
        match hit {
            BarHit::Page => None,
            BarHit::Caption => Some(HTCAPTION),
            BarHit::TopEdge => Some(HTTOP),
            BarHit::Minimize => Some(HTMINBUTTON),
            BarHit::Maximize => Some(HTMAXBUTTON),
            BarHit::Close => Some(HTCLOSE),
        }
    }

    fn answer(code: u32) -> LRESULT {
        LRESULT(isize::try_from(code).unwrap_or_default())
    }

    /// The screen point of a mouse message (`GET_X_LPARAM`, `GET_Y_LPARAM`).
    fn point(lparam: LPARAM) -> POINT {
        let word = |shift: u32| {
            let bits = u16::try_from((lparam.0 >> shift) & 0xFFFF).unwrap_or_default();
            i32::from(bits.cast_signed())
        };
        POINT {
            x: word(0),
            y: word(16),
        }
    }

    /// Over the bar, right under Tauri's top edge strip (which puts itself on top at every
    /// size change) and above the web view; as wide as the window, as high as the bar, but
    /// for the page's own buttons (`leave_tools`).
    unsafe fn place(parent: HWND, bar: HWND) {
        // SAFETY: see `bar_of`.
        let Some(measure) = (unsafe { bar_of(parent) }) else {
            return;
        };
        // SAFETY: a plain lookup among the main window's children.
        let above = unsafe { FindWindowExW(Some(parent), None, TAURI_EDGE, PCWSTR::null()) }
            .unwrap_or(HWND_TOP);
        // SAFETY: both windows are live children of the main window.
        let _ = unsafe {
            SetWindowPos(
                bar,
                Some(above),
                0,
                0,
                measure.width,
                measure.height(),
                SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            )
        };
        // SAFETY: `bar` is our live child window.
        unsafe { leave_tools(bar, &measure) };
    }

    /// Leaves the page's own buttons in the bar ([`Bar::tools`]) to the page: the window over
    /// the bar takes the pointer everywhere else (its region), and there the pointer reaches the
    /// web view, which lies in the engine's processes (`HTTRANSPARENT` only passes it on to
    /// windows of this thread). Below the top resize edge only, like [`Bar::hit`].
    unsafe fn leave_tools(bar: HWND, measure: &Bar) {
        let height = measure.height();
        // SAFETY: regions created here; the one given to the window belongs to the system from
        // then on, every other one is deleted.
        unsafe {
            let region = CreateRectRgn(0, 0, measure.width, height);
            if region.is_invalid() {
                return;
            }
            for zone in measure.tools() {
                let cut = CreateRectRgn(zone.start, measure.edge, zone.end, height);
                if !cut.is_invalid() {
                    let _ = CombineRgn(Some(region), Some(region), Some(cut), RGN_DIFF);
                    let _ = DeleteObject(cut.into());
                }
            }
            // Nothing to redraw: the window has no surface of its own.
            if SetWindowRgn(bar, Some(region), false) == 0 {
                let _ = DeleteObject(region.into());
            }
        }
    }

    /// Changes what the buttons show and tells the page when it changed.
    fn show(change: impl FnOnce(&mut Shown)) {
        let now = {
            let mut shown = SHOWN.lock().unwrap_or_else(PoisonError::into_inner);
            let before = *shown;
            change(&mut shown);
            if *shown == before {
                return;
            }
            *shown
        };
        if let Some(report) = REPORT.get() {
            report(now);
        }
    }

    fn pressed() -> Option<Button> {
        SHOWN.lock().unwrap_or_else(PoisonError::into_inner).pressed
    }

    /// Asks for `WM_NCMOUSELEAVE` once the pointer leaves the bar.
    unsafe fn track(bar: HWND) {
        if TRACKING.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut request = TRACKMOUSEEVENT {
            cbSize: u32::try_from(size_of::<TRACKMOUSEEVENT>()).unwrap_or_default(),
            dwFlags: TME_LEAVE | TME_NONCLIENT,
            hwndTrack: bar,
            dwHoverTime: 0,
        };
        // SAFETY: `request` is a TRACKMOUSEEVENT on this stack frame, sized as required.
        if unsafe { TrackMouseEvent(&raw mut request) }.is_err() {
            TRACKING.store(false, Ordering::SeqCst);
        }
    }

    /// A click on a button, the way the native one does it.
    unsafe fn click(parent: HWND, button: Button) {
        let command = match button {
            Button::Minimize => SC_MINIMIZE,
            // SAFETY: a plain query of the live main window.
            Button::Maximize if unsafe { IsZoomed(parent) }.as_bool() => SC_RESTORE,
            Button::Maximize => SC_MAXIMIZE,
            Button::Close => SC_CLOSE,
        };
        // SAFETY: a message to the live main window, handled after this one.
        let sent = unsafe {
            PostMessageW(
                Some(parent),
                WM_SYSCOMMAND,
                WPARAM(usize::try_from(command).unwrap_or_default()),
                LPARAM(0),
            )
        };
        if let Err(e) = sent {
            log::warn!("{} not sent to the window: {e}", button.name());
        }
    }

    /// The window's system menu at `at` (screen pixels), its entries in the window's state
    /// (Wiederherstellen only while maximized, Verschieben and Größe ändern only while not), the
    /// chosen one performed like the menu of a native caption.
    unsafe fn system_menu(parent: HWND, at: POINT) {
        // SAFETY: the menu of the live main window, shown modally on its thread (ours).
        unsafe {
            let menu = GetSystemMenu(parent, false);
            if menu.is_invalid() {
                return;
            }
            let maximized = IsZoomed(parent).as_bool();
            for (item, on) in [
                (SC_RESTORE, maximized),
                (SC_MOVE, !maximized),
                (SC_SIZE, !maximized),
                (SC_MINIMIZE, true),
                (SC_MAXIMIZE, !maximized),
                (SC_CLOSE, true),
            ] {
                let state = if on { MF_ENABLED } else { MF_GRAYED };
                let _ = EnableMenuItem(menu, item, MF_BYCOMMAND | state);
            }
            let chosen = TrackPopupMenu(
                menu,
                TPM_RETURNCMD | TPM_RIGHTBUTTON,
                at.x,
                at.y,
                None,
                parent,
                None,
            );
            if let Ok(command) = usize::try_from(chosen.0)
                && command != 0
            {
                let _ = PostMessageW(Some(parent), WM_SYSCOMMAND, WPARAM(command), LPARAM(0));
            }
        }
    }

    /// The window over the bar.
    unsafe extern "system" fn bar_proc(
        bar: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        // SAFETY: `bar` is our live child window; its parent is the main window.
        let Ok(parent) = (unsafe { GetParent(bar) }) else {
            // SAFETY: the default for a window without a parent (never: it is a child).
            return unsafe { DefWindowProcW(bar, message, wparam, lparam) };
        };
        // The hit-test code the OS gives the mouse messages of the non-client area.
        let hit = u32::try_from(wparam.0).unwrap_or_default();
        // SAFETY: `parent` is the live main window; the messages handed on to it are the
        // ones it gets over a native caption, with the same parameters.
        let hand_on = || unsafe { SendMessageW(parent, message, Some(wparam), Some(lparam)) };
        match message {
            WM_NCHITTEST => {
                // SAFETY: see `hit_at`.
                let at = unsafe { hit_at(parent, point(lparam)) };
                return code(at).map_or(
                    LRESULT(isize::try_from(HTTRANSPARENT).unwrap_or(-1)),
                    answer,
                );
            }
            WM_NCMOUSEMOVE => {
                // SAFETY: see `track`.
                unsafe { track(bar) };
                let button = Button::of(hit);
                show(|shown| shown.hover = button);
                if button.is_none() {
                    return hand_on();
                }
                return LRESULT(0);
            }
            WM_NCMOUSELEAVE => {
                TRACKING.store(false, Ordering::SeqCst);
                show(|shown| *shown = AT_REST);
                return LRESULT(0);
            }
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
                let Some(button) = Button::of(hit) else {
                    return hand_on();
                };
                show(|shown| {
                    shown.hover = Some(button);
                    shown.pressed = Some(button);
                });
                return LRESULT(0);
            }
            WM_NCLBUTTONUP => {
                let Some(button) = Button::of(hit) else {
                    show(|shown| shown.pressed = None);
                    return hand_on();
                };
                let was = pressed();
                show(|shown| shown.pressed = None);
                // A click needs the press and the release on the same button.
                if was == Some(button) {
                    // SAFETY: see `click`.
                    unsafe { click(parent, button) };
                }
                return LRESULT(0);
            }
            // A right click on the empty bar opens the window's system menu, like on a native
            // caption (the default procedure opens none for a window without a title bar).
            // Alt+Space opens it the native way.
            WM_NCRBUTTONUP if hit == HTCAPTION => {
                // SAFETY: see `system_menu`.
                unsafe { system_menu(parent, point(lparam)) };
                return LRESULT(0);
            }
            WM_NCRBUTTONDOWN | WM_NCRBUTTONDBLCLK | WM_NCRBUTTONUP => return LRESULT(0),
            _ => {}
        }
        // SAFETY: the default procedure for everything else.
        unsafe { DefWindowProcW(bar, message, wparam, lparam) }
    }

    /// The main window: it answers `WM_NCHITTEST` for the bar like the window over it (the
    /// system menu's hit test asks the main window), and lays that window anew after every
    /// change of size or DPI.
    unsafe extern "system" fn main_proc(
        parent: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        bar: usize,
    ) -> LRESULT {
        match message {
            WM_NCHITTEST => {
                // SAFETY: see `hit_at`.
                if let Some(found) = code(unsafe { hit_at(parent, point(lparam)) }) {
                    return answer(found);
                }
            }
            WM_SIZE | WM_DPICHANGED => {
                // SAFETY: the next procedure of the chain first (tao, Tauri's strip).
                let result = unsafe { DefSubclassProc(parent, message, wparam, lparam) };
                let bar = HWND(std::ptr::with_exposed_provenance_mut(bar));
                // SAFETY: `bar` is our live child window (its handle is the subclass data).
                unsafe { place(parent, bar) };
                // Maximized, minimized or restored: the buttons at rest.
                show(|shown| *shown = AT_REST);
                return result;
            }
            _ => {}
        }
        // SAFETY: the next procedure of the chain.
        unsafe { DefSubclassProc(parent, message, wparam, lparam) }
    }

    /// What the window over the bar answers, measured in the running app (the smoke check
    /// prints it): the hit-test code of the window over the bar and of the main window in
    /// the middle of Maximieren, the code that opens the snap layouts there, the size of
    /// the window over the bar next to the bar's (physical pixels), and the spots at the edges
    /// of the page's own buttons in the bar.
    #[cfg(debug_assertions)]
    #[derive(Debug)]
    pub struct Probe {
        pub bar_hit: Option<u32>,
        pub main_hit: Option<u32>,
        pub maximize: u32,
        pub covers: [i32; 2],
        pub bar: [i32; 2],
        pub tools: Vec<Spot>,
    }

    /// A spot of the bar at an edge of the page's own buttons, in the middle of its height.
    #[cfg(debug_assertions)]
    #[derive(Debug)]
    pub struct Spot {
        /// Client pixels of the main window.
        pub at: [i32; 2],
        /// The page takes the pointer here.
        pub page: bool,
        /// The answer the window over the bar owes here: `HTTRANSPARENT` (-1) on the page's
        /// buttons, `HTCAPTION` or `HTMINBUTTON` beside them.
        pub wants: isize,
        /// Its answer.
        pub hit: isize,
        /// Its region holds the spot.
        pub covered: bool,
    }

    #[cfg(debug_assertions)]
    impl Spot {
        /// The page's spots lie in the window's hole, the others under it with their answer.
        pub fn holds(&self) -> bool {
            self.hit == self.wants && self.covered != self.page
        }
    }

    #[cfg(debug_assertions)]
    pub fn probe<R: Runtime>(window: &WebviewWindow<R>) -> Option<Probe> {
        use jobalert_core::window::CAPTION_BUTTON;
        use windows::Win32::Graphics::Gdi::{ClientToScreen, GetWindowRgn, PtInRegion, RGN_ERROR};

        let parent = window.hwnd().ok()?;
        // SAFETY: plain queries and hit-test messages to our own live windows; the region
        // created here is deleted before the return.
        unsafe {
            let bar = FindWindowExW(Some(parent), None, CLASS, PCWSTR::null()).ok()?;
            let measure = bar_of(parent)?;
            let asked = |target: HWND, x: i32, y: i32| -> Option<isize> {
                let mut at = POINT { x, y };
                if !ClientToScreen(parent, &raw mut at).as_bool() {
                    return None;
                }
                let pack = |value: i32| {
                    let word = i16::try_from(value).unwrap_or_default().cast_unsigned();
                    isize::try_from(u32::from(word)).unwrap_or_default()
                };
                let lparam = LPARAM(pack(at.x) | (pack(at.y) << 16));
                Some(SendMessageW(target, WM_NCHITTEST, None, Some(lparam)).0)
            };
            let middle = measure.height() / 2;
            let maximize_at = measure.width - measure.scaled(CAPTION_BUTTON + CAPTION_BUTTON / 2);
            let over_maximize = |target: HWND| {
                asked(target, maximize_at, middle).and_then(|answer| u32::try_from(answer).ok())
            };
            let mut covers = RECT::default();
            GetClientRect(bar, &raw mut covers).ok()?;
            // The window's region: none set means the whole window.
            let region = CreateRectRgn(0, 0, 0, 0);
            let shaped = !region.is_invalid() && GetWindowRgn(bar, region) != RGN_ERROR;
            let covered = |x: i32| !shaped || PtInRegion(region, x, middle).as_bool();
            let transparent = isize::try_from(HTTRANSPARENT).unwrap_or(-1);
            let caption = isize::try_from(HTCAPTION).unwrap_or_default();
            let minimize = isize::try_from(HTMINBUTTON).unwrap_or_default();
            let [left, right] = measure.tools();
            let spots = [
                (left.start, true, transparent),
                (left.end - 1, true, transparent),
                (left.end, false, caption),
                (right.start - 1, false, caption),
                (right.start, true, transparent),
                (right.end - 1, true, transparent),
                (right.end, false, minimize),
            ];
            let tools = spots
                .into_iter()
                .map(|(x, page, wants)| Spot {
                    at: [x, middle],
                    page,
                    wants,
                    hit: asked(bar, x, middle).unwrap_or(0),
                    covered: covered(x),
                })
                .collect();
            if !region.is_invalid() {
                let _ = DeleteObject(region.into());
            }
            Some(Probe {
                bar_hit: over_maximize(bar),
                main_hit: over_maximize(parent),
                maximize: HTMAXBUTTON,
                covers: [covers.right, covers.bottom],
                bar: [measure.width, measure.height()],
                tools,
            })
        }
    }
}
// ------------------------------------------------------------------ traffic lights (macOS)

/// The traffic lights of the unified title bar, placed exactly like tao's
/// `inset_traffic_lights` (tao 0.35, `platform_impl/macos/view.rs`). tao applies
/// `trafficLightPosition` only while its content view draws, which the web view covering
/// that view never lets happen: the lights stayed at the default place. Here the same
/// geometry is applied after every event that lets macOS lay the title bar out again.
///
/// The position is read from the main window's configuration (`tauri.macos.conf.json`, the
/// single source); `core/tests/ui_contract.rs` ties it to the page's top bar (`--titlebar-height`).
#[cfg(target_os = "macos")]
pub mod lights {
    use dispatch2::DispatchQueue;
    use objc2::MainThreadMarker;
    use objc2::rc::Retained;
    use objc2_app_kit::{NSButton, NSWindow, NSWindowButton, NSWindowStyleMask};
    use objc2_foundation::NSPoint;
    use tauri::{Manager as _, Runtime, WebviewWindow};

    /// `trafficLightPosition` of the main window: where the close button starts, in points
    /// from the window's top-left corner.
    fn position<R: Runtime>(window: &WebviewWindow<R>) -> Option<(f64, f64)> {
        let config = window.app_handle().config();
        let main = config.app.windows.iter().find(|w| w.label == super::MAIN)?;
        let at = main.traffic_light_position.as_ref()?;
        Some((at.x, at.y))
    }

    /// Places the lights now (on the main thread) and once more from the main queue, after
    /// the system's own title bar layout of this turn of the run loop.
    pub fn place<R: Runtime>(window: &WebviewWindow<R>) {
        let Some(at) = position(window) else {
            return;
        };
        if let Some(main) = MainThreadMarker::new() {
            let _ = with_window(window, main, |ns_window| inset(ns_window, at));
        }
        let later = window.clone();
        DispatchQueue::main().exec_async(move || {
            if let Some(main) = MainThreadMarker::new() {
                let _ = with_window(&later, main, |ns_window| inset(ns_window, at));
            }
        });
    }

    /// Runs `work` with the `NSWindow` behind Tauri's window. The marker proves the main
    /// thread, the only one where window objects may be touched.
    #[expect(
        unsafe_code,
        reason = "the NSWindow behind Tauri's window, to place the traffic lights"
    )]
    fn with_window<R: Runtime, T>(
        window: &WebviewWindow<R>,
        _main: MainThreadMarker,
        work: impl FnOnce(&NSWindow) -> T,
    ) -> Option<T> {
        let pointer = window.ns_window().ok()?;
        // SAFETY: Tauri hands out the pointer of the NSWindow it owns for this live window;
        // we are on the main thread (the marker), and the reference ends with this call.
        let ns_window = unsafe { pointer.cast::<NSWindow>().as_ref() }?;
        Some(work(ns_window))
    }

    fn buttons(window: &NSWindow) -> Option<[Retained<NSButton>; 3]> {
        Some([
            window.standardWindowButton(NSWindowButton::CloseButton)?,
            window.standardWindowButton(NSWindowButton::MiniaturizeButton)?,
            window.standardWindowButton(NSWindowButton::ZoomButton)?,
        ])
    }

    /// tao's geometry: the title bar container is as high as a button plus `y` and stays at
    /// the top of the window; the three buttons start at `x`, their spacing unchanged.
    #[expect(unsafe_code, reason = "the container view of the window buttons")]
    fn inset(window: &NSWindow, (x, y): (f64, f64)) {
        // In fullscreen the title bar lives in a window of its own above the screen.
        if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
            return;
        }
        let Some([close, minimize, zoom]) = buttons(window) else {
            return;
        };
        // SAFETY: the close button sits in the title bar view, which the window's frame view
        // holds while the window lives; the returned `Retained` keeps it alive for this call.
        let Some(bar) = (unsafe { close.superview() }) else {
            return;
        };
        // SAFETY: the same for the container around the title bar view.
        let Some(container) = (unsafe { bar.superview() }) else {
            return;
        };
        let close_frame = close.frame();
        let height = close_frame.size.height + y;
        let mut frame = container.frame();
        frame.size.height = height;
        frame.origin.y = window.frame().size.height - height;
        container.setFrame(frame);
        let spacing = minimize.frame().origin.x - close_frame.origin.x;
        for (step, button) in [0.0, 1.0, 2.0].into_iter().zip([close, minimize, zoom]) {
            let origin = NSPoint::new(x + step * spacing, button.frame().origin.y);
            button.setFrameOrigin(origin);
        }
    }

    /// Where the close button is on screen and where it should be (the smoke check prints
    /// it, so the macOS CI shows the position).
    #[cfg(debug_assertions)]
    pub struct Report {
        /// `trafficLightPosition` from the configuration.
        pub configured: Option<(f64, f64)>,
        /// The close button: x, y from the window's top edge, width, height (points).
        pub close: Option<[f64; 4]>,
        /// Height of the window frame (points).
        pub window_height: Option<f64>,
    }

    #[cfg(debug_assertions)]
    pub fn report<R: Runtime>(
        window: &WebviewWindow<R>,
        done: impl FnOnce(Report) + Send + 'static,
    ) {
        let configured = position(window);
        let target = window.clone();
        DispatchQueue::main().exec_async(move || {
            let measured = MainThreadMarker::new()
                .and_then(|main| with_window(&target, main, measure))
                .flatten();
            done(Report {
                configured,
                close: measured.map(|(close, _)| close),
                window_height: measured.map(|(_, height)| height),
            });
        });
    }

    /// The close button in window coordinates, turned into points from the top edge.
    #[cfg(debug_assertions)]
    fn measure(window: &NSWindow) -> Option<([f64; 4], f64)> {
        let close = window.standardWindowButton(NSWindowButton::CloseButton)?;
        let rect = close.convertRect_toView(close.bounds(), None);
        let height = window.frame().size.height;
        let top = height - (rect.origin.y + rect.size.height);
        Some((
            [rect.origin.x, top, rect.size.width, rect.size.height],
            height,
        ))
    }
}

// ------------------------------------------------------------------ first paint

/// If the first page load never reports back, the window still appears after this long -
/// a hidden window would otherwise hold the single-instance lock with nothing to close.
const REVEAL_FALLBACK: Duration = Duration::from_secs(8);

static REVEALED: AtomicBool = AtomicBool::new(false);
static MAXIMIZE_ON_REVEAL: AtomicBool = AtomicBool::new(false);

/// The main window is created hidden and appears once its first page has loaded: no white
/// flash on either OS (WebView2 also paints `backgroundColor`, `WKWebView` does not).
/// `maximized` is applied only then, because maximizing shows a window at once.
pub fn reveal_after_first_load<R: Runtime>(window: &WebviewWindow<R>, maximized: bool) {
    MAXIMIZE_ON_REVEAL.store(maximized, Ordering::SeqCst);
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_FALLBACK);
        if !REVEALED.load(Ordering::SeqCst) {
            log::warn!(
                "first page load did not finish within {REVEAL_FALLBACK:?}; showing the window"
            );
            reveal(&app);
        }
    });
}

fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Finished && webview.label() == MAIN {
        reveal(webview);
    }
}

/// Shows the main window exactly once.
fn reveal<R: Runtime, M: Manager<R>>(manager: &M) {
    let Some(window) = manager.get_webview_window(MAIN) else {
        return;
    };
    if REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }
    if MAXIMIZE_ON_REVEAL.load(Ordering::SeqCst) {
        let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(target_os = "macos")]
    lights::place(&window);
}

// ------------------------------------------------------------------ navigation guard

/// Where the main window may navigate: only the app's own origin - the embedded assets
/// (`tauri://localhost`, on Windows served as `http://tauri.localhost`) or, in a dev build
/// with `build.devUrl`, the dev server.
struct AppOrigins(Vec<Url>);

impl AppOrigins {
    fn new(config: &tauri::Config) -> AppOrigins {
        let mut origins: Vec<Url> = [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ]
        .iter()
        .filter_map(|url| Url::parse(url).ok())
        .collect();
        if tauri::is_dev()
            && let Some(dev) = &config.build.dev_url
        {
            origins.push(dev.clone());
        }
        AppOrigins(origins)
    }

    fn allows(&self, url: &Url) -> bool {
        // Compared by hand: `Url::origin` is opaque (never equal) for the `tauri` scheme.
        self.0.iter().any(|own| {
            own.scheme() == url.scheme()
                && own.host_str() == url.host_str()
                && own.port_or_known_default() == url.port_or_known_default()
        })
    }
}

// ------------------------------------------------------------------ portal sessions

/// How long deleting a session's storage may retry: after its window closes, the engine
/// still holds the files (WebView2) or the data store (`WKWebView`) for a moment.
const STORAGE_RELEASE: Duration = Duration::from_secs(6);
const STORAGE_STEP: Duration = Duration::from_millis(250);

/// Where a portal's session window keeps cookies and cache: its own profile folder
/// (WebView2 user data folder) on Windows, its own persistent data store on macOS, where
/// `WKWebView` has no folder option (`data_store_identifier` needs macOS 14, the minimum).
pub fn session_storage<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    portal_key: &str,
    profile: &Path,
) -> WebviewWindowBuilder<'a, R, M> {
    #[cfg(target_os = "macos")]
    {
        let _ = profile;
        builder.data_store_identifier(session_store_id(portal_key))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = portal_key;
        builder.data_directory(profile.to_path_buf())
    }
}

/// Deletes a portal's session storage once its window is closed. `true` only if it is
/// verifiably gone: the profile folder (all OS; older versions created it on macOS too)
/// and, on macOS, the data store.
pub async fn delete_session_storage<R: Runtime>(
    app: &AppHandle<R>,
    portal_key: &str,
    profile: &Path,
) -> bool {
    let mut folder_gone = false;
    let mut store_gone = !cfg!(target_os = "macos");
    for _ in 0..(STORAGE_RELEASE.as_millis() / STORAGE_STEP.as_millis()) {
        folder_gone = folder_gone
            || match std::fs::remove_dir_all(profile) {
                Ok(()) => true,
                Err(error) => error.kind() == std::io::ErrorKind::NotFound,
            };
        store_gone = store_gone || remove_data_store(app, portal_key).await;
        if folder_gone && store_gone {
            return true;
        }
        tokio::time::sleep(STORAGE_STEP).await;
    }
    log::warn!(
        "session storage of {portal_key} not deleted (folder gone: {folder_gone}, data store gone: {store_gone})"
    );
    false
}

/// macOS: removes the portal's data store and checks it is no longer listed.
#[cfg(target_os = "macos")]
async fn remove_data_store<R: Runtime>(app: &AppHandle<R>, portal_key: &str) -> bool {
    let id = session_store_id(portal_key);
    if let Err(error) = app.remove_data_store(id).await {
        log::debug!("data store of {portal_key} not removed yet: {error}");
    }
    app.fetch_data_store_identifiers()
        .await
        .is_ok_and(|ids| !ids.contains(&id))
}

#[cfg(not(target_os = "macos"))]
#[allow(clippy::unused_async, reason = "same signature as the macOS variant")]
async fn remove_data_store<R: Runtime>(_app: &AppHandle<R>, _portal_key: &str) -> bool {
    true
}

/// Stable data store identifier of a portal session (macOS): a UUID (version 8, RFC 9562)
/// from the 128-bit FNV-1a hash of the app id and the portal key. It must never change -
/// a new identifier would silently lose the user's sign-in.
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only macOS has data stores; checked at compile time"
    )
)]
const fn session_store_id(portal_key: &str) -> [u8; 16] {
    const PREFIX: &[u8] = b"de.cxecutives.job-alert-monitor/session/";
    const PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013B;
    let mut hash: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
    let mut i = 0;
    while i < PREFIX.len() + portal_key.len() {
        let byte = if i < PREFIX.len() {
            PREFIX[i]
        } else {
            portal_key.as_bytes()[i - PREFIX.len()]
        };
        hash = (hash ^ byte as u128).wrapping_mul(PRIME);
        i += 1;
    }
    let mut id = hash.to_be_bytes();
    id[6] = (id[6] & 0x0f) | 0x80;
    id[8] = (id[8] & 0x3f) | 0x80;
    id
}

// Golden values: the identifiers of existing sessions never change.
const _: () = {
    let freelance = session_store_id("freelance");
    assert!(freelance[0] == 0xde && freelance[1] == 0x11 && freelance[15] == 0xad);
    let freelancermap = session_store_id("freelancermap");
    assert!(freelancermap[0] == 0xa6 && freelancermap[15] == 0xa1);
    assert!(freelance[6] >> 4 == 8 && freelance[8] >> 6 == 0b10);
};

// ------------------------------------------------------------------ macOS menu

#[cfg(target_os = "macos")]
mod macos {
    use tauri::menu::{
        AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID,
    };
    use tauri::{AppHandle, Emitter as _, Manager as _, Runtime};

    /// Id of the app's own quit item (see [`on_menu_event`]).
    const QUIT_ID: &str = "quit";
    /// Id of the settings item: Cmd+, opens the Einstellungen view, like in every Mac app.
    const SETTINGS_ID: &str = "settings";
    /// The event that asks the page for a view (`ui/src/lib/ipc/api.ts`, `onNavigate`).
    const NAVIGATE: &str = "navigate";
    /// Id of Edit > Undo: the page takes back what Cmd+Z would, in a field the field's own
    /// edit and elsewhere the app's last list action (the standard item only reached the
    /// web view's editing undo).
    const UNDO_ID: &str = "undo";
    /// The event that asks the page to undo (`ui/src/lib/ipc/api.ts`, `onMenuUndo`).
    const MENU_UNDO: &str = "menu-undo";

    // User-facing text, German by product decision.
    const ABOUT: &str = "Über CXact";
    const SETTINGS: &str = "Einstellungen …";
    const HIDE: &str = "CXact ausblenden";
    const HIDE_OTHERS: &str = "Andere ausblenden";
    const QUIT: &str = "CXact beenden";
    const EDIT: &str = "Bearbeiten";
    const UNDO: &str = "Widerrufen";
    const REDO: &str = "Wiederholen";
    const CUT: &str = "Ausschneiden";
    const COPY: &str = "Kopieren";
    const PASTE: &str = "Einfügen";
    const SELECT_ALL: &str = "Alles auswählen";
    const WINDOW: &str = "Fenster";
    const MINIMIZE: &str = "Im Dock ablegen";
    const CLOSE_WINDOW: &str = "Fenster schließen";
    // end of user-facing text

    /// The menu on an English (any non-German) Mac, in the words of macOS.
    mod en {
        // User-facing text, English.
        pub(super) const ABOUT: &str = "About CXact";
        pub(super) const SETTINGS: &str = "Settings…";
        pub(super) const HIDE: &str = "Hide CXact";
        pub(super) const HIDE_OTHERS: &str = "Hide Others";
        pub(super) const QUIT: &str = "Quit CXact";
        pub(super) const EDIT: &str = "Edit";
        pub(super) const UNDO: &str = "Undo";
        pub(super) const REDO: &str = "Redo";
        pub(super) const CUT: &str = "Cut";
        pub(super) const COPY: &str = "Copy";
        pub(super) const PASTE: &str = "Paste";
        pub(super) const SELECT_ALL: &str = "Select All";
        pub(super) const WINDOW: &str = "Window";
        pub(super) const MINIMIZE: &str = "Minimize";
        pub(super) const CLOSE_WINDOW: &str = "Close Window";
        // end of user-facing text
    }

    /// Minimal app menu instead of Tauri's default (no reload or zoom, no Help, no
    /// Services). It carries the system shortcuts the app keeps: Cmd+, (settings), Cmd+Q,
    /// Cmd+H, Cmd+M, Cmd+W, and Cmd+C/V/X/A/Z, which `WKWebView` only receives through an
    /// Edit menu. Like the menus of every Mac app it speaks the language of the OS and uses
    /// its words (it is built before the app's own setting is read; the page follows that
    /// setting).
    pub fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
        let english = super::system_language() == super::Language::En;
        let w = |german: &'static str, english_word: &'static str| {
            if english { english_word } else { german }
        };
        let info = app.package_info();
        let about = AboutMetadata {
            name: Some(info.name.clone()),
            version: Some(info.version.to_string()),
            ..AboutMetadata::default()
        };
        let app_menu = Submenu::with_items(
            app,
            &info.name,
            true,
            &[
                &PredefinedMenuItem::about(app, Some(w(ABOUT, en::ABOUT)), Some(about))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(
                    app,
                    SETTINGS_ID,
                    w(SETTINGS, en::SETTINGS),
                    true,
                    Some("CmdOrCtrl+,"),
                )?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, Some(w(HIDE, en::HIDE)))?,
                &PredefinedMenuItem::hide_others(app, Some(w(HIDE_OTHERS, en::HIDE_OTHERS)))?,
                &PredefinedMenuItem::separator(app)?,
                &MenuItem::with_id(app, QUIT_ID, w(QUIT, en::QUIT), true, Some("CmdOrCtrl+Q"))?,
            ],
        )?;
        let edit = Submenu::with_items(
            app,
            w(EDIT, en::EDIT),
            true,
            &[
                &MenuItem::with_id(app, UNDO_ID, w(UNDO, en::UNDO), true, Some("CmdOrCtrl+Z"))?,
                &PredefinedMenuItem::redo(app, Some(w(REDO, en::REDO)))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, Some(w(CUT, en::CUT)))?,
                &PredefinedMenuItem::copy(app, Some(w(COPY, en::COPY)))?,
                &PredefinedMenuItem::paste(app, Some(w(PASTE, en::PASTE)))?,
                &PredefinedMenuItem::select_all(app, Some(w(SELECT_ALL, en::SELECT_ALL)))?,
            ],
        )?;
        // The window-list id makes macOS treat it as the standard Window menu.
        let window = Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            w(WINDOW, en::WINDOW),
            true,
            &[
                &PredefinedMenuItem::minimize(app, Some(w(MINIMIZE, en::MINIMIZE)))?,
                &PredefinedMenuItem::close_window(app, Some(w(CLOSE_WINDOW, en::CLOSE_WINDOW)))?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &edit, &window])
    }

    /// Cmd+Q and the quit item close the main window like its close button: the standard
    /// quit item ends the process through `terminate:` without any window event, which
    /// would skip saving the placement, the closing blocker and the grace for a running
    /// fetch. Quitting from the Dock or at logout still goes through `terminate:`; main.rs
    /// covers that in `RunEvent::Exit`.
    #[allow(
        clippy::needless_pass_by_value,
        reason = "the signature of Tauri's menu event handler"
    )]
    pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
        if event.id() == UNDO_ID {
            if let Some(window) = app.get_webview_window(super::MAIN)
                && let Err(e) = window.emit(MENU_UNDO, ())
            {
                log::warn!("undo item: page not reached ({e})");
            }
            return;
        }
        if event.id() == SETTINGS_ID {
            if let Some(window) = app.get_webview_window(super::MAIN) {
                let _ = window.set_focus();
                if let Err(e) = window.emit(NAVIGATE, "settings") {
                    log::warn!("settings item: page not reached ({e})");
                }
            }
            return;
        }
        if event.id() != QUIT_ID {
            return;
        }
        match app.get_webview_window(super::MAIN) {
            Some(window) => {
                if let Err(e) = window.close() {
                    log::warn!("quit: main window not closed ({e}), exiting");
                    app.exit(0);
                }
            }
            None => app.exit(0),
        }
    }
}

/// Operating system of the interface (the page words its texts accordingly).
pub fn platform() -> jobalert_core::view::Platform {
    if cfg!(target_os = "macos") {
        jobalert_core::view::Platform::Macos
    } else {
        jobalert_core::view::Platform::Windows
    }
}

/// Shows a file selected in its folder, the way the OS does: Explorer with `/select` on
/// Windows, the Finder with `open -R` on macOS (elsewhere the folder opens).
pub fn show_in_folder(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        // The Explorer of the system folder, never one found elsewhere on the PATH. It reads
        // its command line itself: the path in quotes right after the comma. Its exit code
        // says nothing (1 also when it worked), so it is not waited for.
        let explorer = std::env::var_os("SystemRoot").map_or_else(
            || std::path::PathBuf::from("explorer.exe"),
            |root| std::path::PathBuf::from(root).join("explorer.exe"),
        );
        std::process::Command::new(explorer)
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map(drop)
    }
    #[cfg(target_os = "macos")]
    {
        let mut finder = std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(path)
            .spawn()?;
        // `open` hands over to the Finder and ends at once; it is reaped off this thread.
        std::thread::spawn(move || {
            let _ = finder.wait();
        });
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        open::that_detached(path.parent().unwrap_or(path))
    }
}

/// Where the mailbox password lives on this operating system.
pub fn vault_kind() -> jobalert_core::view::VaultKind {
    if cfg!(target_os = "macos") {
        jobalert_core::view::VaultKind::MacosKeychain
    } else {
        jobalert_core::view::VaultKind::WindowsCredentialManager
    }
}

// ------------------------------------------------------------------ startup dialog

/// The log folder the startup dialog names (it shows before there is an app handle): the
/// app's local data folder of this OS, `logs` in it.
pub const LOG_DIR_HINT: &str = if cfg!(target_os = "macos") {
    "~/Library/Application Support/de.cxecutives.job-alert-monitor/logs"
} else {
    "%LOCALAPPDATA%\\de.cxecutives.job-alert-monitor\\logs"
};

// User-facing text, German by product decision.
const WINDOW_HINT_DE: &str = "Fehlt die Microsoft-Edge-WebView2-Laufzeit, installiere sie \
    (https://developer.microsoft.com/microsoft-edge/webview2/).";
// end of user-facing text

// User-facing text, English.
const WINDOW_HINT_EN: &str = "If the Microsoft Edge WebView2 runtime is missing, install it \
    (https://developer.microsoft.com/microsoft-edge/webview2/).";
// end of user-facing text

/// What helps when the window cannot open, in the startup dialog's language: on Windows the
/// WebView2 runtime is usually missing; macOS brings its engine along.
pub fn window_hint(language: Language) -> Option<&'static str> {
    if !cfg!(windows) {
        return None;
    }
    Some(match language {
        Language::De => WINDOW_HINT_DE,
        Language::En => WINDOW_HINT_EN,
    })
}
