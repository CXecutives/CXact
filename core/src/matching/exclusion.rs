//! Exclusion words of the profile (`ausschlusswoerter`): a word excludes the ad (decided)
//! where it names the job itself.
//!
//! - The title and the page's career level or employment type (LinkedIn's `Praktikum`):
//!   always.
//! - A word that names a kind of position (`lexicon::EXCLUSION_ROLE_WORDS`: `Werkstudent`,
//!   `Praktikum`, `Junior`, `Ausbildung`, a person noun such as `Absolvent`) in the ad's own
//!   text only where the ad states the offered role: next to a gender marker
//!   (`Werkstudent (m/w/d)`, `Werkstudent/in`), sought (`Wir suchen einen Praktikanten`,
//!   `Praktikant gesucht`), after a role label (`Stelle als`, `Position:`), offered
//!   (`für eine Werkstudententätigkeit`, `im Rahmen eines Praktikums`), or a short line that
//!   starts with it (`Praktikum im Finanzbereich`). Never in a passing mention: the team
//!   (`Team inkl. Werkstudenten`), the people one supervises, trains or mentors
//!   (`Betreuung von Praktikanten`), a denial, a requirement (`abgeschlossene Ausbildung`, a
//!   requirement line), an offer of the company (`Wir bieten jedes Jahr Praktika an`), or a
//!   compound about something else (`Praktikumsbetreuung`, `Ausbildungsbetrieb`).
//! - Any other word (a condition such as `Provisionsbasis`, `Rufbereitschaft`, `Callcenter`)
//!   in any sentence of the ad's own text, unless denied (`kein Schichtdienst`), about the team
//!   or the company (`1.600 Mitarbeitende im Innen- und Außendienst`), about supervising or
//!   training others (`Trainings für den Außendienst`) or a requirement of experience
//!   (`Erfahrung im Außendienst`).
//!
//! When unsure, a word does not exclude: a false exclusion hides a good job, a missed one
//! only costs a look. The reason highlights the deciding sentences.
//!
//! Whole words, case-insensitive, with the forms German gives them: a word matches its
//! inflections and the compounds it starts (`Werkstudent`: `Werkstudentin`, `Werkstudenten`,
//! `Werkstudentenstelle`), a long word also the compounds it ends (`Pflichtpraktikum`,
//! `Pflichtpraktikums`); a female form in the profile (`Werkstudentin`) matches the male one
//! too. Generated forms match as whole words with their inflections only, never as the start
//! of another word: the participle of an `-ent` noun (`Werkstudierende`), `-mann` as `-frau`
//! and `-leute` (`Kauffrauen`), `-um` as `-a` (`Praktika`, not `praktikable` or
//! `Praktikabilität`; `Zentrum` never `zentral`). The words of one family match each other
//! (`lexicon::EXCLUSION_WORD_FAMILIES`: `Praktikum` and `Praktikant`). A phrase matches word
//! by word or written as one word (`Call Center`, `Callcenter`).

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::sync::LazyLock;

use regex::Regex;
use serde_json::json;

use super::atoms::fold;
use super::facts::{Finding, HardCriteria, Segment};
use super::lexicon::engine as lex;
use super::types::{CriterionKey, ReasonCode};

