//! Placement of the app window across restarts, as plain numbers (physical pixels): what is
//! stored when the window closes, and where the window goes at the next start - only onto a
//! screen that still exists, and never larger than that screen. The app reads the window and
//! the screens and applies the result (`src-tauri/src/main.rs`). And what a point of the
//! window's top bar is to the OS ([`Bar::hit`], `src-tauri/src/platform.rs` answers the
//! window procedure with it on Windows).

use serde::{Deserialize, Serialize};

use crate::store::Store;

/// Key of the placement in the store.
const KEY: &str = "window";
/// The middle of the title bar stays at least this far inside the screen ...
const MIN_INSIDE: i32 = 100;
/// ... and the top edge at least this far above the screen's bottom.
const MIN_ABOVE_BOTTOM: i32 = 40;

/// A stored placement. `width == 0`: only "maximized" is known (first closed while
/// maximized) - the window keeps its default place.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// A screen as the OS reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Screen {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Where the window goes at the start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Restore {
    /// Position and size; `None`: the default (centered) placement stays.
    pub bounds: Option<Placement>,
    /// Maximize once the window shows.
    pub maximized: bool,
}

impl Placement {
    /// The stored placement (`None` if there is none or it is unreadable).
    pub fn load(store: &Store) -> Option<Placement> {
        store
            .kv_get(KEY)
            .ok()
            .flatten()
            .and_then(|json| serde_json::from_str(&json).ok())
    }

    pub fn save(&self, store: &Store) -> crate::Result<()> {
        let json = serde_json::to_string(self).expect("serialisable");
        store.kv_set(KEY, &json)
    }

    /// The placement to store when the window closes at `position` with `size`. Maximized, it
    /// keeps the last normal placement and only remembers the state.
    pub fn on_close(
        previous: Option<Placement>,
        maximized: bool,
        (x, y): (i32, i32),
        (width, height): (u32, u32),
    ) -> Placement {
        match previous {
            Some(previous) if maximized => Placement {
                maximized,
                ..previous
            },
            None if maximized => Placement {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                maximized,
            },
            _ => Placement {
                x,
                y,
                width,
                height,
                maximized,
            },
        }
    }

    /// The title bar is reachable on `screen`: its middle lies well inside, its top edge on
    /// the screen and not at the very bottom.
    fn reachable_on(&self, screen: &Screen) -> bool {
        let right = screen
            .x
            .saturating_add(i32::try_from(screen.width).unwrap_or(i32::MAX));
        let bottom = screen
            .y
            .saturating_add(i32::try_from(screen.height).unwrap_or(i32::MAX));
        let middle = self
            .x
            .saturating_add(i32::try_from(self.width / 2).unwrap_or(0));
        middle > screen.x.saturating_add(MIN_INSIDE)
            && middle < right.saturating_sub(MIN_INSIDE)
            && self.y >= screen.y
            && self.y < bottom.saturating_sub(MIN_ABOVE_BOTTOM)
    }

    /// Never beyond `screen` - the size was perhaps saved on a larger one that is gone now,
    /// and parts of the UI would lie outside. Trimmed from the window corner: what still
    /// fits right of and below it stays.
    fn fitted_to(&self, screen: &Screen) -> Placement {
        let left = u32::try_from(self.x.saturating_sub(screen.x)).unwrap_or(0);
        let above = u32::try_from(self.y.saturating_sub(screen.y)).unwrap_or(0);
        Placement {
            width: self.width.min(screen.width.saturating_sub(left)),
            height: self.height.min(screen.height.saturating_sub(above)),
            ..*self
        }
    }
}

/// Where the window goes at the start: the stored placement on the first screen where its
/// title bar is reachable, trimmed to that screen. Off every screen, nothing is restored -
/// not even "maximized", which would open it on a screen it was never on.
pub fn restore(stored: Option<Placement>, screens: &[Screen]) -> Restore {
    let nothing = Restore {
        bounds: None,
        maximized: false,
    };
    let Some(placement) = stored else {
        return nothing;
    };
    if placement.width == 0 {
        return Restore {
            maximized: placement.maximized,
            ..nothing
        };
    }
    match screens.iter().find(|s| placement.reachable_on(s)) {
        Some(screen) => Restore {
            bounds: Some(placement.fitted_to(screen)),
            maximized: placement.maximized,
        },
        None => nothing,
    }
}

// ------------------------------------------------------------------ the top bar

