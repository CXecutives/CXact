//! SAP and ERP: products, modules and process names.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "sap",
    search: &["SAP Berater", "SAP Consultant", "SAP Projektleiter"],
    triggers: &["abap", "fiori", "s/4hana", "s4hana", "sap"],
    generic: &[],
    concepts: &[
        ("order to cash", "order-to-cash"),
        ("otc", "order-to-cash"),
        ("o2c", "order-to-cash"),
        ("procure to pay", "procure-to-pay"),
        ("central finance", "central-finance"),
        ("fi-gl", "hauptbuchhaltung"),
        ("fi-ap", "kreditorenbuchhaltung"),
        ("fi-ar", "debitorenbuchhaltung"),
        ("fi-aa", "anlagenbuchhaltung"),
        ("co-om", "kostenstellenrechnung"),
        ("co-pc", "produktkostenrechnung"),
        ("co-pa", "ergebnisrechnung"),
    ],
    covers: &[],
    // SAP SD is the module of order to cash.
    near: &[("order-to-cash", &["sd"])],
};

#[cfg(test)]
mod tests {
    use super::super::testing::vocab;
    use crate::matching::atoms::{Fit, atoms};
    use crate::matching::graph::fit;

    /// `O2C` is order to cash, the process SAP SD runs: near the module; procure to pay is
    /// not.
    #[test]
    fn order_to_cash_is_near_sd() {
        let v = vocab(&["SAP SD", "SAP S/4HANA"]);
        assert!(v.packs().contains(&"sap"), "{:?}", v.packs());
        let one = |text: &str| atoms(text, &v).last().cloned().expect("one atom");
        assert_eq!(one("O2C-Expertise"), one("Order to Cash"));
        assert_eq!(fit(&one("O2C-Expertise"), &one("SAP SD")), Fit::General);
        assert_eq!(fit(&one("Procure to Pay"), &one("SAP SD")), Fit::None);
    }
}
