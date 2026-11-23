//! Customer service and customer experience: customer service and contact centers and
//! their leadership, customer experience, journeys and satisfaction, workforce management,
//! service KPIs, channels (omnichannel, chat, bots, IVR), complaints and escalations,
//! service providers and outsourcing, quality monitoring and training, back office,
//! knowledge management, contact center platforms and AI in service.
//!
//! An English term that German ads use as it is (`Contact Center`, `Workforce Management`)
//! is no key: its words meet word by word, also in a compound (`Workforce-Management-
//! Methoden`). Its other forms (`Callcenter`, `WFM`) map to a value whose parts are its
//! words, so they meet it all the same.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "customerService",
    search: &[
        "Kundenservice",
        "Leiter Kundenservice",
        "Customer Service",
        "Contact Center",
        "Call Center",
        "Kundendienst",
        "Customer Care",
        "Beschwerdemanagement",
        "Eskalationsmanagement",
        "Kundendialog",
    ],
    // Triggers also mark a known skill in any ad (`soft_sentence`), so no common word
    // such as `customer`, `contact` or `Kundenzufriedenheit` is one.
    triggers: &[
        "aht",
        "avaya",
        "beschwerde",
        "bpo",
        "call-cent",
        "callcent",
        "ccaas",
        "chatbot",
        "contact-cent",
        "contactcent",
        "csat",
        "cx",
        "cxone",
        "five9",
        "freshdesk",
        "genesys",
        "ivr",
        "journey",
        "kundendialog",
        "kundendienst",
        "kundenerleb",
        "kundenservic",
        "nps",
        "omni-channel",
        "omnichannel",
        "personaleinsatzplan",
        "service-cent",
        "servicecent",
        "sprachdialog",
        "talkdesk",
        "voicebot",
        "wfm",
        "zendesk",
    ],
    generic: &[],
    concepts: &[
        // Customer service and contact centers (`customer service` and `customer experience`
        // as in `sales`; `Kundenbetreuung` stays the account work of `sales`).
        ("customer service", "kundenservice"),
        ("customer care", "kundenservice"),
        ("customer support", "kundenservice"),
        ("customer operations", "kundenservice"),
        ("customer dialog", "kundenservice"),
        ("customer dialogue", "kundenservice"),
        ("kundendienst", "kundenservice"),
        ("kundendialog", "kundenservice"),
        ("contact centre", "contact-center"),
        ("contactcenter", "contact-center"),
        ("call center", "contact-center"),
        ("call centre", "contact-center"),
        ("callcenter", "contact-center"),
        ("service center", "contact-center"),
        ("servicecenter", "contact-center"),
        ("customer care center", "contact-center"),
        ("customer service center", "contact-center"),
        ("customer contact center", "contact-center"),
        ("customer interaction center", "contact-center"),
        ("customer engagement center", "contact-center"),
        ("kundenservice center", "contact-center"),
        ("kundenservicecenter", "contact-center"),
        ("kundenkontaktcenter", "contact-center"),
        ("kundendialogcenter", "contact-center"),
        // Their leadership (a lead meets the field it leads in full, not the other way). Only
        // the words a target role drops (`Leiter`, `Head`, `Director`) mark a lead here: a
        // `Contact Center Manager` keeps its words, so it meets the role `Contact Center
        // Director` in full.
        ("leiter kundenservice", "kundenservice-leitung"),
        ("leiterin kundenservice", "kundenservice-leitung"),
        ("leitung kundenservice", "kundenservice-leitung"),
        ("kundenservice leiter", "kundenservice-leitung"),
        ("kundenservice leitung", "kundenservice-leitung"),
        ("kundenserviceleiter", "kundenservice-leitung"),
        ("kundenserviceleiterin", "kundenservice-leitung"),
        ("kundenservicemanagement", "kundenservice-leitung"),
        ("leiter kundendialog", "kundenservice-leitung"),
        ("leiterin kundendialog", "kundenservice-leitung"),
        ("leitung kundendialog", "kundenservice-leitung"),
        ("leiter customer service", "kundenservice-leitung"),
        ("leiterin customer service", "kundenservice-leitung"),
        ("leitung customer service", "kundenservice-leitung"),
        ("leiter customer care", "kundenservice-leitung"),
        ("leitung customer care", "kundenservice-leitung"),
        ("head customer service", "kundenservice-leitung"),
        ("head customer care", "kundenservice-leitung"),
        ("head customer support", "kundenservice-leitung"),
        ("head customer operations", "kundenservice-leitung"),
        ("director customer service", "kundenservice-leitung"),
        ("customer service director", "kundenservice-leitung"),
        ("director customer operations", "kundenservice-leitung"),
        ("vp customer service", "kundenservice-leitung"),
        ("vice president customer service", "kundenservice-leitung"),
        ("leiter contact center", "contact-center-leitung"),
        ("leiterin contact center", "contact-center-leitung"),
        ("leitung contact center", "contact-center-leitung"),
        ("contact center leiter", "contact-center-leitung"),
        ("contact center leiterin", "contact-center-leitung"),
        ("contact center leitung", "contact-center-leitung"),
        ("contact center director", "contact-center-leitung"),
        ("director contact center", "contact-center-leitung"),
        ("head contact center", "contact-center-leitung"),
        ("leiter callcenter", "contact-center-leitung"),
        ("leiterin callcenter", "contact-center-leitung"),
        ("leitung callcenter", "contact-center-leitung"),
        ("callcenter leiter", "contact-center-leitung"),
        ("callcenter leitung", "contact-center-leitung"),
        ("callcenterleiter", "contact-center-leitung"),
        ("callcenterleiterin", "contact-center-leitung"),
        ("callcenterleitung", "contact-center-leitung"),
        ("leiter call center", "contact-center-leitung"),
        ("leitung call center", "contact-center-leitung"),
        ("call center leiter", "contact-center-leitung"),
        ("call center leitung", "contact-center-leitung"),
        ("leiter service center", "contact-center-leitung"),
        ("leitung service center", "contact-center-leitung"),
        ("service center leiter", "contact-center-leitung"),
        ("service center leitung", "contact-center-leitung"),
        // Managing the field is leading it, as in `Kundenservicemanagement`.
        ("customer service management", "kundenservice-leitung"),
        ("customer care management", "kundenservice-leitung"),
        ("kundenservice management", "kundenservice-leitung"),
        ("call center management", "contact-center-leitung"),
        ("call centre management", "contact-center-leitung"),
        ("callcenter management", "contact-center-leitung"),
        ("callcentermanagement", "contact-center-leitung"),
        ("contact center management", "contact-center-leitung"),
        ("contact centre management", "contact-center-leitung"),
        ("contactcenter management", "contact-center-leitung"),
        // Customer experience (`experience` is a stopword, so these keys stay; `CX` alone is
        // too short to keep, with a second word it counts; a key that spans `of` keeps it).
        ("customer experience", "customer-experience"),
        ("customer experience management", "customer-experience"),
        ("customer experience strategy", "customer-experience"),
        ("customer experience strategie", "customer-experience"),
        ("customer experience transformation", "customer-experience"),
        ("customer experience beratung", "customer-experience"),
        ("customer experience consulting", "customer-experience"),
        ("customer experience consultant", "customer-experience"),
        ("customer experience manager", "customer-experience"),
        ("cx management", "customer-experience"),
        ("cx manager", "customer-experience"),
        ("cx strategie", "customer-experience"),
        ("cx strategy", "customer-experience"),
        ("cx transformation", "customer-experience"),
        ("cx consulting", "customer-experience"),
        ("cx consultant", "customer-experience"),
        ("cx beratung", "customer-experience"),
        ("cx berater", "customer-experience"),
        ("cx beraterin", "customer-experience"),
        ("cem", "customer-experience"),
        ("cxm", "customer-experience"),
        ("kundenerlebnis", "customer-experience"),
        ("kundenerlebnismanagement", "customer-experience"),
        ("head of cx", "customer-experience-leitung"),
        ("head cx", "customer-experience-leitung"),
        ("cx lead", "customer-experience-leitung"),
        ("cx director", "customer-experience-leitung"),
        ("director cx", "customer-experience-leitung"),
        ("cx leiter", "customer-experience-leitung"),
        ("cx leiterin", "customer-experience-leitung"),
        ("cx leitung", "customer-experience-leitung"),
        ("leiter cx", "customer-experience-leitung"),
        ("leitung cx", "customer-experience-leitung"),
        ("vp cx", "customer-experience-leitung"),
        ("head customer experience", "customer-experience-leitung"),
        ("head of customer experience", "customer-experience-leitung"),
        (
            "director customer experience",
            "customer-experience-leitung",
        ),
        (
            "director of customer experience",
            "customer-experience-leitung",
        ),
        (
            "customer experience director",
            "customer-experience-leitung",
        ),
        ("customer experience lead", "customer-experience-leitung"),
        ("vp customer experience", "customer-experience-leitung"),
        ("leiter customer experience", "customer-experience-leitung"),
        (
            "leiterin customer experience",
            "customer-experience-leitung",
        ),
        ("leitung customer experience", "customer-experience-leitung"),
        ("chief customer officer", "customer-experience-leitung"),
        ("chief experience officer", "customer-experience-leitung"),
        ("customer journey", "customer-journey"),
        ("customer journey management", "customer-journey"),
        ("customer journey mapping", "customer-journey"),
        ("journey mapping", "customer-journey"),
        ("journey management", "customer-journey"),
        ("kundenreise", "customer-journey"),
        ("touchpoint management", "customer-journey"),
        ("voice customer", "voc"),
        ("customer centricity", "kundenzentrierung"),
        ("customer centric", "kundenzentrierung"),
        // `Service Design` is one discipline: apart, `Service` would meet any service word.
        ("service design", "servicedesign"),
        ("customer success", "customer-success"),
        ("customer success management", "customer-success"),
        // Satisfaction, loyalty and feedback.
        ("customer satisfaction", "kundenzufriedenheit"),
        ("customer satisfaction score", "kundenzufriedenheit"),
        ("csat", "kundenzufriedenheit"),
        ("net promoter score", "nps"),
        ("net promoter", "nps"),
        ("customer effort score", "ces"),
        ("customer retention", "kundenbindung"),
        ("customer loyalty", "kundenbindung"),
        ("kundenloyalitat", "kundenbindung"),
        ("kundentreue", "kundenbindung"),
        ("churn management", "kundenruckgewinnung"),
        ("churn prevention", "kundenruckgewinnung"),
        ("churn reduction", "kundenruckgewinnung"),
        ("kundigerpravention", "kundenruckgewinnung"),
        ("kundigerruckgewinnung", "kundenruckgewinnung"),
        ("win back", "kundenruckgewinnung"),
        ("winback", "kundenruckgewinnung"),
        ("customer feedback", "kundenfeedback"),
        ("feedback management", "kundenfeedback"),
        ("feedbackmanagement", "kundenfeedback"),
        ("customer survey", "kundenbefragung"),
        ("kundenumfrage", "kundenbefragung"),
        ("kundenzufriedenheitsbefragung", "kundenbefragung"),
        // Workforce management and planning.
        ("workforce manager", "workforce-management"),
        ("workforce optimization", "workforce-management"),
        ("workforce optimisation", "workforce-management"),
        ("wfm", "workforce-management"),
        ("wfo", "workforce-management"),
        ("personaleinsatzplanung", "workforce-management"),
        ("einsatzplanung", "workforce-management"),
        ("shift planning", "schichtplanung"),
        ("shift scheduling", "schichtplanung"),
        ("dienstplanung", "schichtplanung"),
        ("dienstplangestaltung", "schichtplanung"),
        ("rostering", "schichtplanung"),
        ("capacity planning", "kapazitatsplanung"),
        ("capacity management", "kapazitatsplanung"),
        ("kapazitatsmanagement", "kapazitatsplanung"),
        ("prognose", "forecast"),
        ("volumenprognose", "volumen-forecast"),
        ("volumenplanung", "volumen-forecast"),
        ("volume forecasting", "volumen-forecast"),
        ("call volume forecast", "volumen-forecast"),
        ("contact volume forecast", "volumen-forecast"),
        ("anrufvolumenprognose", "volumen-forecast"),
        ("real time management", "echtzeitsteuerung"),
        ("real-time management", "echtzeitsteuerung"),
        ("realtime management", "echtzeitsteuerung"),
        ("realtime steuerung", "echtzeitsteuerung"),
        ("echtzeitmanagement", "echtzeitsteuerung"),
        ("intraday management", "echtzeitsteuerung"),
        ("intraday steuerung", "echtzeitsteuerung"),
        // Service KPIs (`Servicelevel` is the share answered in time, an SLA the contract).
        ("average handling time", "aht"),
        ("average handle time", "aht"),
        ("durchschnittliche bearbeitungszeit", "aht"),
        ("first contact resolution", "fcr"),
        ("first call resolution", "fcr"),
        ("first time resolution", "fcr"),
        ("erstlosungsquote", "fcr"),
        ("erstkontaktlosung", "fcr"),
        ("service level", "servicelevel"),
        ("service level agreement", "sla"),
        ("slas", "sla"),
        ("erreichbarkeitsquote", "erreichbarkeit"),
        ("annahmequote", "erreichbarkeit"),
        ("answer rate", "erreichbarkeit"),
        ("abandon rate", "abbruchquote"),
        ("abandonment rate", "abbruchquote"),
        ("lost calls", "abbruchquote"),
        ("kpis", "kpi"),
        ("kennzahl", "kpi"),
        ("servicekennzahl", "kpi"),
        ("key performance indicator", "kpi"),
        // Channels, bots and telephony (`AI` is read as `KI` before the keys).
        ("omni channel", "omnichannel"),
        ("multichannel", "omnichannel"),
        ("multi channel", "omnichannel"),
        ("cross channel", "omnichannel"),
        ("kanalubergreifend", "omnichannel"),
        ("live chat", "chat"),
        ("livechat", "chat"),
        ("webchat", "chat"),
        ("web chat", "chat"),
        ("chat bot", "chatbot"),
        ("virtual agent", "chatbot"),
        ("virtual assistant", "chatbot"),
        ("virtueller assistent", "chatbot"),
        ("digitaler assistent", "chatbot"),
        ("voice bot", "voicebot"),
        ("sprachbot", "voicebot"),
        ("conversational ki", "conversational-ki"),
        ("konversationelle ki", "conversational-ki"),
        ("messenger", "messaging"),
        ("whatsapp business", "messaging"),
        ("social customer care", "social-customer-care"),
        ("social media service", "social-customer-care"),
        ("interactive voice response", "ivr"),
        ("sprachdialogsystem", "ivr"),
        ("sprachportal", "ivr"),
        ("sprachcomputer", "ivr"),
        ("voice portal", "ivr"),
        ("telefonmenu", "ivr"),
        ("automatic call distribution", "acd"),
        ("automatische anrufverteilung", "acd"),
        ("anrufverteilung", "acd"),
        ("computer telephony integration", "cti"),
        ("skill based routing", "skill-based-routing"),
        ("skills based routing", "skill-based-routing"),
        ("skill-based routing", "skill-based-routing"),
        ("intelligent routing", "skill-based-routing"),
        ("selfservice", "self-service"),
        ("customer self service", "self-service"),
        ("customer portal", "kundenportal"),
        ("telefonvertrieb", "telesales"),
        // Complaints and escalations (`complaint management` as in `operations`).
        ("complaint management", "reklamationsmanagement"),
        ("complaint handling", "reklamationsmanagement"),
        ("complaints handling", "reklamationsmanagement"),
        ("beschwerdemanagement", "reklamationsmanagement"),
        ("beschwerdebearbeitung", "reklamationsmanagement"),
        ("reklamationsbearbeitung", "reklamationsmanagement"),
        ("escalation management", "eskalationsmanagement"),
        // Service providers and outsourcing (`vendor management` as in `procurement`; the
        // German compounds keep their word, so `Steuerung der Dienstleister` still meets them).
        ("vendor management", "lieferantenmanagement"),
        ("dienstleistermanagement", "dienstleistersteuerung"),
        ("service provider management", "dienstleistersteuerung"),
        ("provider management", "dienstleistersteuerung"),
        ("steuerung externer dienstleister", "dienstleistersteuerung"),
        // IT service management and the service desk, the service of the IT for its users
        // (the keys of `it_service`): near, no proof (`near`).
        ("it service management", "itsm"),
        ("it servicemanagement", "itsm"),
        ("service desk", "service-desk"),
        ("business process outsourcing", "bpo"),
        ("auslagerung", "outsourcing"),
        ("outsourcing management", "outsourcing"),
        ("make or buy", "make-or-buy"),
        // Quality, coaching and training (`Training` is read as `Weiterbildung`).
        ("quality monitoring", "qualitatsmonitoring"),
        ("call monitoring", "qualitatsmonitoring"),
        ("schulung", "weiterbildung"),
        // Back office and case work.
        ("back office", "backoffice"),
        ("sachbearbeitung", "backoffice"),
        ("front office", "frontoffice"),
        ("case management", "vorgangsbearbeitung"),
        ("fallbearbeitung", "vorgangsbearbeitung"),
        ("input management", "inputmanagement"),
        ("posteingangsbearbeitung", "inputmanagement"),
        // Knowledge management (`knowledge` is a stopword, so these keys stay).
        ("knowledge management", "wissensmanagement"),
        ("knowledge base", "wissensdatenbank"),
        ("knowledge centered service", "kcs"),
        ("knowledge-centered service", "kcs"),
        // Contact center platforms and service tools.
        ("contact center as a service", "ccaas"),
        ("cloud contact center", "ccaas"),
        ("genesys cloud", "genesys"),
        ("genesys engage", "genesys"),
        ("purecloud", "genesys"),
        ("nice cxone", "cxone"),
        ("nice incontact", "cxone"),
        ("incontact", "cxone"),
        ("service cloud", "salesforce-service-cloud"),
        ("servicenow customer service management", "servicenow-csm"),
        ("servicenow csm", "servicenow-csm"),
        ("dynamics 365 customer service", "dynamics-customer-service"),
        ("dynamics customer service", "dynamics-customer-service"),
        // A ticket system by its name: it meets a ticket system asked for, not another name.
        ("zendesk", "zendesk-ticketsystem"),
        ("freshdesk", "freshdesk-ticketsystem"),
        ("ticketing", "ticketsystem"),
        ("ticketing system", "ticketsystem"),
        ("ticket system", "ticketsystem"),
        // AI in service.
        ("generative kunstliche intelligenz", "generative-ki"),
        ("genai", "generative-ki"),
        ("gen ki", "generative-ki"),
        ("kunstliche intelligenz", "ki"),
        ("artificial intelligence", "ki"),
        ("large language model", "llm"),
        ("llms", "llm"),
        ("sprachanalyse", "speech-analytics"),
        ("voice analytics", "speech-analytics"),
        ("conversation analytics", "speech-analytics"),
        ("interaction analytics", "speech-analytics"),
        ("sentiment analysis", "sentimentanalyse"),
        ("sentiment analyse", "sentimentanalyse"),
        // Service organisation and neighbours.
        ("aftersales", "after-sales"),
        ("field service management", "field-service"),
        ("technischer kundendienst", "field-service"),
        ("customer communication", "kundenkommunikation"),
        ("service organisation", "serviceorganisation"),
        ("service organization", "serviceorganisation"),
        ("service strategy", "servicestrategie"),
    ],
    covers: &[
        ("contact-center", NARROWER),
        ("customer-experience", NARROWER),
        ("kundenservice", NARROWER),
    ],
    // Who leads customer service knows the service desk and the management of IT services
    // from the other side of the desk: tickets, service levels, staffing.
    near: &[
        ("itsm", &["kundenservice"]),
        ("service-desk", &["contact-center", "kundenservice"]),
    ],
};

