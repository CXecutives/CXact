# Test profiles

Five invented consultant profiles to try the app with. Nobody real stands behind them; names,
careers and numbers are made up. Each one is a complete profile file in the app's format
(Profil-JSON v19, `core/src/profile/form.rs`).

Try one in the app: copy it as `profil/beraterprofil.json` into the work folder and open the Profil.
The app scores every stored job against it again.

| File | Who | Hard criteria worth trying |
|---|---|---|
| `interim-cfo.json` | Interim CFO, about 30 years, Diplom-Kauffrau | day rate from 1,000 EUR; permanent roles from 150,000 EUR a year; DACH; no temporary agency work; at least 3 months |
| `ki-automatisierung.json` | AI and automation consultant for mid-sized companies | day rate from 900 EUR; projects only |
| `performance-profit.json` | Management consultant for performance, profit and pricing | day rate from 1,100 EUR; at least 3 months |
| `sap-fico.json` | SAP FI/CO consultant | day rate from 850 EUR; at least 3 months |
| `it-cloud-freelancer.json` | Cloud architect and DevOps engineer | day rate from 800 EUR; projects only; at least 3 months |

Every file also sets exclusion words (`Werkstudent`, `Praktikum`). `cargo test -p
jobalert-core --test matching_profiles` reads each file and scores an ad with it.