/// Shortest form that also matches as the start of a longer word or with an inflection.
const PREFIX_MIN: usize = 4;
/// Shortest form that also matches as the end of a compound.
const SUFFIX_MIN: usize = 8;
/// Shortest `-ent` noun that also matches as a participle (`Student`, not `Agent`).
const PARTICIPLE_MIN: usize = 7;
/// Passages highlighted per word.
const SPANS_MAX: usize = 3;
/// Endings of an agent noun before a female ending (`Berater-in`, `Praktikant-in`).
const AGENT_ENDINGS: &[&str] = &["ent", "ant", "er", "or", "eur", "ist"];
/// Endings of a German inflection after a form (`Werkstudenten`, `Kauffrauen`, `Praktikums`).
const INFLECTIONS: &[&str] = &["e", "n", "s", "en", "er", "es", "em", "in", "innen"];
/// Endings after a form that leave it one person or one position (`Werkstudentin`,
/// `Praktikums`); `-en` is the plural or an object (`einen Praktikanten`).
const SINGULAR_ENDINGS: &[&str] = &["", "in", "s", "es"];
/// Linking parts between a position word and the head of its compound
/// (`Praktikum-s-platz`, `Werkstudent-en-stelle`).
const LINKS: &[&str] = &["", "s", "es", "en", "n", "e"];
/// Words before a position word in which a passing mention shows (the team, supervising).
const MENTION_REACH: usize = 3;
/// Words after a position word in which supervising shows (`Werkstudenten betreuen`).
const MENTION_AFTER_REACH: usize = 2;
/// Words between a hiring word and the role it seeks (`Wir suchen ab sofort eine/n ...`).
const HIRING_REACH: usize = 6;
/// Words between the role and a hiring word after it (`Praktikant Controlling gesucht`).
const HIRING_AFTER_REACH: usize = 4;
/// Words between a role label and the role (`Position: studentisches Praktikum`).
const LABEL_REACH: usize = 3;
/// Most words of a short line that names the role (`Praktikum im Finanzbereich`).
const ROLE_LINE_WORDS: usize = 6;
/// Words before a condition word in which a denial shows (`kein Schichtdienst`).
const DENIAL_REACH: usize = 2;
/// Words before a condition word in which the team, supervising or a requirement shows.
const OTHERS_REACH: usize = 4;

/// A gender marker right after a role: attached to its word (`Werkstudent*in`,
/// `Praktikant:in`, `Werkstudent/in`, `Werkstudent(in)`; not the plural `*innen`) or a group
/// close after it in the same clause (`(m/w/d)`, `(w/m/d)`, `(all genders)`, `m/w/d`).
static GENDER_MARKER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:\s?(?:\*|:|_|/-?|\()\s?in\b|[^,;()]{0,40}?(?:\(\s*(?:(?:[mwfdxi]|div|divers)\s*[/|,]\s*){1,3}(?:[mwfdxi]|div|divers)\s*\)|\(\s*(?:all genders|alle geschlechter|gn\*?|genderneutral)\s*\)|\b[mwf]\s*/\s*[mwf]\s*/\s*[dx]\b))",
    )
    .expect("gender marker")
});

/// One form of an exclusion word: its folded words; the last one carries the inflections.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Form {
    words: Vec<String>,
    /// The last word also matches the compounds it starts (`Werkstudentenstelle`). A
    /// generated form matches only as a word with its inflections (`Praktika`, never
    /// `praktikable`).
    open: bool,
    /// The form names one person or position (`Werkstudent`, `Kauffrau`), not several
    /// (`Praktika`, `Kaufleute`).
    singular: bool,
}

/// One exclusion word with its forms.
struct Word {
    text: String,
    forms: Vec<Form>,
    /// The word names a kind of position (`Werkstudent`), not a condition (`Schichtdienst`).
    role: bool,
}

impl Word {
    fn new(text: &str) -> Self {
        Self {
            text: text.to_owned(),
            forms: forms(text),
            role: role_word(text),
        }
    }

    /// Can a folded text hold the word? Every form's last word lies inside a word that holds
    /// it, so a text without any of them is skipped before it is split into words.
    fn may_hold(&self, folded: &str) -> bool {
        self.forms
            .iter()
            .any(|f| f.words.last().is_some_and(|w| folded.contains(w.as_str())))
    }
}

thread_local! {
    /// The exclusion words of the profile scored last on this thread, with their forms.
    static WORDS: RefCell<(Vec<String>, Rc<[Word]>)> = RefCell::new((Vec::new(), Rc::from([])));
}

/// The profile's exclusion words with their forms (a word without any form left out), built
/// once per profile and not again for every ad.
fn compiled(words: &[String]) -> Rc<[Word]> {
    WORDS.with(|memo| {
        let mut memo = memo.borrow_mut();
        if memo.0 != words {
            let built: Vec<Word> = words
                .iter()
                .map(|text| Word::new(text))
                .filter(|w| !w.forms.is_empty())
                .collect();
            *memo = (words.to_vec(), built.into());
        }
        Rc::clone(&memo.1)
    })
}

fn words(folded: &str) -> Vec<&str> {
    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect()
}

/// A word of a folded text with its byte range.
#[derive(Debug, Clone, Copy)]
struct Token<'t> {
    text: &'t str,
    start: usize,
    end: usize,
}