/// The narrower work of customer service and customer experience (`Beschwerdemanagement`,
/// `Customer Journeys`, `NPS`), covered by the field (`Customer Service Management`, `Contact
/// Center`, `Customer Experience`).
const NARROWER: &[&str] = &[
    "customer-journey",
    "eskalationsmanagement",
    "kundenbefragung",
    "kundenbindung",
    "kundenfeedback",
    "kundenkommunikation",
    "kundenkontakt",
    "kundenmanagement",
    "kundenprozesse",
    "kundenzentrierung",
    "kundenzufriedenheit",
    "nps",
    "omnichannel",
    "qualitatsmonitoring",
    "reklamationsmanagement",
    "servicedesign",
    "servicelevel",
    "serviceprozesse",
    "voc",
];

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, assert_same, full, vocab};
    use crate::matching::atoms::{Fit, Vocab, atoms};
    use crate::matching::graph::fit;

    fn service() -> Vocab {
        let v = vocab(&[
            "Kundenservice",
            "Contact Center Management",
            "Workforce Management",
            "Beschwerdemanagement",
        ]);
        assert_eq!(v.packs(), ["customerService"]);
        v
    }

    /// IT service management and the service desk are near customer service and its
    /// leadership, both ways and in half only; IT security and a service design are not.
    #[test]
    fn it_service_is_near_customer_service() {
        let v = service();
        let best = |job: &str, profile: &str| {
            let profile = atoms(profile, &v);
            let job = atoms(job, &v);
            let fits = job
                .iter()
                .flat_map(|j| profile.iter().map(move |p| fit(j, p)));
            fits.max().unwrap_or(Fit::None)
        };
        for (job, profile) in [
            (
                "Fundierte Kenntnisse in ITIL / IT-Service-Management",
                "Customer Service Management",
            ),
            (
                "Mind. 7 Jahre Erfahrung in IT Operations / Service Desk",
                "Call Center Management",
            ),
            ("ITSM", "Kundenservice"),
            ("Leitung Kundenservice", "IT Service Management"),
        ] {
            assert_eq!(best(job, profile), Fit::General, "{job} / {profile}");
        }
        for (job, profile) in [
            ("Erfahrung in IT-Sicherheit", "Customer Service Management"),
            ("Service Design", "Service Desk"),
            ("Erfahrung im Field Service", "IT Service Management"),
        ] {
            assert_eq!(best(job, profile), Fit::None, "{job} / {profile}");
        }
    }

    #[test]
    fn paraphrases() {
        assert_same(
            &service(),
            &[
                ("Customer Service", "Kundenservice"),
                ("Customer Care", "Kundendienst"),
                ("Kundendialog", "Customer Support"),
                ("Callcenter", "Call-Center"),
                ("Service Center", "Contact Centre"),
                ("Head of Customer Service", "Leiterin Kundenservice"),
                ("Kundenservice-Leitung", "Director Customer Service"),
                ("Contact Center Leiter", "Leitung Callcenter"),
                ("Head of CX", "Leiter Customer Experience"),
                ("CX Strategy", "Customer Experience Management"),
                ("CX-Strategie", "Kundenerlebnis"),
                ("Customer Experience Consulting", "CX-Beratung"),
                ("Customer Journey Mapping", "Kundenreise"),
                ("CSAT", "Kundenzufriedenheit"),
                ("Net Promoter Score", "NPS"),
                ("Customer Retention", "Kundenbindung"),
                ("WFM", "Personaleinsatzplanung"),
                ("Capacity Planning", "Kapazitätsplanung"),
                ("Volume Forecasting", "Volumenprognose"),
                ("Intraday-Steuerung", "Real Time Management"),
                ("Average Handling Time", "AHT"),
                ("First Contact Resolution", "Erstlösungsquote"),
                ("Service-Level", "Servicelevel"),
                ("Omni-Channel", "Multichannel"),
                ("Chat Bot", "Chatbot"),
                ("Voice Bot", "Voicebot"),
                ("Conversational AI", "Konversationelle KI"),
                ("Sprachdialogsystem", "IVR"),
                ("Interactive Voice Response", "IVR"),
                ("Selfservice", "Self-Service"),
                ("Complaint Management", "Beschwerdemanagement"),
                ("Dienstleistermanagement", "Dienstleistersteuerung"),
                ("Vendor Management", "Lieferantenmanagement"),
                ("BPO", "Business Process Outsourcing"),
                ("Outsourcing", "Auslagerung"),
                ("Quality Monitoring", "Qualitätsmonitoring"),
                ("Schulung", "Training"),
                ("Back Office", "Backoffice"),
                ("Knowledge Management", "Wissensmanagement"),
                ("Genesys Cloud", "Genesys"),
                ("NICE inContact", "CXone"),
                ("GenAI", "Generative Künstliche Intelligenz"),
                ("Sprachanalyse", "Voice Analytics"),
                ("After-Sales", "Aftersales"),
            ],
        );
    }

    /// A profile that names the field meets its narrower work in half, the narrower work
    /// the field in full but not its lead, never a word of another field.
    #[test]
    fn the_field_meets_its_narrower_work_in_half() {
        let v = vocab(&["Kundenservice", "Contact Center Management", "Zendesk"]);
        let one = |text: &str| atoms(text, &v).last().cloned().expect("one atom");
        let profile = one("Customer Service Management");
        for job in [
            "Beschwerdemanagement",
            "Complaints Management",
            "Customer Journeys",
            "Kundenzufriedenheit",
            "Kundenprozesse",
        ] {
            assert_eq!(fit(&one(job), &profile), Fit::General, "{job}");
        }
        assert_eq!(
            fit(&one("Kundenservice"), &one("Beschwerdemanagement")),
            Fit::Covered
        );
        assert_eq!(fit(&profile, &one("Beschwerdemanagement")), Fit::None);
        assert_eq!(fit(&one("Projektcontrolling"), &profile), Fit::None);
    }

    /// A term ads use as it is meets its other forms through the parts of their value, and a
    /// lead meets the field it leads, not the other way.
    #[test]
    fn terms_meet_their_forms_and_leads_their_field() {
        let v = service();
        assert!(full(&v, "Contact Center", "Callcenter"));
        assert!(full(&v, "Callcenter", "Leitung Contact Center"));
        // A manager keeps its words, as the title of a target role compares them.
        assert_eq!(
            atoms("Contact Center Manager", &v),
            atoms("Contact Center Manager", &Vocab::core())
        );
        assert!(full(&v, "Workforce Management", "WFM"));
        assert!(full(&v, "Customer Journey", "Kundenreise"));
        assert!(full(&v, "Kundenservice", "Leitung Kundenservice"));
        assert!(full(
            &v,
            "Customer Experience",
            "Head of Customer Experience"
        ));
        assert!(!full(&v, "Leitung Kundenservice", "Kundenservice"));
        assert!(!full(&v, "Contact Center Leitung", "Call Center"));
        assert_eq!(atoms("Genesys Cloud CX", &v), atoms("Genesys", &v));
        assert_eq!(
            atoms("Head of Customer Experience", &v),
            atoms("CX Lead", &v)
        );
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &service(),
            &[
                ("Customer Success", "Customer Service"),
                ("Kundenbetreuung", "Kundenservice"),
                ("Account Management", "Kundenservice"),
                ("Kundenkontakt", "Callcenter"),
                ("Callcenter-Agent", "Contact Center"),
                ("Service Level Agreement", "Servicelevel"),
                ("Customer Success", "Customer Experience"),
                ("Technischer Kundendienst", "Kundendienst"),
                ("Business Intelligence", "Künstliche Intelligenz"),
                ("Customer Data Platform", "Customer Experience"),
            ],
        );
    }
}
