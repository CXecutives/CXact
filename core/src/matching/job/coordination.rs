//! Coordinated items: where an `und`, `and`, `&` or a comma parts two requirements, and every
//! part written out in full: a hyphen ellipsis completed with the head or the modifier it
//! shares (`Risiko- und Qualitätsmanagement`, `Projektplanung und -controlling`), a bare
//! activity with the object of the next one (`im Aufbau und in der Führung von Teams`).

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// The class of each part of a line, classified once: one soft part among parts without a
/// known skill makes all of them soft (`verbindlich, pragmatisch und mit Freude am Detail`),
/// and so are the bare parts after an interest, its further objects (the automation and the
/// innovations of `Interesse an KI, Automatisierung und digitalen Innovationen`), up to a
/// part with a word of knowledge of its own.
pub(super) fn part_classes(texts: &[String], level: Option<u8>, vocab: &Vocab) -> Vec<Class> {
    let classes: Vec<Class> = texts.iter().map(|t| classify(t, level, vocab)).collect();
    let soft_line = classes.contains(&Class::Soft)
        && texts
            .iter()
            .zip(&classes)
            .all(|(t, class)| *class == Class::Soft || !known_skill(t));
    let mut interest = false;
    texts
        .iter()
        .zip(classes)
        .map(|(text, class)| {
            let folded = fold(text);
            interest = soft_lead(&folded)
                || (interest && class == Class::Skill && !names_knowledge(&folded));
            match class {
                Class::Skill if soft_line || interest => Class::Soft,
                class => class,
            }
        })
        .collect()
}

/// The AND separators that really part two requirements. The two sides of a separator stay
/// one requirement inside a fixed phrase (`in Wort und Schrift`) or a skill term
/// (`Compensation & Benefits`), before a comma tail or a relative clause (`gerne auch`, `die
/// ...` after a comma), between the bare nouns listed after a word of working together
/// (`Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern`), between two objects
/// of one head declined alike (`Steuerung großer IT-Projekte und externer Dienstleister`) or two
/// activities that share one object (see [`activity_pair`]), after
/// an adjective that shares the next part's noun (`klassische und agile Methoden`) and before a
/// trailing ellipsis whose modifier is unknown.
pub(super) fn joined(phrase: &str, seps: &[Range<usize>]) -> Vec<Range<usize>> {
    let lower = phrase.to_lowercase();
    let protected: Vec<Range<usize>> = lex::PROTECTED_PHRASES
        .iter()
        .flat_map(|p| lower.match_indices(p).map(|(at, m)| at..at + m.len()))
        .collect();
    let mut kept: Vec<Range<usize>> = Vec::new();
    let mut listing = false;
    for (i, sep) in seps.iter().enumerate() {
        let inside = protected
            .iter()
            .any(|p| p.start <= sep.start && sep.end <= p.end);
        let rest = lower.get(sep.end..).unwrap_or("");
        let comma = phrase[sep.clone()].starts_with(',');
        let tail = comma
            && (lex::COMMA_TAILS
                .iter()
                .chain(lex::PROTECTED_PHRASES)
                .any(|t| rest.starts_with(t))
                || relative_clause(&phrase[sep.end..]));
        // The part before this separator, and the part after it (up to the next one).
        let before_start = if i == 0 { 0 } else { seps[i - 1].end };
        let before = phrase.get(before_start..sep.start).unwrap_or("");
        let after_end = seps.get(i + 1).map_or(phrase.len(), |s| s.start);
        let after = phrase.get(sep.end..after_end).unwrap_or("");
        if lex::LIST_OBJECT_WORDS
            .iter()
            .any(|w| before.to_lowercase().contains(w))
        {
            listing = true;
        }
        // Only a bare noun after the list word keeps the list together.
        listing = listing && after.split_whitespace().count() == 1 && !known_skill(after);
        let before_words: Vec<&str> = before.split_whitespace().collect();
        let term = before_words.last().is_some_and(|last| {
            let first = after.split_whitespace().next().unwrap_or("");
            sections::skill_term(&fold(&format!("{last} {first}")))
        });
        let ellipsis = after.starts_with('-') && trailing_ellipsis(before, after).is_none();
        if inside
            || tail
            || listing
            || term
            || ellipsis
            || coordinated_object(&before_words, after)
            || activity_pair(&before_words, after)
            || shares_noun(&before_words, after)
        {
            continue;
        }
        kept.push(sep.clone());
    }
    kept
}