fn tokens(folded: &str) -> Vec<Token<'_>> {
    let mut out = Vec::new();
    let mut start = None;
    for (at, c) in folded.char_indices() {
        match (c.is_alphanumeric(), start) {
            (true, None) => start = Some(at),
            (false, Some(from)) => {
                out.push(Token {
                    text: &folded[from..at],
                    start: from,
                    end: at,
                });
                start = None;
            }
            _ => {}
        }
    }
    if let Some(from) = start {
        out.push(Token {
            text: &folded[from..],
            start: from,
            end: folded.len(),
        });
    }
    out
}

/// The word itself, the male form of a female or participle form and the other words of
/// its family.
fn bases(word: &str) -> Vec<String> {
    let mut out = vec![word.to_owned()];
    for ending in ["innen", "in"] {
        if let Some(stem) = word.strip_suffix(ending)
            && stem.chars().count() >= PREFIX_MIN
            && AGENT_ENDINGS.iter().any(|e| stem.ends_with(e))
        {
            out.push(stem.to_owned());
            break;
        }
    }
    for ending in ["ierenden", "ierende"] {
        if let Some(stem) = word.strip_suffix(ending)
            && stem.chars().count() >= 3
        {
            out.push(format!("{stem}ent"));
            break;
        }
    }
    for family in lex::EXCLUSION_WORD_FAMILIES {
        if out.iter().any(|b| family.contains(&b.as_str())) {
            for member in *family {
                if !out.iter().any(|b| b == member) {
                    out.push((*member).to_owned());
                }
            }
        }
    }
    out
}

/// A base (open, singular) with its generated forms (closed): (form, open, singular).
fn variants(base: &str) -> Vec<(String, bool, bool)> {
    let mut out = vec![(base.to_owned(), true, true)];
    if base.chars().count() >= PARTICIPLE_MIN
        && let Some(stem) = base.strip_suffix("ent")
    {
        out.push((format!("{stem}ierend"), false, false));
    }
    if let Some(stem) = base.strip_suffix("mann") {
        out.push((format!("{stem}frau"), false, true));
        out.push((format!("{stem}leute"), false, false));
    }
    if base.chars().count() > 5
        && let Some(stem) = base.strip_suffix("um")
    {
        out.push((format!("{stem}a"), false, false));
    }
    out
}

fn forms(word: &str) -> Vec<Form> {
    let folded = fold(word);
    let parts = words(&folded);
    let Some((last, head)) = parts.split_last() else {
        return Vec::new();
    };
    let mut out: Vec<Form> = Vec::new();
    for base in bases(last) {
        for (variant, open, singular) in variants(&base) {
            let mut phrase: Vec<String> = head.iter().map(|w| (*w).to_owned()).collect();
            phrase.push(variant);
            if !out.iter().any(|f| f.words == phrase) {
                out.push(Form {
                    words: phrase,
                    open,
                    singular,
                });
            }
        }
    }
    if parts.len() > 1 {
        out.push(Form {
            words: vec![parts.concat()],
            open: true,
            singular: true,
        });
    }
    out
}

/// Does the profile word name a kind of position (`Werkstudent`, `Praktikum`, `Junior`, a
/// person noun such as `Absolvent`)?
fn role_word(word: &str) -> bool {
    let folded = fold(word);
    let parts = words(&folded);
    let Some(last) = parts.last() else {
        return false;
    };
    let phrase = parts.join(" ");
    lex::EXCLUSION_ROLE_WORDS
        .iter()
        .any(|w| phrase.starts_with(w))
        || bases(last).iter().any(|base| {
            lex::EXCLUSION_ROLE_WORDS
                .iter()
                .any(|w| base.starts_with(w))
                || (lex::EXCLUSION_ROLE_ENDINGS
                    .iter()
                    .any(|e| base.ends_with(e))
                    && !base.ends_with("ment"))
        })
}

