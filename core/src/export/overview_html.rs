//! `JobAlerts.html`, the report ("Bericht" in the app): a small, self-contained page to open in
//! any browser, to print on A4 or to read on a phone. Its head says how many new matches there
//! are and what the rings and marks mean; then "Neu und passend" (`Store::new_fitting`) by
//! band - the high ones, the medium ones, the low ones as one count line - and the favourites
//! of the inbox the bands do not show. Each job reads like the reader's head: title, company
//! and place, the ad's key facts in the app's words and order, the band and the musts met, up
//! to two met and two open requirements, the first point to check or why it is excluded, the
//! marks of the ad (closed, offline, preview, details missing), its date and a mark for a job
//! the last fetch brought. Without a usable profile: the app's sentence and the new jobs by
//! date. Never the full text. Everything from mails and portals is HTML-escaped; the page
//! loads nothing from outside. The visual language is the app's: its font stack, its colour
//! tokens (`ui/src/styles/tokens.css` through the generated `palette.rs`) and its rings.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::path::Path;

use jiff::Timestamp;

use super::palette::{self, Colour};
use super::scale::{SCORE_SCALE, score_step};
use super::texts::{PROGRAM_NAME, Texts};
use crate::error::Result;
use crate::model::{Band, DescStatus, MatchStatus, band};
use crate::portal::JobKey;
use crate::settings::Language;
use crate::store::JobRow;
use crate::store::matches::OverviewJobs;
use crate::text::split_company_location;
use crate::view::DetailState;

/// The app's colour tokens the report draws with, by their names in tokens.css: the ink text,
/// the navy of the favourite's star (`--icon-accent`), the coral dot of a job the last fetch
/// brought (`--unread`: coral means new), the band colours of the reader and the danger red of
/// an exclusion. The font is the app's `--font-sans`.
const COLOURS: [(&str, Colour); 19] = [
    ("bg", palette::BG),
    ("surface", palette::SURFACE),
    ("surface-muted", palette::SURFACE_MUTED),
    ("text", palette::TEXT),
    ("text-muted", palette::TEXT_MUTED),
    ("text-subtle", palette::TEXT_SUBTLE),
    ("border", palette::BORDER),
    ("icon-accent", palette::ICON_ACCENT),
    ("unread", palette::UNREAD),
    ("score-high-text", palette::SCORE_HIGH_TEXT),
    ("score-high-surface", palette::SCORE_HIGH_SURFACE),
    ("score-mid-text", palette::SCORE_MID_TEXT),
    ("score-mid-surface", palette::SCORE_MID_SURFACE),
    ("score-low-text", palette::SCORE_LOW_TEXT),
    ("score-low-surface", palette::SCORE_LOW_SURFACE),
    ("score-track", palette::SCORE_TRACK),
    ("danger", palette::DANGER),
    ("danger-strong", palette::DANGER_STRONG),
    ("danger-soft", palette::DANGER_SOFT),
];

/// The tokens of [`COLOURS`] and the font as the page's custom properties.
fn root_style() -> String {
    let mut css = String::from("\n:root { color-scheme: light;");
    for (name, colour) in COLOURS {
        let _ = write!(css, " --{name}: {};", colour.css);
    }
    let _ = write!(css, " --font-sans: {}; }}", palette::FONT_SANS);
    css
}

/// The page's rules, in the tokens of [`root_style`].
const STYLE: &str = "
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 400 15px/22px var(--font-sans); -webkit-text-size-adjust: 100%; }
main { max-width: 760px; margin: 0 auto; padding: 32px 24px 48px; }
h1 { font-size: 26px; line-height: 34px; font-weight: 600; margin: 0; }
h2 { font-size: 17px; line-height: 24px; font-weight: 600; margin: 0 0 12px; }
h3 { font-size: 15px; line-height: 22px; font-weight: 600; margin: 0; }
header { margin: 0 0 28px; }
.summary { margin: 6px 0 0; font-size: 17px; line-height: 24px; }
.meta { margin: 4px 0 0; color: var(--text-subtle); font-size: 13px; line-height: 20px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 12px 0 0; padding: 0;
  list-style: none; color: var(--text-muted); font-size: 13px; line-height: 20px; }
.legend li { display: flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 50%; border: 3px solid; }
section { margin: 0 0 28px; }
ol { list-style: none; margin: 0; padding: 0; }
.job { display: flex; gap: 16px; padding: 16px; margin: 0 0 8px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; break-inside: avoid; }
.body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.title a { color: var(--text); text-decoration: none; }
.title a:hover { text-decoration: underline; }
.star { color: var(--icon-accent); margin-left: 6px; }
.new { display: inline-block; width: 8px; height: 8px; margin-left: 6px; border-radius: 50%;
  background: var(--unread); vertical-align: middle; }
