//! Energy industry: grids and their regulation, metering and the smart meter rollout,
//! market communication, renewables (EEG) and redispatch.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "energy",
    triggers: &[
        "anreizregulierung",
        "bilanzkreis",
        "eeg",
        "energie",
        "energy",
        "enwg",
        "marktkommunikation",
        "messstell",
        "netzbetrieb",
        "netzentgelt",
        "netzregulierung",
        "redispatch",
        "smart-meter",
        "stadtwerke",
        "utilities",
    ],
    generic: &[],
    concepts: &[
        // Metering and the smart meter rollout.
        ("messstellenbetreiber", "messstellenbetrieb"),
        (
            "grundzustandiger messstellenbetreiber",
            "messstellenbetrieb",
        ),
        ("metering point operator", "messstellenbetrieb"),
        ("messstellenbetriebsgesetz", "msbg"),
        ("smart meter rollout", "smart-meter-rollout"),
        ("smart metering rollout", "smart-meter-rollout"),
        ("rollout intelligenter messsysteme", "smart-meter-rollout"),
        ("imsys-rollout", "smart-meter-rollout"),
        ("intelligente messsysteme", "imsys"),
        ("intelligentes messsystem", "imsys"),
        ("smart meter gateway", "smgw"),
        // Regulation and authorities.
        ("bundesnetzagentur", "bnetza"),
        ("federal network agency", "bnetza"),
        ("regulierungsbehorde", "bnetza"),
        ("incentive regulation", "anreizregulierung"),
        ("grid fees", "netzentgelt"),
        ("network charges", "netzentgelt"),
        ("energiewirtschaftsgesetz", "enwg"),
        ("energy law", "energierecht"),
        ("energiewirtschaftsrecht", "energierecht"),
        // Markets, renewables and grid operation.
        ("market communication", "marktkommunikation"),
        ("marktprozesse", "marktkommunikation"),
        ("erneuerbare-energien-gesetz", "eeg"),
        ("eeg-abrechnung", "eeg"),
        ("einspeiseabrechnung", "eeg"),
        ("einspeisemanagement", "redispatch"),
        ("engpassmanagement", "redispatch"),
        ("congestion management", "redispatch"),
        ("balancing group management", "bilanzkreismanagement"),
        ("bilanzkreisbewirtschaftung", "bilanzkreismanagement"),
        ("energy industry", "energiewirtschaft"),
        ("energy sector", "energiewirtschaft"),
        ("energieversorgung", "energiewirtschaft"),
        ("verteilnetzbetreiber", "netzbetreiber"),
        ("ubertragungsnetzbetreiber", "netzbetreiber"),
        ("distribution system operator", "netzbetreiber"),
        ("grid operator", "netzbetreiber"),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, full, vocab};
    use crate::matching::atoms::Vocab;

    fn energy() -> Vocab {
        let v = vocab(&[
            "Messstellenbetrieb",
            "Smart-Meter-Rollout",
            "Marktkommunikation",
            "Energiewirtschaft",
            "Redispatch",
        ]);
        assert!(v.packs().contains(&"energy"), "{:?}", v.packs());
        v
    }

    #[test]
    fn energy_wording_meets_the_profile() {
        let v = energy();
        for (job, profile) in [
            (
                "Rolle des grundzuständigen Messstellenbetreibers",
                "Messstellenbetrieb",
            ),
            ("Rollout intelligenter Messsysteme", "Smart-Meter-Rollout"),
            ("Market communication processes", "Marktkommunikation"),
            ("Engpassmanagement im Verteilnetz", "Redispatch"),
            ("Experience in the energy sector", "Energiewirtschaft"),
        ] {
            assert!(full(&v, job, profile), "{job} / {profile}");
        }
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &energy(),
            &[
                ("Netzwerkarchitektur", "Energiewirtschaft"),
                ("Marketing", "Marktkommunikation"),
            ],
        );
    }
}