/// How a word of the text holds a word of a form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fit<'t> {
    /// The word itself, with an inflection or a female ending (`Werkstudenten`): the rest.
    Word(&'t str),
    /// A compound the word ends (`Pflichtpraktikum`, `Pflichtpraktikums`): the inflection.
    Head(&'t str),
    /// A compound the word starts (`Werkstudentenstelle`): the rest.
    Modifier(&'t str),
}

/// Does a word of the text match a word of a form (`open`: also as the start of a compound)?
fn fit<'t>(text: &'t str, form: &str, open: bool) -> Option<Fit<'t>> {
    let len = form.chars().count();
    if text == form {
        return Some(Fit::Word(""));
    }
    if len >= PREFIX_MIN
        && let Some(rest) = text.strip_prefix(form)
    {
        if INFLECTIONS.contains(&rest) {
            return Some(Fit::Word(rest));
        }
        if open {
            return Some(Fit::Modifier(rest));
        }
    }
    if len >= SUFFIX_MIN {
        for ending in std::iter::once("").chain(INFLECTIONS.iter().copied()) {
            if let Some(stem) = text.strip_suffix(ending)
                && stem.len() > form.len()
                && stem.ends_with(form)
            {
                return Some(Fit::Head(ending));
            }
        }
    }
    None
}

/// The head of a compound after a position word that names the position itself
/// (`Werkstudentenstelle`): `Some(true)` for one position, `Some(false)` for several
/// (`Werkstudentenstellen`).
fn role_head(rest: &str) -> Option<bool> {
    LINKS.iter().find_map(|link| {
        let head = rest.strip_prefix(link)?;
        lex::EXCLUSION_ROLE_HEADS.iter().find_map(|h| {
            let plural = head
                .strip_prefix(h)
                .filter(|r| ["n", "en", "s", "e"].contains(r));
            (head == *h).then_some(true).or(plural.map(|_| false))
        })
    })
}

/// One occurrence of an exclusion word: the tokens it spans and how its last word holds it.
#[derive(Debug, Clone, Copy)]
struct Hit<'t> {
    first: usize,
    last: usize,
    fit: Fit<'t>,
    singular_form: bool,
}

impl Hit<'_> {
    /// The occurrence names the position itself: the word, a compound it ends, or a compound
    /// it starts whose head is a position (`Werkstudentenstelle`, not `Praktikumsbetreuung`).
    fn names_role(&self) -> bool {
        match self.fit {
            Fit::Word(_) | Fit::Head(_) => true,
            Fit::Modifier(rest) => role_head(rest).is_some(),
        }
    }

    /// One person or one position (`Praktikum`, `Werkstudentin`, `Werkstudentenstelle`).
    fn singular(&self) -> bool {
        match self.fit {
            Fit::Word(rest) | Fit::Head(rest) => {
                self.singular_form && SINGULAR_ENDINGS.contains(&rest)
            }
            Fit::Modifier(rest) => role_head(rest) == Some(true),
        }
    }
}

/// Every occurrence of the word in the tokens of a text.
fn hits<'t>(tokens: &[Token<'t>], word: &Word) -> Vec<Hit<'t>> {
    let mut out = Vec::new();
    for form in &word.forms {
        let n = form.words.len();
        if n == 0 || tokens.len() < n {
            continue;
        }
        for first in 0..=tokens.len() - n {
            // The words before the last one of a phrase match as prefixes.
            let heads_fit = form.words[..n - 1]
                .iter()
                .zip(&tokens[first..])
                .all(|(f, t)| fit(t.text, f, true).is_some());
            if !heads_fit {
                continue;
            }
            if let Some(last_fit) = fit(tokens[first + n - 1].text, &form.words[n - 1], form.open) {
                out.push(Hit {
                    first,
                    last: first + n - 1,
                    fit: last_fit,
                    singular_form: form.singular,
                });
            }
        }
    }
    out
}

/// Does the folded text contain the word in one of its forms?
fn found(folded: &str, word: &Word) -> bool {
    word.may_hold(folded) && !hits(&tokens(folded), word).is_empty()
}

/// One sentence of the ad's own text, read for the exclusion words.
struct Sentence<'s, 't> {
    folded: &'s str,
    tokens: &'s [Token<'t>],
    /// The sentence lies in a requirement line (`Ihr Profil`).
    requirement: bool,
}

impl Sentence<'_, '_> {
    /// No `,` or `;` between two token positions (the same clause).
    fn joined(&self, from: usize, to: usize) -> bool {
        let (a, b) = (from.min(to), from.max(to));
        a == b || !self.folded[self.tokens[a].end..self.tokens[b].start].contains([',', ';'])
    }