.sub, .date { margin: 2px 0 0; color: var(--text-muted); font-size: 13px; line-height: 20px; }
.date { color: var(--text-subtle); }
.facts, .verdict, .check, .why { margin: 6px 0 0; font-size: 13px; line-height: 20px; }
.check { color: var(--text-muted); }
.why { color: var(--danger-strong); }
.band { display: inline-block; margin: 0 8px 0 0; padding: 0 8px; border-radius: 10px;
  font-size: 12px; font-weight: 600; }
.band.high { background: var(--score-high-surface); color: var(--score-high-text); }
.band.mid { background: var(--score-mid-surface); color: var(--score-mid-text); }
.band.low, .band.none { background: var(--score-low-surface); color: var(--score-low-text); }
.band.out { background: var(--danger-soft); color: var(--danger-strong); }
.points { margin: 6px 0 0; padding: 0; list-style: none; font-size: 13px; line-height: 20px; }
.points li { position: relative; padding-left: 18px; }
.points li::before { position: absolute; left: 0; }
.points .met::before { content: '\\2713'; color: var(--score-high-text); }
.points .open::before { content: '\\25CB'; color: var(--score-low-text); }
.marks { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 8px 0 0; padding: 0;
  list-style: none; }
.mark { padding: 0 8px; border-radius: 10px; font-size: 12px; line-height: 20px;
  background: var(--surface-muted); color: var(--text-muted); }
.note, .empty, .more, .low-line { margin: 0 0 12px; color: var(--text-muted); font-size: 13px;
  line-height: 20px; }
footer { margin-top: 32px; color: var(--text-subtle); font-size: 12px; }
.score { position: relative; flex: none; width: 48px; height: 48px; display: grid;
  place-items: center; font-weight: 600; color: var(--text); }
.ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.ring circle { fill: none; stroke-width: 3; }
.track { stroke: var(--score-track); }
.value { stroke-linecap: round; }
.none, .unscorable { color: var(--score-low-text); }
.out { color: var(--danger-strong); }
.out .track { stroke: var(--danger); stroke-opacity: 0.25; }
.ban { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);
  white-space: nowrap; }
@media (max-width: 480px) {
  main { padding: 20px 16px 32px; }
  h1 { font-size: 20px; line-height: 28px; }
  .job { gap: 12px; padding: 12px; }
  .score { width: 40px; height: 40px; font-size: 13px; }
}
@media print {
  @page { size: A4; margin: 14mm; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  body { background: var(--surface); }
  main { max-width: none; padding: 0; }
  .job { border-color: var(--score-track); }
}
";

/// The track of a ring: circumference 100, so an arc's length is the score (like the app's
/// ring).
const TRACK: &str = "<svg class=\"ring\" viewBox=\"0 0 36 36\" aria-hidden=\"true\">\
                     <circle class=\"track\" cx=\"18\" cy=\"18\" r=\"15.9155\"/>";
/// The ban mark of an excluded job's ring: a circle and its diagonal.
const BAN: &str = "<svg class=\"ban\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">\
                   <circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M5.6 5.6 18.4 18.4\"/></svg>";
/// The favourite's star.
const STAR: &str = "\u{2605}";

/// Writes the report in the app's language.
pub fn write_overview_html(
    path: &Path,
    jobs: &OverviewJobs,
    now: Timestamp,
    language: Language,
) -> Result<()> {
    super::write_atomic(path, render(jobs, now, Texts::of(language)).as_bytes())
}

/// The class of each colour step of a score ring (`.s0` ... `.s9`).
const STEP_CLASS: [&str; 10] = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];

/// The arc colour of each step, from the one table the app uses too, and the legend's
/// swatches of the bands (the step of their lowest score).
fn scale_style() -> String {
    let mut css = String::new();
    for (class, colour) in STEP_CLASS.iter().zip(SCORE_SCALE) {
        let _ = writeln!(css, ".{class} .value {{ stroke: {}; }}", colour.css);
    }
    for (class, from) in [
        ("high", crate::model::HIGH_FROM),
        ("mid", crate::model::MID_FROM),
    ] {
        let _ = writeln!(
            css,
            ".swatch.{class} {{ border-color: {}; }}",
            SCORE_SCALE[score_step(from)].css
        );
    }
    css
}

/// What every job of the page is rendered with.
struct Page<'a> {
    texts: &'a Texts,
    now: Timestamp,
    /// The last run that read the mailbox (0 = none).
    last_run: i64,
}