/// Does a clause after a comma refer back to what stands before it? It does after a relative
/// word (`which`, `in denen`) or an article before a word in lower case
/// (`die die Zusammenarbeit fördern`), not after an article before a noun (`die Fähigkeit`).
fn relative_clause(after: &str) -> bool {
    let words: Vec<String> = after.split_whitespace().take(3).map(fold).collect();
    let word = |i: usize| words.get(i).map_or("", String::as_str);
    let relative = |i: usize| {
        lex::RELATIVE_WORDS.contains(&word(i))
            || (lex::ARTICLES.contains(&word(i))
                && after.split_whitespace().nth(i + 1).is_some_and(|next| {
                    next.starts_with(char::is_lowercase)
                        || lex::PRONOUN_STARTS.contains(&fold(next).as_str())
                }))
    };
    relative(0) || (lex::CLAUSE_PREPOSITIONS.contains(&word(0)) && relative(1))
}

/// Is the part before a separator an adjective that shares the noun of the part after it: the
/// part one adjective (`Classic and agile project management`) or a part that ends in a
/// declined adjective in lower case (`Kenntnisse in klassischen und agilen Methoden`), before a
/// part of a noun phrase that goes on in lower case?
fn shares_noun(before: &[&str], after: &str) -> bool {
    let Some(last) = before.last() else {
        return false;
    };
    let adjective = fold(last).chars().all(char::is_alphabetic)
        && (before.len() == 1 && adjective(&fold(last)) || declined_adjective(last));
    let mut next = after.split_whitespace();
    adjective
        && next
            .next()
            .is_some_and(|w| before.len() == 1 || w.starts_with(char::is_lowercase))
        && next.next().is_some()
}

/// A declined German adjective written in lower case (`klassischen`, `organisatorische`,
/// `qualitativer`): an adjective stem with a declension ending.
fn declined_adjective(word: &str) -> bool {
    word.chars().next().is_some_and(char::is_lowercase)
        && word.chars().count() >= 5
        && lex::DECLENSION_ENDINGS
            .iter()
            .any(|ending| word.strip_suffix(ending).is_some_and(adjective))
}

/// A word that ends like an adjective, declined or not (`klassisch`, `agile`, `technical`).
fn adjective(word: &str) -> bool {
    let stem = |w: &str| lex::ADJECTIVE_STEMS.iter().any(|s| w.ends_with(s));
    stem(word)
        || lex::DECLENSION_ENDINGS
            .iter()
            .any(|e| word.strip_suffix(e).is_some_and(stem))
}

/// Is `after` a second object of the head noun that starts `before` (`Steuerung großer
/// IT-Projekte` and `externer Dienstleister`): both a lower-case adjective with the same
/// ending right after the head?
fn coordinated_object(before: &[&str], after: &str) -> bool {
    let mut words = after.split_whitespace();
    let (Some(first), Some(_)) = (words.next(), words.next()) else {
        return false;
    };
    let ending = |w: &str| {
        lex::DECLENSION_ENDINGS
            .iter()
            .find(|e| w.starts_with(char::is_lowercase) && w.ends_with(*e) && w.chars().count() > 4)
    };
    before
        .first()
        .is_some_and(|w| w.starts_with(char::is_uppercase))
        && before
            .get(1)
            .is_some_and(|w| ending(w).is_some() && ending(w) == ending(first))
}

/// A part written out in full: a modifier of a leading hyphen ellipsis completed with the head
/// of the word after it (`Erfahrung im Risiko-` before `und Qualitätsmanagement` reads
/// `Erfahrung im Risikomanagement`; `HW-` before `SW-Entwicklung` reads `HW-Entwicklung`), a
/// trailing ellipsis with the modifier of the word before it (`-controlling` after
/// `Projektplanung` reads `Projektcontrolling`); `None` when the part is no ellipsis or its
/// head is unknown.
pub(super) fn written_out(part: &str, before: &str, after: &str) -> Option<String> {
    leading_ellipsis(part, after).or_else(|| trailing_ellipsis(before, part))
}

/// [`written_out`] of a leading ellipsis: `part` ends in the modifier, `rest` is the text after
/// it.
pub(super) fn leading_ellipsis(part: &str, rest: &str) -> Option<String> {
    let modifier = part.trim_end().strip_suffix('-')?;
    if modifier.is_empty() || modifier.ends_with(char::is_whitespace) {
        return None;
    }
    let word = rest
        .split(|c: char| c.is_whitespace() || c == ',' || c == '/')
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric() && c != '-'))
        .find(|w| {
            !w.is_empty() && !w.ends_with('-') && !lex::ELLIPSIS_JOINERS.contains(&fold(w).as_str())
        })?;
    if let Some((_, last)) = word.rsplit_once('-') {
        return (!last.is_empty()).then(|| format!("{modifier}-{last}"));
    }
    let folded = fold(word);
    let head = written_head(word, atoms::compound_head(&folded)?);
    Some(format!("{modifier}{head}"))
}

