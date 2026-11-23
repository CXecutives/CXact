use super::*;
use crate::matching::facts::segments;
use crate::portal::Portal;

#[test]
fn work_modes_as_remote_wishes() {
    assert_eq!(RemoteWish::of(WorkWish::Any), None);
    assert_eq!(
        RemoteWish::of(WorkWish::Remote),
        Some(RemoteWish::Min(REMOTE_FULL))
    );
    assert_eq!(
        RemoteWish::of(WorkWish::Hybrid),
        Some(RemoteWish::Min(REMOTE_PARTLY))
    );
    assert_eq!(RemoteWish::of(WorkWish::Onsite), Some(RemoteWish::OnSite));
}

fn share(location: &str, text: &str, facts: Option<&Value>) -> Option<(u64, u64)> {
    let job = JobFacts {
        title: "Controller",
        text,
        location,
        portal: Portal::LinkedIn,
        facts,
        posted: None,
    };
    remote_share(&job, &segments(text), &fold(text))
}

#[test]
fn remote_shares_of_ads() {
    let s = |text: &str| share("Hamburg", text, None);
    assert_eq!(
        s("Einsatz zu 100 % remote aus Deutschland"),
        Some((100, 100))
    );
    assert_eq!(s("Remote: 80 %"), Some((80, 80)));
    assert_eq!(
        s("Einsatz zu 60 % remote, zwei Tage vor Ort in München"),
        Some((60, 60))
    );
    assert_eq!(s("Einsatz zu 100 % vor Ort in Hamburg"), Some((0, 0)));
    assert_eq!(s("80 % vor Ort, 20 % remote"), Some((20, 20)));
    assert_eq!(
        s("Hybrid: 3 days remote per week, 2 days on site"),
        Some((60, 60))
    );
    assert_eq!(
        s("Hybrides Arbeiten mit zwei Tagen im Homeoffice pro Woche"),
        Some((40, 40))
    );
    assert_eq!(
        s("Hybrid mit drei Tagen pro Woche vor Ort in Wiesbaden"),
        Some((40, 40))
    );
    assert_eq!(
        s("Einsatz vor Ort in Berlin, zwei Tage pro Woche"),
        Some((60, 60))
    );
    assert_eq!(
        s("Die Arbeit erfolgt überwiegend vor Ort, ein Remote-Anteil von bis zu 40 % ist möglich."),
        Some((40, 40))
    );
    assert_eq!(s("Hybrides Arbeiten nach Absprache"), Some(HYBRID_SHARE));
    assert_eq!(s("Remote möglich"), Some(REMOTE_NAMED_SHARE));
    assert_eq!(s("Remote und vor Ort beim Kunden"), Some(HYBRID_SHARE));
    assert_eq!(s("Einsatz vor Ort in Hamburg"), Some((0, 0)));
    assert_eq!(
        s("Remote ist nicht möglich, Einsatz beim Kunden"),
        Some((0, 0))
    );
    assert_eq!(
        s("Reisebereitschaft (ca. 20 %) und Erfahrung in der Automobilindustrie"),
        None
    );
    assert_eq!(s("30 Tage Urlaub"), None);
    assert_eq!(
        share("München (Remote)", "Controlling", None),
        Some((100, 100))
    );
    assert_eq!(
        share("Hamburg (Hybrid)", "Controlling", None),
        Some(HYBRID_SHARE)
    );
    let facts = json!({ "remotePercent": 40 });
    assert_eq!(
        share("Hamburg", "Einsatz zu 100 % remote", Some(&facts)),
        Some((40, 40))
    );
}

#[test]
fn places_in_the_order_the_text_names_them() {
    let places = Places::new(["bayern", "munchen", "frankfurt", "frankfurt am main"]);
    assert_eq!(
        places.first_named("munchen, bayern, deutschland"),
        Some("munchen")
    );
    assert_eq!(places.first_named("munchenstein, bayern"), Some("bayern"));
    assert_eq!(places.first_named("munchenstein"), None);
    assert_eq!(
        places.first_named("in frankfurt am main"),
        Some("frankfurt am main")
    );
    assert_eq!(places.first_named("frankfurt am mainz"), Some("frankfurt"));
    let signs = Places::new(["(berlin)", "berlin"]);
    assert_eq!(signs.first_named("x (berlin) berlin"), Some("(berlin)"));
    assert_eq!(signs.first_named("x(berlin) berlin"), Some("berlin"));
    assert_eq!(
        Places::new(["baden-baden"]).first_named("nach baden-baden"),
        Some("baden-baden")
    );
    assert_eq!(as_written("München, Bayern", "munchen"), "München");
    assert!(expand("bayern").contains(&"nurnberg".to_owned()));
    let germany = expand("deutschland");
    assert!(germany.contains(&"hamburg".to_owned()) && germany.contains(&"germany".to_owned()));
    assert!(expand("osterreich").contains(&"wien".to_owned()));
}

#[test]
fn tables_are_folded() {
    let folded = |w: &str| fold(w) == w;
    for (word, _) in lex::INDUSTRIES.iter().chain(lex::INDUSTRY_WORDS) {
        assert!(folded(word), "{word}");
    }
    for (region, places) in lex::REGION_PLACES {
        assert!(
            folded(region) && places.iter().all(|p| folded(p)),
            "{region}"
        );
    }
    for list in [
        lex::LEAD_WORDS,
        lex::LEVEL_WORDS,
        lex::ROLE_CONTRACT_WORDS,
        lex::REMOTE_AD_WORDS,
        lex::ONSITE_AD_WORDS,
        lex::REMOTE_NONE,
        lex::HYBRID_WORDS,
    ] {
        assert!(list.iter().all(|w| folded(w)), "{list:?}");
    }
    for (phrase, replacement) in lex::ROLE_WORD_PHRASES {
        assert!(folded(phrase) && folded(replacement), "{phrase}");
    }
}
