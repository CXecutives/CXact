# Test profiles

Five invented consultant profiles to try the app with. Nobody real stands behind them; names,
careers and numbers are made up. Each one is a complete profile file in the app's format
(German keys, the format of the old program's profile).

Load one in the app: Profil, then the file picker ("Datei wählen"), choose the file, check the
form and save. The app scores every stored job against it again.

| File | Who | Hard criteria worth trying |
|---|---|---|
| `interim-cfo.json` | Interim CFO, about 30 years, Diplom-Kauffrau | day rate from 1,000 EUR; permanent roles from 150,000 EUR a year and only in the Munich region (about 100 km) or with at least 60 % remote; target profile at least 10 years; DACH; no temporary agency work |
| `ki-automatisierung.json` | AI and automation consultant for mid-sized companies | day rate from 900 EUR; no agency work, no permanent role; 2 to 4 days a week; at least 2 months |
| `performance-profit.json` | Management consultant for performance, profit and pricing | day rate from 1,100 EUR; at most 4 days a week; target profile at least 8 years |
| `sap-fico.json` | SAP FI/CO consultant | day rate from 850 EUR; at least 3 days a week; at least 3 months |
| `it-cloud-freelancer.json` | Cloud architect and DevOps engineer | day rate from 800 EUR; fully remote from abroad allowed; no permanent role; 3 to 5 days a week |

Every file also sets exclusion words (`Werkstudent`, `Praktikum`). `cargo test -p
jobalert-core --test matching_profiles` loads each file the way the file picker does and scores
an ad with it.