/// The window's top bar in CSS pixels: `--titlebar-height` and `--titlebar-button-width` of
/// `ui/src/styles/tokens.css` (`core/tests/ui_contract.rs` ties the numbers together). On
/// Windows the page draws the bar with its three caption buttons at the right, and
/// `src-tauri/src/platform.rs` answers the window procedure there with [`Bar::hit`], so the
/// bar behaves like a native caption: it moves the window, a double click maximizes, a right
/// click opens the system menu, and the snap layouts of Windows 11 open over Maximieren. The
/// hairline under the bar belongs to the page.
pub const BAR_HEIGHT: u32 = 36;
pub const CAPTION_BUTTON: u32 = 46;

/// What a point of the window's client area is to the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarHit {
    /// Below the bar or outside the client area: the page (or the frame) decides.
    Page,
    /// The empty bar.
    Caption,
    /// The top resize edge of a window that is not maximized.
    TopEdge,
    Minimize,
    Maximize,
    Close,
}

/// The bar of one window as the OS measures it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bar {
    /// Width of the client area in physical pixels.
    pub width: i32,
    /// Dots per inch of the window (96 = 100 %).
    pub dpi: u32,
    /// Height of the top resize edge in physical pixels (0 while maximized).
    pub edge: i32,
}

impl Bar {
    /// A length of the page (CSS pixels) in physical pixels, rounded.
    pub fn scaled(&self, css: u32) -> i32 {
        let physical = (u64::from(css) * u64::from(self.dpi.max(1)) + 48) / 96;
        i32::try_from(physical).unwrap_or(i32::MAX)
    }

    /// The bar's height in physical pixels.
    pub fn height(&self) -> i32 {
        self.scaled(BAR_HEIGHT)
    }

