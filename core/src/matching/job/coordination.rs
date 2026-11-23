//! Coordinated items: parts that share an object or an activity.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// The class of each part of a line, classified once: one soft part among parts without a
/// known skill makes all of them soft (`verbindlich, pragmatisch und mit Freude am Detail`).
pub(super) fn part_classes(texts: &[String], level: Option<u8>, vocab: &Vocab) -> Vec<Class> {
    let classes: Vec<Class> = texts.iter().map(|t| classify(t, level, vocab)).collect();
    let soft_line = classes.contains(&Class::Soft)
        && texts
            .iter()
            .zip(&classes)
            .all(|(t, class)| *class == Class::Soft || !known_skill(t));
    classes
        .into_iter()
        .map(|class| match class {
            Class::Skill if soft_line => Class::Soft,
            class => class,
        })
        .collect()
}

/// The object a part shares with the next ones (`Erfahrung im Aufbau und in der Führung von
/// Vertriebsteams`: `im Aufbau` is of the sales teams too): a part that ends in a noun after
/// an activity preposition, followed by parts that start with one, takes the object the
/// last of them names (`von ...`), as a range of `phrase`.
pub(super) fn shared_objects(
    phrase: &str,
    parts: &[(Range<usize>, Vec<Range<usize>>)],
) -> Vec<Option<Range<usize>>> {
    let preposition = |w: &str| lex::ACTIVITY_PREPOSITIONS.contains(&w.to_lowercase().as_str());
    let words = |r: &Range<usize>| phrase[r.clone()].split_whitespace().collect::<Vec<&str>>();
    let bare_activity = |r: &Range<usize>| {
        let w = words(r);
        w.len() >= 2
            && w.last()
                .is_some_and(|l| l.chars().next().is_some_and(char::is_uppercase))
            && w[w.len().saturating_sub(3)..w.len() - 1]
                .iter()
                .any(|p| preposition(p))
    };
    let object = |r: &Range<usize>| -> Option<Range<usize>> {
        let w = words(r);
        if !w.first().is_some_and(|f| preposition(f)) {
            return None;
        }
        let opener = w.iter().skip(2).find(|x| lex::OBJECT_OPENERS.contains(x))?;
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
                .take_while(|(r, _)| words(r).first().is_some_and(|f| preposition(f)))
                .find_map(|(r, _)| object(r))
        })
        .collect()
}

/// Is `after` a second activity with an object (`Anwendung von Personas`) after a part that
/// ends in a bare activity (`Kenntnisse in der Erstellung`)? Both nouns of an activity
/// (`-ung`, `-ion`, `Aufbau`, `Analyse`).
pub(super) fn activity_pair(before: &[&str], after: &str) -> bool {
    let activity = |w: &str| {
        let folded = fold(w);
        w.chars().next().is_some_and(char::is_uppercase)
            && (folded.ends_with("ung")
                || folded.ends_with("ion")
                || lex::ACTIVITY_NOUNS.contains(&folded.as_str()))
    };
    let Some((last, rest)) = before.split_last() else {
        return false;
    };
    let bare = activity(last)
        && rest.iter().rev().take(3).any(|w| {
            let w = w.to_lowercase();
            lex::ACTIVITY_PREPOSITIONS.contains(&w.as_str()) || w == "mit"
        });
    let words: Vec<&str> = after
        .split_whitespace()
        .skip_while(|w| lex::ARTICLES.contains(&w.to_lowercase().as_str()))
        .collect();
    bare && words.first().is_some_and(|w| activity(w))
        && words[1..].iter().any(|w| lex::OBJECT_OPENERS.contains(w))
}

/// A declined German adjective written in lower case (`klassischen`, `organisatorische`,
/// `qualitativer`): an adjective stem with a declension ending.
pub(super) fn declined_adjective(word: &str) -> bool {
    word.chars().next().is_some_and(char::is_lowercase)
        && word.chars().all(char::is_alphabetic)
        && word.chars().count() >= 5
        && ["e", "en", "er", "es", "em"].iter().any(|ending| {
            word.strip_suffix(ending)
                .is_some_and(|stem| lex::ADJECTIVE_STEMS.iter().any(|s| stem.ends_with(s)))
        })
}

/// Is `after` a second object of the head noun that starts `before` (`Steuerung großer
/// IT-Projekte` and `externer Dienstleister`): both a lower-case adjective with the same
/// ending right after the head?
pub(super) fn coordinated_object(before: &[&str], after: &str) -> bool {
    let mut words = after.split_whitespace();
    let (Some(first), Some(_)) = (words.next(), words.next()) else {
        return false;
    };
    let head_is_noun = before
        .first()
        .and_then(|w| w.chars().next())
        .is_some_and(char::is_uppercase);
    let adjective = |w: &str| {
        w.chars().next().is_some_and(char::is_lowercase)
            && lex::DECLINED_ENDINGS.iter().any(|e| w.ends_with(e))
            && w.chars().count() > 4
    };
    head_is_noun
        && before.get(1).is_some_and(|w| adjective(w))
        && adjective(first)
        && lex::DECLINED_ENDINGS
            .iter()
            .any(|e| first.ends_with(e) && before[1].ends_with(e))
}