/// The page: head (title, summary, when it was made, the legend), the new matches by band or,
/// without a usable profile, the new jobs by date, then the favourites not shown above.
fn render(jobs: &OverviewJobs, now: Timestamp, texts: &Texts) -> String {
    let page = Page {
        texts,
        now,
        last_run: jobs.last_run,
    };
    let mut out = String::new();
    let _ = write!(
        out,
        "<!doctype html>\n<html lang=\"{}\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>{}</title><style>{}{STYLE}{}</style></head>\n<body><main>\
         <header><h1>{}</h1>",
        texts.language.code(),
        esc(texts.html_title),
        root_style(),
        scale_style(),
        esc(texts.html_title),
    );
    let new = &jobs.new;
    if jobs.scored {
        let _ = write!(
            out,
            "<p class=\"summary\">{}</p>",
            esc(&(texts.html_summary)(new.total, new.high))
        );
    }
    let _ = write!(
        out,
        "<p class=\"meta\">{} {}</p>",
        esc(texts.html_created),
        esc(&texts.moment(now))
    );
    if jobs.scored {
        legend(&mut out, texts);
    }
    out.push_str("</header>\n");
    let mut shown: HashSet<&JobKey> = HashSet::new();
    if jobs.scored {
        let of_band = |wanted: Band| -> Vec<&JobRow> {
            new.jobs
                .iter()
                .filter(|job| job.match_.as_ref().map(|m| band(m.score)) == Some(wanted))
                .collect()
        };
        let (high, mid) = (of_band(Band::High), of_band(Band::Mid));
        if new.total == 0 {
            let _ = write!(out, "<p class=\"empty\">{}</p>", esc(texts.html_empty));
        }
        for (heading, list) in [(texts.html_high, &high), (texts.html_mid, &mid)] {
            if !list.is_empty() {
                section(&mut out, heading, list, &page);
                shown.extend(list.iter().map(|job| &job.key));
            }
        }
        let beyond = (new.high + new.mid).saturating_sub(high.len() + mid.len());
        if beyond > 0 {
            let _ = write!(
                out,
                "<p class=\"more\">{}</p>",
                esc(&(texts.html_more)(beyond))
            );
        }
        if new.low > 0 {
            let _ = write!(
                out,
                "<p class=\"low-line\">{}</p>",
                esc(&(texts.html_low)(new.low))
            );
        }
    } else {
        let _ = write!(out, "<p class=\"note\">{}</p>", esc(texts.html_no_profile));
        let latest: Vec<&JobRow> = jobs.unscored.iter().collect();
        if latest.is_empty() {
            let _ = write!(out, "<p class=\"empty\">{}</p>", esc(texts.html_empty_new));
        } else {
            section(&mut out, texts.html_new_jobs, &latest, &page);
            shown.extend(latest.iter().map(|job| &job.key));
        }
    }
    let favourites: Vec<&JobRow> = jobs
        .favourites
        .iter()
        .filter(|job| !shown.contains(&job.key))
        .collect();
    if !favourites.is_empty() {
        section(&mut out, texts.html_pinned, &favourites, &page);
    }
    let _ = write!(
        out,
        "<footer>{}</footer>\n</main></body></html>\n",
        esc(PROGRAM_NAME)
    );
    out
}

/// What the rings and marks mean: the two bands with their colour and lowest score, the
/// favourite's star and the dot of a job the last fetch brought.
fn legend(out: &mut String, texts: &Texts) {
    let _ = write!(
        out,
        "<ul class=\"legend\">\
         <li><span class=\"swatch high\" aria-hidden=\"true\"></span>{}</li>\
         <li><span class=\"swatch mid\" aria-hidden=\"true\"></span>{}</li>\
         <li><span class=\"star\" aria-hidden=\"true\">{STAR}</span>{}</li>\
         <li><span class=\"new\" aria-hidden=\"true\"></span>{}</li></ul>",
        esc(&(texts.html_legend_band)(true)),
        esc(&(texts.html_legend_band)(false)),
        esc(texts.html_favourite),
        esc(texts.html_since),
    );
}

/// A section with its heading and its list.
fn section(out: &mut String, heading: &str, jobs: &[&JobRow], page: &Page<'_>) {
    let _ = writeln!(out, "<section><h2>{}</h2><ol>", esc(heading));
    for job in jobs {
        item(out, job, page);
    }
    out.push_str("</ol></section>\n");
}

/// The ring of a job, drawn like the app's: every ring has the same solid track, the centre
/// and the arc say the state. A scored job's arc is its share of 100 in the colour of its
/// step (ten steps by decile, `scale.rs`), a score from a teaser only too. An excluded job
/// keeps its score, but its ring is a pale red track with the ban mark and no number; an
/// unscorable job shows the track and a dash, one not scored yet (or unscorable while its
/// details still come) the track alone.
fn ring(out: &mut String, job: &JobRow, waits: bool, texts: &Texts) {
    // Class, tooltip, the arc (the score) and what the centre shows.
    let (class, title, arc, centre) = match &job.match_ {
        _ if waits => ("none".to_owned(), texts.html_none, 0, String::new()),
        Some(m) if m.status == MatchStatus::Scored => {
            let step = STEP_CLASS[score_step(m.score)];
            let class = if job.desc_status == DescStatus::Teaser {
                format!("{step} provisional")
            } else {
                step.to_owned()
            };
            (class, texts.html_match, m.score, m.score.to_string())
        }
        Some(m) if m.status == MatchStatus::Excluded => {
            ("out".to_owned(), texts.html_excluded, 0, BAN.to_owned())
        }
        Some(_) => (
            "unscorable".to_owned(),
            texts.html_unscorable,
            0,
            "\u{2013}".to_owned(),
        ),
        None => ("none".to_owned(), texts.html_none, 0, String::new()),
    };
    let _ = write!(
        out,
        "<div class=\"score {class}\" title=\"{}\">{TRACK}",
        esc(title)
    );
    // No arc for a score of 0 either: a round cap alone would be a dot.
    if arc > 0 {
        let _ = write!(
            out,
            "<circle class=\"value\" cx=\"18\" cy=\"18\" r=\"15.9155\" \
             stroke-dasharray=\"{arc} 100\"/>"
        );
    }
    let _ = write!(out, "</svg>{centre}</div>");
}