    fn text(&self, i: usize) -> &str {
        self.tokens[i].text
    }

    /// Tokens up to `reach` before `at` in the same clause, nearest first.
    fn before(&self, at: usize, reach: usize) -> impl Iterator<Item = usize> + '_ {
        (at.saturating_sub(reach)..at)
            .rev()
            .take_while(move |&k| self.joined(k, at))
    }

    /// Tokens up to `reach` after `at` in the same clause.
    fn after(&self, at: usize, reach: usize) -> impl Iterator<Item = usize> + '_ {
        (at + 1..=(at + reach).min(self.tokens.len().saturating_sub(1)))
            .take_while(move |&k| self.joined(at, k))
    }

    /// Does the ad state the offered role with this occurrence of a position word?
    fn states_role(&self, hit: &Hit<'_>) -> bool {
        hit.names_role()
            && !self.requirement
            && !self.mention(hit)
            && (self.marked(hit)
                || self.sought(hit)
                || self.labelled(hit)
                || self.offered(hit)
                || self.role_line(hit))
    }

    /// A passing mention: the team, the people one supervises, a denial, a requirement, an
    /// offer of the company. The words before stop at a hiring word or `als` (`Unser Team
    /// sucht einen Junior`, `Mitarbeit als Werkstudent`).
    fn mention(&self, hit: &Hit<'_>) -> bool {
        let starts = |t: &str, list: &[&str]| list.iter().any(|w| t.starts_with(w));
        let before = self
            .before(hit.first, MENTION_REACH)
            .take_while(|&k| {
                let t = self.text(k);
                !lex::EXCLUSION_HIRING_BEFORE.contains(&t) && t != "als" && t != "as"
            })
            .any(|k| {
                let t = self.text(k);
                starts(t, lex::EXCLUSION_MENTION_BEFORE)
                    || lex::EXCLUSION_MENTION_BEFORE_WHOLE.contains(&t)
            });
        let after = self
            .after(hit.last, MENTION_AFTER_REACH)
            .any(|k| starts(self.text(k), lex::EXCLUSION_MENTION_AFTER));
        // `für Werkstudenten`, `für die Praktikanten`: for others
        // (`für eine Werkstudententätigkeit` offers the role).
        let for_others = (1..=2).any(|back| {
            let Some(k) = hit.first.checked_sub(back) else {
                return false;
            };
            let article = back == 2 && !lex::INDEFINITE_ARTICLES.contains(&self.text(k + 1));
            ["fur", "for"].contains(&self.text(k)) && (back == 1 || article)
        });
        before || after || for_others
    }

    /// A gender marker on the role (`Werkstudent/in`, `Werkstudent Controlling (m/w/d)`).
    fn marked(&self, hit: &Hit<'_>) -> bool {
        GENDER_MARKER.is_match(&self.folded[self.tokens[hit.last].end..])
    }

    /// Sought: after a hiring word (`Wir suchen ab sofort eine/n Praktikant/in`) or before one
    /// (`Werkstudent Controlling gesucht`), in the same clause.
    fn sought(&self, hit: &Hit<'_>) -> bool {
        let looking_for =
            |k: usize| self.text(k) == "for" && k > 0 && self.text(k - 1) == "looking";
        let before = self
            .before(hit.first, HIRING_REACH)
            .any(|k| lex::EXCLUSION_HIRING_BEFORE.contains(&self.text(k)) || looking_for(k));
        let after = self
            .after(hit.last, HIRING_AFTER_REACH)
            .any(|k| lex::EXCLUSION_HIRING_AFTER.contains(&self.text(k)));
        before || after
    }

    /// After a role label: `Stelle als Werkstudent`, `Position: Praktikum`.
    fn labelled(&self, hit: &Hit<'_>) -> bool {
        let as_role = self.before(hit.first, LABEL_REACH).any(|k| {
            ["als", "as"].contains(&self.text(k))
                && k > 0
                && self.joined(k - 1, k)
                && lex::EXCLUSION_ROLE_AS.contains(&self.text(k - 1))
        });
        let field = self.folded.find(':').is_some_and(|colon| {
            let label = self.folded[..colon]
                .trim_start_matches(|c: char| !c.is_alphanumeric())
                .trim();
            let after_colon = self.tokens[..hit.first]
                .iter()
                .filter(|t| t.start > colon)
                .count();
            self.tokens[hit.first].start > colon
                && after_colon < LABEL_REACH
                && lex::EXCLUSION_ROLE_FIELDS.contains(&label)
        });
        as_role || field
    }

    /// Offered with an indefinite article: `für eine Werkstudententätigkeit`, `im Rahmen
    /// eines Pflichtpraktikums`.
    fn offered(&self, hit: &Hit<'_>) -> bool {
        (1..=2).any(|back| {
            let Some(article) = hit.first.checked_sub(back) else {
                return false;
            };
            article > 0
                && self.joined(article - 1, hit.first)
                && lex::INDEFINITE_ARTICLES.contains(&self.text(article))
                && lex::EXCLUSION_ROLE_FOR.contains(&self.text(article - 1))
        })
    }

    /// A short line that starts with one role (`Praktikum im Finanzbereich`,
    /// `Junior-Level`), not a list (`Ausbildung und Personalentwicklung`) or others
    /// (`Ausbildung der Auszubildenden`).
    fn role_line(&self, hit: &Hit<'_>) -> bool {
        hit.first == 0
            && hit.singular()
            && self.tokens.len() <= ROLE_LINE_WORDS
            && !self.folded.contains([',', '&'])
            && !self.tokens[hit.last + 1..]
                .iter()
                .any(|t| lex::EXCLUSION_LINE_BREAKERS.contains(&t.text))
    }

    /// A condition word in a passing mention: denied, about the team or the company, about
    /// supervising or training others, or a requirement of experience.
    fn passing(&self, hit: &Hit<'_>) -> bool {
        let denied = self
            .before(hit.first, DENIAL_REACH)
            .any(|k| lex::DENIALS.contains(&self.text(k)));
        let others = self.before(hit.first, OTHERS_REACH).any(|k| {
            let t = self.text(k);
            lex::EXCLUSION_OTHERS.iter().any(|w| t.starts_with(w))
                || lex::EXCLUSION_OTHERS_PARTS.iter().any(|w| t.contains(w))
                || lex::EXCLUSION_REQUIREMENT_WORDS.contains(&t)
        });
        denied || others
    }
}

