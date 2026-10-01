//! A source's robots.txt (user decision 2026-10-01): the app's own search and the pages of the
//! sources that ask for it are requested only where the rules for every agent (`*`) allow it.
//! The rules of the group `User-agent: *` count (the app sends a browser's agent and claims no
//! crawler's name); `Allow` and `Disallow` match the path with its query from the start, `*`
//! stands for any text and `$` for the end; the longest matching rule wins, `Allow` on a tie.
//! An empty `Disallow` allows everything; a source without a robots.txt allows everything.
//! A `Crawl-delay` of the group is the least gap between two requests to the source (at most
//! [`MAX_CRAWL_DELAY`] seconds are believed).

use serde::{Deserialize, Serialize};

/// The rules of the group for every agent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Robots {
    pub allow: Vec<String>,
    pub disallow: Vec<String>,
    /// The least gap between two requests the group asks for, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crawl_delay: Option<u64>,
}

/// A longer `Crawl-delay` is taken as this one: a source that wants an hour between requests
/// would never be searched (it may disallow the paths instead).
pub const MAX_CRAWL_DELAY: u64 = 60;

impl Robots {
    /// The rules of `User-agent: *` in a robots.txt (several such groups count together).
    pub fn parse(text: &str) -> Robots {
        let mut robots = Robots::default();
        // The agents of the group being read, and whether a rule ended its agent lines.
        let mut agents: Vec<String> = Vec::new();
        let mut in_rules = false;
        for line in text.lines() {
            let line = line.split('#').next().unwrap_or_default().trim();
            let Some((field, value)) = line.split_once(':') else {
                continue;
            };
            let (field, value) = (field.trim().to_ascii_lowercase(), value.trim());
            match field.as_str() {
                "user-agent" => {
                    if in_rules {
                        agents.clear();
                        in_rules = false;
                    }
                    agents.push(value.to_ascii_lowercase());
                }
                "allow" | "disallow" => {
                    in_rules = true;
                    if !agents.iter().any(|agent| agent == "*") || value.is_empty() {
                        continue;
                    }
                    let rules = if field == "allow" {
                        &mut robots.allow
                    } else {
                        &mut robots.disallow
                    };
                    rules.push(value.to_owned());
                }
                "crawl-delay" => {
                    in_rules = true;
                    if !agents.iter().any(|agent| agent == "*") {
                        continue;
                    }
                    // Whole or fractional seconds; the longest delay of the groups counts.
                    if let Ok(seconds) = value.parse::<f64>()
                        && seconds.is_finite()
                        && seconds > 0.0
                    {
                        #[expect(
                            clippy::cast_possible_truncation,
                            clippy::cast_sign_loss,
                            reason = "a positive, finite number of seconds, capped below"
                        )]
                        let seconds = (seconds.ceil() as u64).min(MAX_CRAWL_DELAY);
                        robots.crawl_delay = robots.crawl_delay.max(Some(seconds));
                    }
                }
                _ => {}
            }
        }
        robots
    }

    /// Whether `path` (with its query, as `/a/b?c=d`) may be requested.
    pub fn allows(&self, path: &str) -> bool {
        let longest = |rules: &[String]| {
            rules
                .iter()
                .filter(|rule| matches(rule, path))
                .map(String::len)
                .max()
        };
        match (longest(&self.allow), longest(&self.disallow)) {
            (_, None) => true,
            (None, Some(_)) => false,
            (Some(allow), Some(disallow)) => allow >= disallow,
        }
    }
}

/// A rule against a path: from the start, `*` for any text, `$` at the end for the end.
fn matches(rule: &str, path: &str) -> bool {
    let (rule, anchored) = match rule.strip_suffix('$') {
        Some(rule) => (rule, true),
        None => (rule, false),
    };
    let parts: Vec<&str> = rule.split('*').collect();
    let mut at = 0;
    for (index, part) in parts.iter().enumerate() {
        if index == 0 {
            if !path.starts_with(part) {
                return false;
            }
            at = part.len();
            continue;
        }
        let last = index == parts.len() - 1;
        if last && anchored {
            return path.len() >= at + part.len() && path.ends_with(part);
        }
        match path[at..].find(part) {
            Some(found) => at += found + part.len(),
            None => return false,
        }
    }
    !anchored || at == path.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rules of the sources as they stood on 2026-10-01 (shortened).
    const HAYS: &str = "User-agent: *\nDisallow: /en-GB/\nDisallow: /web/\nDisallow: /meinhays/\n\
                        Disallow: /*?doAsUserId=\nDisallow: /login/\nUser-agent: GPTBot\nAllow: /\n";
    const GULP: &str = "User-agent: *\nAllow: /core/*.css$\nDisallow: /core/\n\
                        Disallow: /cgi-gulpsearch/\n";
    const LINKEDIN: &str = "User-agent: Googlebot\nAllow: /jobs/\n\nUser-agent: *\nDisallow: /\n";

    #[test]
    fn the_group_for_every_agent_decides() {
        let hays = Robots::parse(HAYS);
        assert!(hays.allows("/jobsuche/stellenangebote-jobs?q=interim&joblevel=3"));
        assert!(hays.allows("/jobsuche/stellenangebote-jobs-detail-cfo-hamburg-891480/1"));
        assert!(!hays.allows("/meinhays/profil"));
        assert!(!hays.allows("/jobsuche/x?doAsUserId=7"));
        // Another agent's group says nothing about the app.
        let linkedin = Robots::parse(LINKEDIN);
        assert!(!linkedin.allows("/jobs/view/123"));
        let gulp = Robots::parse(GULP);
        assert!(!gulp.allows("/cgi-gulpsearch/search?q=sap"));
        assert!(gulp.allows("/core/theme.css"));
        assert!(!gulp.allows("/core/theme.css?v=2"));
        assert!(gulp.allows("/projekte/123"));
    }

    #[test]
    fn a_crawl_delay_of_the_group_for_every_agent_counts() {
        let rules = Robots::parse(
            "User-agent: Bingbot
Crawl-delay: 30

User-agent: *
Crawl-delay: 2.5
Disallow: /x",
        );
        assert_eq!(rules.crawl_delay, Some(3));
        assert!(!rules.allows("/x"));
        assert_eq!(
            Robots::parse(
                "User-agent: *
Crawl-delay: 9000"
            )
            .crawl_delay,
            Some(60)
        );
        assert_eq!(
            Robots::parse(
                "User-agent: *
Crawl-delay: soon"
            )
            .crawl_delay,
            None
        );
        assert_eq!(
            Robots::parse(
                "User-agent: *
Disallow:"
            )
            .crawl_delay,
            None
        );
    }

    #[test]
    fn empty_rules_and_comments() {
        let open = Robots::parse("User-agent: *\nDisallow:\n# Disallow: /\n");
        assert_eq!(open, Robots::default());
        assert!(open.allows("/anything"));
        assert!(Robots::parse("").allows("/"));
        // The longest rule wins, Allow on a tie.
        let rules =
            Robots::parse("User-agent: *\nDisallow: /p\nAllow: /p/ok\nAllow: /x\nDisallow: /x");
        assert!(rules.allows("/p/ok/1"));
        assert!(!rules.allows("/p/no"));
        assert!(rules.allows("/x/1"));
    }
}