/// A job whose ring waits like the app's (`ringState`): not scored yet, or unscorable while
/// its details still come on their own.
fn waits(job: &JobRow, now: Timestamp) -> bool {
    match &job.match_ {
        None => true,
        Some(m) => {
            m.status == MatchStatus::Unscorable
                && matches!(DetailState::at(job, now), DetailState::Pending { .. })
        }
    }
}

/// One job, like the reader's head.
fn item(out: &mut String, job: &JobRow, page: &Page<'_>) {
    let texts = page.texts;
    let waits = waits(job, page.now);
    out.push_str("<li class=\"job\">");
    ring(out, job, waits, texts);
    out.push_str("<div class=\"body\">");
    // The title opens its ad in a new tab (the report stays open); the star and the dot of
    // a job the last fetch brought follow it.
    let _ = write!(
        out,
        "<h3 class=\"title\"><a href=\"{}\" target=\"_blank\" rel=\"noopener noreferrer\">{}</a>",
        esc(job.url.as_str()),
        esc(&crate::view::display_title(job)),
    );
    if job.pinned_at.is_some() {
        let _ = write!(
            out,
            "<span class=\"star\" title=\"{0}\"><span aria-hidden=\"true\">{STAR}</span>\
             <span class=\"vh\">{0}</span></span>",
            esc(texts.html_favourite)
        );
    }
    if page.last_run > 0 && job.first_seen_run == page.last_run {
        let _ = write!(
            out,
            "<span class=\"new\" title=\"{0}\"><span class=\"vh\">{0}</span></span>",
            esc(texts.html_since)
        );
    }
    out.push_str("</h3>");
    let (company, location) = split_company_location(&job.company, &job.location);
    let sub: Vec<&str> = [company.as_str(), location.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect();
    if !sub.is_empty() {
        let _ = write!(out, "<p class=\"sub\">{}</p>", esc(&sub.join(" · ")));
    }
    if let Some(m) = &job.match_ {
        let facts = texts.facts_line(&m.facts);
        if !facts.is_empty() {
            let _ = write!(out, "<p class=\"facts\">{}</p>", esc(&facts.join(" · ")));
        }
    }
    verdict(out, job, waits, texts);
    marks(out, job, texts);
    let date = texts.day(job.mail_date.unwrap_or(job.first_seen_at));
    let _ = write!(
        out,
        "<p class=\"date\">{}</p>",
        esc(&format!("{date} · {}", job.key.portal.label()))
    );
    out.push_str("</div></li>\n");
}

/// The band word and the musts met, the met and open requirements, and the first point to
/// check or why the engine excludes the job (for a job counted anyway: that it is and why).
fn verdict(out: &mut String, job: &JobRow, waits: bool, texts: &Texts) {
    let Some(m) = job.match_.as_ref().filter(|_| !waits) else {
        let _ = write!(
            out,
            "<p class=\"verdict\"><span class=\"band none\">{}</span></p>",
            esc(texts.html_none)
        );
        return;
    };
    let musts = (texts.html_musts)(m.must_met, m.must_total);
    match m.status {
        MatchStatus::Scored => {
            let (class, word) = match band(m.score) {
                Band::High => ("high", texts.html_high),
                Band::Mid => ("mid", texts.html_mid),
                Band::Low => ("low", texts.html_low_band),
            };
            let _ = write!(
                out,
                "<p class=\"verdict\"><span class=\"band {class}\">{}</span>{}</p>",
                esc(word),
                esc(&musts)
            );
        }
        MatchStatus::Excluded => {
            let _ = write!(
                out,
                "<p class=\"verdict\"><span class=\"band out\">{}</span>{}</p>",
                esc(texts.html_excluded),
                esc(&musts)
            );
        }
        MatchStatus::Unscorable => {
            let _ = write!(
                out,
                "<p class=\"verdict\"><span class=\"band none\">{}</span></p>",
                esc(texts.html_unscorable)
            );
            return;
        }
    }
    points(out, &m.top, &job.match_open, texts);
    let note = m.note.as_ref();
    let reason = || {
        note.and_then(|n| texts.exclusion_reason(&n.code, &n.params))
            .unwrap_or(texts.html_excluded)
    };
    if job.override_include {
        let _ = write!(
            out,
            "<p class=\"why\">{}. {}</p>",
            esc(texts.html_overridden),
            esc(reason())
        );
    } else if m.status == MatchStatus::Excluded {
        let _ = write!(out, "<p class=\"why\">{}</p>", esc(reason()));
    } else if let Some(check) =
        note.and_then(|n| super::ai_prompt::reason_sentence(texts.language, &n.code, &n.params))
    {
        let _ = write!(out, "<p class=\"check\">{}</p>", esc(&check));
    }
}

/// Up to two met and two open requirements, as the list keeps them.
fn points(out: &mut String, met: &[String], open: &[String], texts: &Texts) {
    if met.is_empty() && open.is_empty() {
        return;
    }
    out.push_str("<ul class=\"points\">");
    for (class, word, list) in [
        ("met", texts.html_met, met),
        ("open", texts.html_open, open),
    ] {
        for point in list.iter().take(2) {
            let _ = write!(
                out,
                "<li class=\"{class}\"><span class=\"vh\">{} </span>{}</li>",
                esc(word),
                esc(point)
            );
        }
    }
    out.push_str("</ul>");
}

/// The marks of the ad: it takes no applications, it is gone, only its start was readable
/// (a preview), or its details are not there.
fn marks(out: &mut String, job: &JobRow, texts: &Texts) {
    let mark = match job.desc_status {
        DescStatus::Ok if job.desc_closed => Some(texts.html_closed),
        DescStatus::Ok => None,
        DescStatus::Gone => Some(texts.html_gone),
        DescStatus::Teaser => Some(texts.html_teaser),
        DescStatus::Missing | DescStatus::Failed | DescStatus::Unfetchable => {
            Some(texts.html_no_details)
        }
    };
    if let Some(mark) = mark {
        let _ = write!(
            out,
            "<ul class=\"marks\"><li class=\"mark\">{}</li></ul>",
            esc(mark)
        );
    }
}

/// HTML escaping for text and attribute values.
fn esc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::texts;
    use crate::model::{KeyFacts, MatchRecord, Notice};
    use crate::portal::job_link;
    use crate::store::matches::NewFitting;

    fn job(id: u32, title: &str, record: Option<MatchRecord>) -> JobRow {
        let link = job_link(&format!(
            "https://www.linkedin.com/jobs/view/{}/",
            4_000_000_000 + id
        ))
        .unwrap();
        JobRow {
            key: link.key,
            url: link.url,
            title: title.into(),
            company: "Muster <GmbH>".into(),
            location: "Köln".into(),
            mail_date: Some("2026-09-24T07:30:00Z".parse().unwrap()),
            mail_subject: "Betreff".into(),
            gmail_id: None,
            first_seen_at: Timestamp::now(),
            first_seen_run: 1,
            desc_status: DescStatus::Ok,
            desc_short: false,
            desc_closed: false,
            desc_len: 0,
            desc_fetched_at: None,
            desc_attempts: 0,
            desc_error: None,
            txt_name: None,
            desc_attempted_at: None,
            read_at: None,
            match_: record,
            match_open: Vec::new(),
            match_rev: None,
            facts: None,
            pinned_at: None,
            archived_at: None,
            trashed_at: None,
            override_include: false,
        }
    }

    fn record(status: MatchStatus, score: u8, note: Option<&str>) -> MatchRecord {
        MatchRecord {
            status,
            score,
            note: note.map(|code| Notice {
                code: code.into(),
                params: serde_json::Map::new(),
            }),
            must_met: 3,
            must_total: 4,
            top: vec!["SAP <FI>".into(), "Konzernabschluss".into()],
            facts: KeyFacts::default(),
            rank: 0,
        }
    }

    /// A page of new matches (all listed) and favourites, scored by a profile.
    fn page(new: Vec<JobRow>, favourites: Vec<JobRow>) -> OverviewJobs {
        let count = |wanted: Band| {
            new.iter()
                .filter(|j| j.match_.as_ref().map(|m| band(m.score)) == Some(wanted))
                .count()
        };
        OverviewJobs {
            new: NewFitting {
                total: new.len(),
                high: count(Band::High),
                mid: count(Band::Mid),
                low: count(Band::Low),
                jobs: new,
            },
            favourites,
            scored: true,
            unscored: Vec::new(),
            last_run: 2,
        }
    }

    fn scored(id: u32, title: &str, score: u8) -> JobRow {
        job(id, title, Some(record(MatchStatus::Scored, score, None)))
    }

    #[test]
    fn portal_data_is_escaped_and_no_full_text_appears() {
        let html = render(
            &page(vec![scored(1, "<script>alert(1)</script>", 83)], Vec::new()),
            Timestamp::now(),
            &texts::DE,
        );
        assert!(!html.contains("<script>"), "{html}");
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert!(html.contains("Muster &lt;GmbH&gt;") && html.contains("SAP &lt;FI&gt;"));
        assert!(html.contains("class=\"score s8\"") && html.contains(">83<"));
        assert!(
            html.contains(&format!(
                ".s8 .value {{ stroke: {}; }}",
                palette::SCORE_RING_8.css
            )),
            "the shared scale"
        );
        assert!(!html.contains("Betreff"), "no mail data beyond the listing");
        assert!(
            !html.contains("http://") && !html.contains("<link") && !html.contains("<script"),
            "self-contained"
        );
    }

    /// The head: title, a summary line of the new matches, when it was made and a legend of
    /// the bands, the star and the dot; a phone width and a print page.
    #[test]
    fn the_head_sums_up_and_explains() {
        let at: Timestamp = "2026-09-19T12:05:00Z".parse().unwrap();
        let html = render(
            &page(
                vec![scored(1, "A", 91), scored(2, "B", 60), scored(3, "C", 20)],
                Vec::new(),
            ),
            at,
            &texts::DE,
        );
        assert!(html.contains("<title>Bericht</title>") && html.contains("<h1>Bericht</h1>"));
        assert!(
            html.contains("<p class=\"summary\">3 neue passende Jobs, 1 mit hoher Passung.</p>"),
            "{html}"
        );
        assert!(html.contains("<p class=\"meta\">Erstellt am 19.09.2026 14:05</p>"));
        for legend in [
            "Hohe Passung ab 80",
            "Mittlere Passung ab 40",
            "Favorit",
            "Seit dem letzten Abruf",
        ] {
            assert!(html.contains(legend), "{legend}");
        }
        assert!(STYLE.contains("@media (max-width: 480px)") && STYLE.contains("@page { size: A4;"));
        assert!(html.contains("<footer>CXact</footer>"));
        assert_eq!(texts::html_summary(1, 0), "1 neuer passender Job.");
        assert_eq!(
            texts::en::html_summary(1234, 2),
            "1,234 new matching jobs, 2 a high match."
        );
    }

    /// The page speaks the app's tokens: each colour is the token of its name, the font is the
    /// app's font stack, and every custom property a rule reads is declared.
    #[test]
    fn the_style_is_the_apps_tokens() {
        for (name, colour) in COLOURS {
            assert!(
                palette::TOKENS.contains(&(name, colour)),
                "--{name} is not that token"
            );
        }
        let root = root_style();
        assert!(root.contains(&format!("--text: {};", palette::TEXT.css)));
        assert!(root.contains(&format!("--font-sans: {};", palette::FONT_SANS)));
        let rules = format!("{STYLE}{}", scale_style());
        for used in rules.split("var(--").skip(1) {
            let name = &used[..used.find(')').expect("closing parenthesis")];
            assert!(
                root.contains(&format!("--{name}: ")),
                "--{name} is not declared"
            );
        }
    }

    /// The new matches by band: the high ones, then the medium ones, the low ones as one count
    /// line; a cut list says how many more the app lists.
    #[test]
    fn the_new_matches_come_by_band() {
        let mut jobs = page(
            vec![
                scored(1, "Hoch", 91),
                scored(2, "Mittel", 55),
                scored(3, "Gering", 20),
            ],
            Vec::new(),
        );
        let html = render(&jobs, Timestamp::now(), &texts::DE);
        let at = |needle: &str| {
            html.find(needle)
                .unwrap_or_else(|| panic!("{needle}: {html}"))
        };
        assert!(at("<h2>Hohe Passung</h2>") < at(">Hoch<"));
        assert!(at(">Hoch<") < at("<h2>Mittlere Passung</h2>"));
        assert!(at("<h2>Mittlere Passung</h2>") < at(">Mittel<"));
        assert!(!html.contains(">Gering<"), "the low ones only as a count");
        assert!(
            html.contains("<p class=\"low-line\">1 Job mit geringer Passung steht in der App.</p>")
        );
        assert!(!html.contains("class=\"more\""));
        jobs.new.high = 5;
        let html = render(&jobs, Timestamp::now(), &texts::DE);
        assert!(
            html.contains("<p class=\"more\">4 weitere Jobs in der App.</p>"),
            "{html}"
        );
        let empty = render(&page(Vec::new(), Vec::new()), Timestamp::now(), &texts::DE);
        assert!(empty.contains("<p class=\"empty\">Keine neuen passenden Jobs.</p>"));
        assert!(!empty.contains("<section>"));
    }

    /// A job reads like the reader's head: title, company and place, the facts in the app's
    /// order and words, the band and the musts met, two met and two open requirements, the
    /// first point to check, its marks and its date; a job of the last fetch has the dot.
    #[test]
    fn a_job_reads_like_the_reader_head() {
        let mut high = job(
            1,
            "Interim CFO",
            Some(record(MatchStatus::Scored, 88, Some("availabilityGap"))),
        );
        let m = high.match_.as_mut().unwrap();
        m.note
            .as_mut()
            .unwrap()
            .params
            .insert("days".into(), 14.into());
        m.facts = KeyFacts {
            rate: Some(95),
            hourly: Some(true),
            start: Some("2026-11-01".into()),
            months: Some(6),
            remote_from: Some(60),
            remote_to: Some(60),
            ..KeyFacts::default()
        };
        high.match_open = vec!["Power BI".into(), "Zoll".into()];
        high.first_seen_run = 2;
        high.desc_status = DescStatus::Teaser;
        let html = render(&page(vec![high], Vec::new()), Timestamp::now(), &texts::DE);
        assert!(
            html.contains("<p class=\"sub\">Muster &lt;GmbH&gt; · Köln</p>"),
            "{html}"
        );
        assert!(
            html.contains("<p class=\"facts\">95\u{202f}€/Std. · 60\u{202f}% remote · 6 Monate · ab 01.11.2026</p>"),
            "{html}"
        );
        assert!(html.contains(
            "<p class=\"verdict\"><span class=\"band high\">Hohe Passung</span>3 von 4 Pflichtpunkten erfüllt</p>"
        ));
        for point in [
            ">SAP &lt;FI&gt;</li>",
            ">Konzernabschluss</li>",
            ">Power BI</li>",
            ">Zoll</li>",
        ] {
            assert!(html.contains(point), "{point}");
        }
        assert_eq!(html.matches("<li class=\"open\">").count(), 2);
        assert!(
            html.contains("<p class=\"check\">"),
            "the first point to check in words"
        );
        assert!(!html.contains("availabilityGap"), "never an engine code");
        assert!(html.contains("<li class=\"mark\">Vorschau</li>"));
        assert!(html.contains("<p class=\"date\">24.09.2026 · "));
        assert!(html.contains("class=\"new\" title=\"Seit dem letzten Abruf\""));
    }

    /// The rings speak like the app's: the arc is the score's share of 100, a score from a
    /// teaser looks like any other, an unscorable job shows a dash, one not scored yet the
    /// track alone; an excluded one the ban mark, no number.
    #[test]
    fn a_ring_shows_the_share_of_its_score() {
        let mut teaser = scored(2, "B", 42);
        teaser.desc_status = DescStatus::Teaser;
        let mut coming = job(6, "F", Some(record(MatchStatus::Unscorable, 0, None)));
        coming.desc_status = DescStatus::Missing;
        let favourites = vec![
            scored(1, "A", 83),
            scored(3, "C", 5),
            teaser,
            job(4, "D", Some(record(MatchStatus::Unscorable, 0, None))),
            job(5, "E", None),
            coming,
            job(
                7,
                "G",
                Some(record(MatchStatus::Excluded, 86, Some("dayRate"))),
            ),
        ];
        let html = render(&page(Vec::new(), favourites), Timestamp::now(), &texts::DE);
        let rings: Vec<&str> = html
            .split("<div class=\"score ")
            .skip(1)
            .map(|ring| &ring[..ring.find("</div>").unwrap()])
            .collect();
        assert_eq!(rings.len(), 7, "{html}");
        assert!(rings[0].starts_with("s8\"") && rings[0].contains("stroke-dasharray=\"83 100\""));
        assert!(rings[1].starts_with("s0\"") && rings[1].contains("stroke-dasharray=\"5 100\""));
        assert!(rings[2].starts_with("s4 provisional\"") && rings[2].ends_with(">42"));
        assert!(rings[3].starts_with("unscorable\" title=\"Nicht bewertbar\""));
        assert!(rings[3].ends_with("</svg>\u{2013}") && !rings[3].contains("class=\"value\""));
        for ring in &rings[4..6] {
            assert!(
                ring.starts_with("none\" title=\"Noch nicht bewertet\"")
                    && ring.ends_with("</svg>"),
                "{ring}"
            );
        }
        assert_eq!(
            rings[6],
            format!("out\" title=\"Ausgeschlossen\">{TRACK}</svg>{BAN}")
        );
        assert!(!html.contains(">86<"));
        assert!(
            !STYLE.contains("stroke-dasharray"),
            "one solid track for every ring"
        );
    }

    /// An excluded favourite says why in words (never the code); one counted anyway says so
    /// and why the engine excludes it.
    #[test]
    fn an_exclusion_is_said_in_words() {
        let excluded = job(
            1,
            "A",
            Some(record(MatchStatus::Excluded, 86, Some("dayRate"))),
        );
        let mut counted = job(
            2,
            "B",
            Some(record(MatchStatus::Scored, 70, Some("permanent"))),
        );
        counted.override_include = true;
        let mut unknown = job(
            3,
            "C",
            Some(record(MatchStatus::Excluded, 50, Some("somethingNew"))),
        );
        unknown.pinned_at = Some(Timestamp::now());
        let html = render(
            &page(Vec::new(), vec![excluded, counted, unknown]),
            Timestamp::now(),
            &texts::DE,
        );
        assert!(
            html.contains("<p class=\"why\">Der Tagessatz liegt unter dem Minimum im Profil.</p>"),
            "{html}"
        );
        assert!(html.contains(
            "<p class=\"why\">Manuell einbezogen. Der Job ist eine Festanstellung, das Profil schließt sie aus.</p>"
        ));
        assert!(html.contains("<span class=\"band out\">Ausgeschlossen</span>"));
        assert!(!html.contains("dayRate") && !html.contains("somethingNew"));
        assert!(html.contains("<span class=\"star\" title=\"Favorit\">"));
    }

    /// Favourites never push the new matches out, and a job shows once: a favourite among
    /// the new matches stands in its band with its star.
    #[test]
    fn favourites_follow_the_bands_once() {
        let mut both = scored(1, "Beides", 90);
        both.pinned_at = Some(Timestamp::now());
        let mut read = scored(2, "Gelesen", 70);
        read.pinned_at = Some(Timestamp::now());
        let html = render(
            &page(vec![both.clone(), scored(3, "Neu", 60)], vec![both, read]),
            Timestamp::now(),
            &texts::DE,
        );
        assert_eq!(html.matches(">Beides<").count(), 1, "{html}");
        let pinned = html.find("<h2>Favoriten</h2>").unwrap();
        assert!(html.find(">Neu<").unwrap() < pinned && pinned < html.find(">Gelesen<").unwrap());
    }

    /// Without a usable profile: the app's sentence and the new jobs by date, no bands.
    #[test]
    fn without_a_profile_the_new_jobs_by_date() {
        let jobs = OverviewJobs {
            unscored: vec![job(1, "Erster", None), job(2, "Zweiter", None)],
            last_run: 1,
            ..OverviewJobs::default()
        };
        let html = render(&jobs, Timestamp::now(), &texts::DE);
        assert!(html.contains("<p class=\"note\">Ohne Profil gibt es keine Passung.</p>"));
        assert!(html.contains("<h2>Neue Jobs</h2>") && html.contains(">Erster<"));
        assert!(!html.contains("class=\"summary\"") && !html.contains("Hohe Passung"));
        assert!(html.find(">Erster<").unwrap() < html.find(">Zweiter<").unwrap());
        let none = render(&OverviewJobs::default(), Timestamp::now(), &texts::DE);
        assert!(none.contains("<p class=\"empty\">Keine neuen Jobs.</p>"));
    }

    /// Plain words (CLAUDE.md): no "Erfüllt: A", no dash in the title; the title the app shows.
    #[test]
    fn the_report_speaks_plainly() {
        let marked = scored(1, "Archiviertes Projekt - Senior Requirements Engineer", 70);
        let html = render(
            &page(vec![marked], Vec::new()),
            Timestamp::now(),
            &texts::DE,
        );
        assert!(html.contains(">Senior Requirements Engineer</a>"), "{html}");
        assert!(!html.contains(&format!("{}:", texts::HTML_MET)));
        assert!(!html.contains(" – ") && !html.contains(" - "), "{html}");
        assert!(html.contains(
            "<a href=\"https://www.linkedin.com/jobs/view/4000000001/\" target=\"_blank\" \
             rel=\"noopener noreferrer\">"
        ));
    }

    /// In English every word of the page is English; the job's own data stays as it came.
    #[test]
    fn the_report_in_english() {
        let at: Timestamp = "2026-09-19T12:05:00Z".parse().unwrap();
        let mut rated = scored(1, "Interim CFO", 83);
        rated.match_.as_mut().unwrap().facts = KeyFacts {
            rate: Some(1100),
            start: Some("now".into()),
            ..KeyFacts::default()
        };
        let html = render(
            &page(
                vec![rated],
                vec![job(
                    2,
                    "B",
                    Some(record(MatchStatus::Excluded, 86, Some("dayRate"))),
                )],
            ),
            at,
            &texts::EN,
        );
        assert!(html.contains("<html lang=\"en\">"), "{html}");
        for word in [
            "<h1>Report</h1>",
            "1 new matching job, 1 a high match.",
            "High match from 80",
            "3 of 4 must-haves met",
            "€1,100/day · starts now",
            "The day rate is below the minimum in the profile.",
            "Created on 19/09/2026 14:05",
            "Konzernabschluss",
            "<h2>Favourites</h2>",
        ] {
            assert!(html.contains(word), "{word}: {html}");
        }
        for german in ["Erfüllt", "Favoriten", "Tagessatz", "Erstellt", "Passung"] {
            assert!(!html.contains(german), "{german}: {html}");
        }
    }
}