/// Does this sentence name the job itself with the word?
fn decides(folded: &str, requirement: bool, word: &Word) -> bool {
    if !word.may_hold(folded) {
        return false;
    }
    let tokens = tokens(folded);
    let sentence = Sentence {
        folded,
        tokens: &tokens,
        requirement,
    };
    hits(&tokens, word).iter().any(|hit| {
        if word.role {
            sentence.states_role(hit)
        } else {
            !sentence.passing(hit)
        }
    })
}

/// A decided exclusion for every exclusion word that names the job itself: in the title, in
/// the page's career level or employment type (`levels`, folded), or in a sentence of the
/// ad's own text as the module describes (`exclusionWord {word}`, with those sentences).
/// `requirement_lines` are the byte ranges of the ad's requirement lines.
pub(crate) fn check(
    criteria: &HardCriteria,
    title: &str,
    levels: &[String],
    segments: &[Segment],
    requirement_lines: &[Range<usize>],
) -> Vec<Finding> {
    if criteria.exclusion_words.is_empty() {
        return Vec::new();
    }
    let title = fold(title);
    let in_requirements = |range: &Range<usize>| {
        requirement_lines
            .iter()
            .any(|line| line.start < range.end && range.start < line.end)
    };
    compiled(&criteria.exclusion_words)
        .iter()
        .filter_map(|word| {
            let spans: Vec<Range<usize>> = segments
                .iter()
                .filter(|(range, f)| decides(f, in_requirements(range), word))
                .map(|(range, _)| range.clone())
                .take(SPANS_MAX)
                .collect();
            let named = found(&title, word) || levels.iter().any(|l| found(l, word));
            (named || !spans.is_empty()).then(|| {
                Finding::new(
                    ReasonCode::ExclusionWord,
                    true,
                    Some(CriterionKey::ExclusionWords),
                    json!({ "word": word.text }),
                    spans,
                )
            })
        })
        .collect()
}

#[cfg(test)]
mod tests;
