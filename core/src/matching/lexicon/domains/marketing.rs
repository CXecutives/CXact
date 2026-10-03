//! Marketing beyond what `sales` already pairs (online, performance, content, product and
//! brand marketing, SEO/SEA, marketing automation, campaigns): CRM and direct marketing,
//! paid media, analytics, brand strategy, communications and PR, go-to-market, leads,
//! marketing technology and loyalty.
//!
//! As in `customer_service`, an English term that German ads use as it is (`Paid Social`,
//! `Growth Marketing`) is no key; its other forms map to a value whose parts are its words.
//! A short code never takes a hyphenated value of other words: the parts of one count on
//! their own in an ad (`SFMC` as `salesforce-marketing-cloud` would meet any `Marketing`).
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "marketing",
    triggers: &[
        "adwords",
        "campaign",
        "contentmarketing",
        "dialogmarketing",
        "direktmarketing",
        "hubspot",
        "influencer",
        "kampagn",
        "markenentwickl",
        "markenfuhr",
        "markenmanag",
        "markenposition",
        "markenstrateg",
        "marketing",
        "marketo",
        "onlinemarketing",
        "pardot",
        "performancemarketing",
        "produktmarketing",
        "seo",
        "suchmaschinen",
    ],
    generic: &[],
    concepts: &[
        // CRM, direct and e-mail marketing.
        ("customer relationship marketing", "crm-marketing"),
        ("direct marketing", "dialogmarketing"),
        ("direktmarketing", "dialogmarketing"),
        ("dialog marketing", "dialogmarketing"),
        ("email marketing", "e-mail-marketing"),
        ("e-mail marketing", "e-mail-marketing"),
        ("newsletter marketing", "e-mail-marketing"),
        ("customer lifecycle management", "customer-lifecycle"),
        ("lifecycle marketing", "customer-lifecycle"),
        ("customer segmentation", "kundensegmentierung"),
        ("loyalty program", "kundenbindungsprogramm"),
        ("loyalty programme", "kundenbindungsprogramm"),
        ("loyalty management", "kundenbindungsprogramm"),
        ("loyalitatsprogramm", "kundenbindungsprogramm"),
        ("bonusprogramm", "kundenbindungsprogramm"),
        // Search, paid media and growth (`SEA`, `SEO` as in `sales`).
        ("suchmaschinenmarketing", "sem"),
        ("search engine marketing", "sem"),
        ("paid search", "sea"),
        ("social ads", "paid-social"),
        ("social advertising", "paid-social"),
        ("social media advertising", "paid-social"),
        ("programmatic buying", "programmatic-advertising"),
        ("growth hacking", "growth-marketing"),
        ("conversion rate optimization", "conversion-optimierung"),
        ("conversion rate optimisation", "conversion-optimierung"),
        ("conversion optimization", "conversion-optimierung"),
        ("conversion optimierung", "conversion-optimierung"),
        ("media planning", "mediaplanung"),
        ("media buying", "mediaeinkauf"),
        // Analytics.
        ("web analytics", "webanalyse"),
        ("webanalytics", "webanalyse"),
        ("web analyse", "webanalyse"),
        ("webcontrolling", "webanalyse"),
        ("digital analytics", "webanalyse"),
        ("marketing controlling", "marketingcontrolling"),
        // Strategy, planning and brand (`brand management` as in `sales`).
        ("marketing strategy", "marketingstrategie"),
        ("marketing strategie", "marketingstrategie"),
        ("marketing planning", "marketingplanung"),
        ("marketing budget", "marketingbudget"),
        ("brand strategy", "markenstrategie"),
        ("brand positioning", "markenpositionierung"),
        ("brand marketing", "markenfuhrung"),
        ("brand manager", "markenfuhrung"),
        ("markenmanager", "markenfuhrung"),
        ("markenmanagerin", "markenfuhrung"),
        ("go to market", "go-to-market"),
        ("product launch", "productlaunch"),
        ("produktlaunch", "productlaunch"),
        ("produkteinfuhrung", "productlaunch"),
        ("agency management", "agentursteuerung"),
        ("agenturmanagement", "agentursteuerung"),
        ("agentur steuerung", "agentursteuerung"),
        ("kampagnensteuerung", "kampagnenmanagement"),
        ("kampagnenplanung", "kampagnenmanagement"),
        ("campaign planning", "kampagnenmanagement"),
        ("campaign manager", "kampagnenmanagement"),
        ("kampagnenmanager", "kampagnenmanagement"),
        ("event marketing", "eventmarketing"),
        ("veranstaltungsmarketing", "eventmarketing"),
        // Communications and PR (`marketing communication` stems like the `market
        // communication` of `energy`, so only the German compound is paired).
        ("marketing kommunikation", "marketingkommunikation"),
        ("marcom", "marketingkommunikation"),
        ("corporate communications", "unternehmenskommunikation"),
        ("corporate communication", "unternehmenskommunikation"),
        ("public relations", "pressearbeit"),
        ("offentlichkeitsarbeit", "pressearbeit"),
        ("media relations", "pressearbeit"),
        ("medienarbeit", "pressearbeit"),
        ("pr arbeit", "pressearbeit"),
        ("internal communications", "internekommunikation"),
        ("internal communication", "internekommunikation"),
        ("interne kommunikation", "internekommunikation"),
        ("content strategy", "content-strategie"),
        ("content strategie", "content-strategie"),
        ("contentstrategie", "content-strategie"),
        ("social media management", "socialmediamarketing"),
        // Leads (`lead generation` as in `sales`).
        ("demand generation", "leadgenerierung"),
        ("lead management", "leadmanagement"),
        // Marketing technology.
        ("marketing technology", "martech"),
        ("marketing technologies", "martech"),
        ("marketing ops", "marketing-operations"),
        ("customer data platform", "customerdataplatform"),
        ("cdp", "customerdataplatform"),
        ("marketing cloud", "salesforce-marketing-cloud"),
        ("salesforce pardot", "pardot"),
        ("adobe marketo", "marketo"),
        ("marketo engage", "marketo"),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, assert_same, full, vocab};
    use crate::matching::atoms::Vocab;

    fn marketing() -> Vocab {
        let v = vocab(&["Performance Marketing", "Marketing Automation", "Marketo"]);
        assert_eq!(v.packs(), ["sales", "marketing"]);
        v
    }

    #[test]
    fn paraphrases() {
        assert_same(
            &marketing(),
            &[
                ("Direct Marketing", "Direktmarketing"),
                ("E-Mail Marketing", "Email Marketing"),
                ("E-Mail-Marketing", "Newsletter Marketing"),
                ("Suchmaschinenmarketing", "SEM"),
                ("Paid Search", "SEA"),
                ("Social Ads", "Social Media Advertising"),
                ("Conversion-Optimierung", "Conversion Rate Optimization"),
                ("Web Analytics", "Webanalyse"),
                ("Marketing-Strategie", "Marketingstrategie"),
                ("Brand Strategy", "Markenstrategie"),
                ("Brand Marketing", "Markenführung"),
                ("Go-to-Market", "Go to Market"),
                ("Produkteinführung", "Product Launch"),
                ("Agency Management", "Agentursteuerung"),
                ("Kampagnensteuerung", "Campaign Management"),
                ("Marketing-Kommunikation", "Marketingkommunikation"),
                ("Public Relations", "Pressearbeit"),
                ("Öffentlichkeitsarbeit", "PR-Arbeit"),
                ("Internal Communications", "Interne Kommunikation"),
                ("Demand Generation", "Lead Generation"),
                ("Marketing Technology", "MarTech"),
                ("CDP", "Customer Data Platform"),
                ("Loyalty Program", "Bonusprogramm"),
            ],
        );
    }

    /// Terms ads use as they are meet their other forms; a launch meets a product launch.
    #[test]
    fn terms_meet_their_forms() {
        let v = marketing();
        assert!(full(&v, "Paid Social", "Social Ads"));
        assert!(full(&v, "Growth Marketing", "Growth Hacking"));
        assert!(full(&v, "Salesforce Marketing Cloud", "Marketing Cloud"));
        assert!(full(&v, "Experience with launches", "Produkteinführung"));
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &marketing(),
            &[
                ("SEM", "SEO"),
                ("Marketing Controlling", "Controlling"),
                ("Corporate Communications", "Interne Kommunikation"),
                ("Product Owner", "Product Launch"),
                ("Praktikum (Intern)", "Interne Kommunikation"),
                ("Investor Relations", "Public Relations"),
                ("Lead Management", "Leadership"),
            ],
        );
    }
}