/// [`written_out`] of a trailing ellipsis: `part` starts with the hyphen (`-controlling`),
/// `before` ends in the word whose modifier it shares.
fn trailing_ellipsis(before: &str, part: &str) -> Option<String> {
    let head = part.trim_start().strip_prefix('-')?;
    let word = trim_joints(before).split_whitespace().last()?;
    let folded = fold(word);
    let shared = atoms::compound_head(&folded)?.chars().count();
    let modifier: String = word
        .chars()
        .take(word.chars().count().saturating_sub(shared))
        .collect();
    let first = head.split_whitespace().next()?;
    (!first.is_empty()).then(|| format!("{modifier}{head}"))
}

/// The head as the word writes it (`Qualitätsmanagement` gives `management`, an umlaut kept).
fn written_head(word: &str, head: &str) -> String {
    let chars: Vec<char> = word.chars().collect();
    let n = head.chars().count();
    let written: String = chars[chars.len().saturating_sub(n)..].iter().collect();
    if fold(&written) == head {
        written
    } else {
        head.to_owned()
    }
}

/// The object a part shares with the next ones (the build-up of the sales teams in
/// `Erfahrung im Aufbau und in der Führung von Vertriebsteams`): a part that ends in an
/// activity after a preposition, followed by parts that start with a preposition, takes the
/// object the first of them names (`von ...`), as a range of `phrase`.
pub(super) fn shared_objects(
    phrase: &str,
    parts: &[(Range<usize>, Vec<Range<usize>>)],
) -> Vec<Option<Range<usize>>> {
    let preposition = |w: &str| lex::ACTIVITY_PREPOSITIONS.contains(&w.to_lowercase().as_str());
    let words = |r: &Range<usize>| phrase[r.clone()].split_whitespace().collect::<Vec<&str>>();
    let bare_activity = |r: &Range<usize>| bare_activity(&words(r), 2);
    let opens = |r: &Range<usize>| words(r).first().is_some_and(|w| preposition(w));
    let object = |r: &Range<usize>| -> Option<Range<usize>> {
        if !opens(r) {
            return None;
        }
        let opener = words(r)
            .into_iter()
            .skip(1)
            .find(|x| lex::OBJECT_OPENERS.contains(x))?;
        let at = opener.as_ptr() as usize - phrase.as_ptr() as usize;
        Some(at..r.end)
    };
    (0..parts.len())
        .map(|i| {
            let (part, _) = &parts[i];
            if !bare_activity(part) || object(part).is_some() {
                return None;
            }
            parts[i + 1..]
                .iter()
                .take_while(|(r, _)| opens(r))
                .find_map(|(r, _)| object(r))
        })
        .collect()
}

/// Two activities that share the object the second one names, one requirement (the drafts of
/// personas in `Kenntnisse in der Erstellung und Anwendung von Personas`): `before` ends in an
/// activity after a preposition, `after` is an activity with its object.
fn activity_pair(before: &[&str], after: &str) -> bool {
    let bare = bare_activity(before, 3);
    let words: Vec<&str> = after
        .split_whitespace()
        .skip_while(|w| lex::ARTICLES.contains(&w.to_lowercase().as_str()))
        .collect();
    bare && words.first().is_some_and(|w| activity(w))
        && words[1..].iter().any(|w| lex::OBJECT_OPENERS.contains(w))
}

/// Do the words end in an activity after a preposition among the `reach` words before it
/// (`im Aufbau`, `in der Erstellung`; with a reach of three also `mit`)?
fn bare_activity(words: &[&str], reach: usize) -> bool {
    let Some((last, rest)) = words.split_last() else {
        return false;
    };
    activity(last)
        && rest.iter().rev().take(reach).any(|w| {
            let w = w.to_lowercase();
            lex::ACTIVITY_PREPOSITIONS.contains(&w.as_str()) || (reach > 2 && w == "mit")
        })
}

/// A noun of an activity (`-ung`, `-ion`, `Aufbau`, `Analyse`), written as a noun.
fn activity(word: &str) -> bool {
    let folded = fold(word);
    word.chars().next().is_some_and(char::is_uppercase)
        && (folded.ends_with("ung")
            || folded.ends_with("ion")
            || lex::ACTIVITY_NOUNS.contains(&folded.as_str()))
}