    /// What the pixel at `x`, `y` (physical pixels from the client area's top-left corner)
    /// is: the top resize edge first (it lies over the whole width, as on a native window),
    /// then the buttons from the right (Schließen, Maximieren, Minimieren, each
    /// [`CAPTION_BUTTON`] wide), then the empty bar.
    pub fn hit(&self, x: i32, y: i32) -> BarHit {
        if x < 0 || x >= self.width || y < 0 || y >= self.height() {
            return BarHit::Page;
        }
        if y < self.edge {
            return BarHit::TopEdge;
        }
        // The pixel's middle, in CSS pixels from the right edge.
        let from_right =
            (f64::from(self.width) - f64::from(x) - 0.5) * 96.0 / f64::from(self.dpi.max(1));
        let button = f64::from(CAPTION_BUTTON);
        if from_right < button {
            BarHit::Close
        } else if from_right < 2.0 * button {
            BarHit::Maximize
        } else if from_right < 3.0 * button {
            BarHit::Minimize
        } else {
            BarHit::Caption
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The buttons at 100 %: 46 px each from the right, the bar 36 px high.
    #[test]
    fn the_caption_buttons_lie_at_the_right_end_of_the_bar() {
        let bar = Bar {
            width: 1360,
            dpi: 96,
            edge: 0,
        };
        assert_eq!(bar.hit(1359, 0), BarHit::Close);
        assert_eq!(bar.hit(1360 - 46, 20), BarHit::Close);
        assert_eq!(bar.hit(1360 - 47, 20), BarHit::Maximize);
        assert_eq!(bar.hit(1360 - 92, 35), BarHit::Maximize);
        assert_eq!(bar.hit(1360 - 93, 35), BarHit::Minimize);
        assert_eq!(bar.hit(1360 - 138, 0), BarHit::Minimize);
        assert_eq!(bar.hit(1360 - 139, 0), BarHit::Caption);
        assert_eq!(bar.hit(0, 0), BarHit::Caption);
        // Below the bar and beside the client area: the page and the frame.
        assert_eq!(bar.hit(1359, 36), BarHit::Page);
        assert_eq!(bar.hit(-1, 10), BarHit::Page);
        assert_eq!(bar.hit(1360, 10), BarHit::Page);
    }

    /// At 150 % everything is half as large again: the bar 54 px, a button 69 px.
    #[test]
    fn the_bar_scales_with_the_window() {
        let bar = Bar {
            width: 2040,
            dpi: 144,
            edge: 0,
        };
        assert_eq!(bar.height(), 54);
        assert_eq!(bar.hit(2040 - 69, 53), BarHit::Close);
        assert_eq!(bar.hit(2040 - 70, 53), BarHit::Maximize);
        assert_eq!(bar.hit(2040 - 138, 0), BarHit::Maximize);
        assert_eq!(bar.hit(2040 - 139, 0), BarHit::Minimize);
        assert_eq!(bar.hit(2040 - 208, 0), BarHit::Caption);
        assert_eq!(bar.hit(10, 54), BarHit::Page);
        // 125 %: the bar is 45 px high.
        assert_eq!(Bar { dpi: 120, ..bar }.height(), 45);
    }

    /// A window that is not maximized can be sized at its top edge, over the buttons too;
    /// maximized it has no edge and the corner is Schließen.
    #[test]
    fn the_top_edge_sizes_a_window_that_is_not_maximized() {
        let restored = Bar {
            width: 1000,
            dpi: 96,
            edge: 4,
        };
        assert_eq!(restored.hit(500, 3), BarHit::TopEdge);
        assert_eq!(restored.hit(999, 0), BarHit::TopEdge);
        assert_eq!(restored.hit(999, 4), BarHit::Close);
        assert_eq!(restored.hit(500, 4), BarHit::Caption);
        let maximized = Bar {
            edge: 0,
            ..restored
        };
        assert_eq!(maximized.hit(999, 0), BarHit::Close);
    }

    fn placement(x: i32, y: i32, width: u32, height: u32) -> Placement {
        Placement {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    fn screen(x: i32, y: i32, width: u32, height: u32) -> Screen {
        Screen {
            x,
            y,
            width,
            height,
        }
    }

    fn size(restore: Restore) -> (u32, u32) {
        let bounds = restore.bounds.expect("restored");
        (bounds.width, bounds.height)
    }

    /// Placement from a wider screen: the window ends at the right and bottom edge -
    /// otherwise part of the UI would lie outside and be unreachable.
    #[test]
    fn a_window_near_the_edge_is_trimmed_in_both_directions() {
        let restored = restore(
            Some(placement(1000, 100, 1500, 1050)),
            &[screen(0, 0, 1920, 1080)],
        );
        assert_eq!(size(restored), (920, 980));
        assert_eq!(restored.bounds.map(|b| (b.x, b.y)), Some((1000, 100)));
    }

    /// A fitting placement on a screen left of the main display (negative coordinates):
    /// nothing is trimmed.
    #[test]
    fn a_window_that_fits_keeps_its_size() {
        let screens = [screen(0, 0, 1920, 1080), screen(-1920, 0, 1920, 1080)];
        let restored = restore(Some(placement(-1800, 60, 1200, 800)), &screens);
        assert_eq!(size(restored), (1200, 800));
    }

    /// The screen it was on is gone: the window stays centered, and does not open
    /// maximized on a screen it was never on.
    #[test]
    fn a_window_off_every_screen_keeps_the_default_place() {
        let gone = Placement {
            maximized: true,
            ..placement(3000, 100, 1200, 800)
        };
        let restored = restore(Some(gone), &[screen(0, 0, 1920, 1080)]);
        assert_eq!(
            restored,
            Restore {
                bounds: None,
                maximized: false
            }
        );
        // Title bar below the screen's bottom edge: not reachable either.
        let low = restore(
            Some(placement(100, 1060, 800, 600)),
            &[screen(0, 0, 1920, 1080)],
        );
        assert_eq!(low.bounds, None);
    }

    /// Closed maximized: the normal placement stays, only the state is new - and with no
    /// normal placement known, only the state is stored.
    #[test]
    fn closing_maximized_keeps_the_normal_placement() {
        let normal = placement(100, 80, 1200, 800);
        let closed = Placement::on_close(Some(normal), true, (-8, -8), (1936, 1056));
        assert_eq!(
            closed,
            Placement {
                maximized: true,
                ..normal
            }
        );
        let first = Placement::on_close(None, true, (-8, -8), (1936, 1056));
        assert_eq!((first.width, first.maximized), (0, true));
        let restored = restore(Some(first), &[screen(0, 0, 1920, 1080)]);
        assert_eq!(
            restored,
            Restore {
                bounds: None,
                maximized: true
            }
        );
        let moved = Placement::on_close(Some(normal), false, (300, 200), (1000, 700));
        assert_eq!(moved, placement(300, 200, 1000, 700));
    }

    /// The stored form stays readable across versions (the same keys as before).
    #[test]
    fn a_placement_round_trips_through_the_store() {
        let store = Store::in_memory().unwrap();
        assert_eq!(Placement::load(&store), None);
        store
            .kv_set(
                KEY,
                r#"{"x":10,"y":20,"width":1200,"height":800,"maximized":false}"#,
            )
            .unwrap();
        assert_eq!(Placement::load(&store), Some(placement(10, 20, 1200, 800)));
        let moved = placement(30, 40, 900, 700);
        moved.save(&store).unwrap();
        assert_eq!(Placement::load(&store), Some(moved));
    }
}
