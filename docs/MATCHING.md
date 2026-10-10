# Matching

How the app scores a job against the consultant profile (`ENGINE_VERSION` 19) and how it is
measured. How each rule came about, version by version, is in the git history of this file.
Code: `core/src/matching`. Tests in `core/tests/`: `matching_corpus.rs`, `matching_heldout.rs`,
`matching_generalisation.rs`, `matching_criteria.rs`, `matching_profiles.rs`, `matching_wishes.rs`,
`matching_page_facts.rs`, `matching_fuzz.rs`, `countries.rs`; the metrics in `common/eval.rs` and
`core/examples/common/metrics.rs`.

## Corpus and gates

`core/tests/fixtures/matching`: 58 invented ads K01-K58 in the TXT contract format and six
invented profiles (Profil-JSON v19, migrated from the old format with engine 19).

| Key | Profile | Notes |
|---|---|---|
| fin | `sample_profile.json` | interim finance |
| it | `sample_profile_it.json` | SAP/IT project lead, 950 EUR/day, later availability |
| senior | `sample_profile_senior.json` | very senior interim finance and transformation consultant: about 30 years, Diplom-Kauffrau, 1,000 EUR/day, permanent roles from 150,000 EUR |
| sap | `sample_profile_sap.json` | SAP FI/CO consultant: business bachelor, 950 EUR/day, permanent roles from 95,000 EUR |
| wish | `sample_profile_senior_wishes.json` | senior with target roles and wishes |
| wishSap | `sample_profile_sap_wishes.json` | sap with target roles and wishes |

`corpus.json` fixes per job and profile, written before the engine work it gates: band (width
<= 30), status (excluded > unscorable > scored), decided violations, expected checks and musts
that must stay open, each with a one-line rationale. An expectation written for a later engine
is gated from that `ENGINE_VERSION` on (`since`, `profileSince`).

Gates of `matching_corpus.rs`:
- decided exclusions and status exactly as in `corpus.json`; expected checks raised; `mustOpen`
  items never met;
- `GOLDEN_DIGEST` over every result (the same on Windows and macOS);
- the target role and the wishes never lift a job into the high band (80) while fewer than half
  of its musts are met;
- the speed budget in release builds (median <= 0.5 ms per job, 2,000 jobs <= 3 s); no fixture
  ignored by git.

Ten held-out sets (`heldout1/` to `heldout10/`): invented ads with blind labels (grade 0-3,
excluded) written by independent agents for profiles the engine was not tuned on at the time.
Every set was later used to find and fix systematic gaps, so they are regression corpora, not an
unseen measurement. `matching_heldout.rs` freezes a floor per set (NDCG@10, Spearman, exclusion
precision and recall, buried grade-3 jobs); a floor is never lowered to let a change pass.

`matching_profiles.rs`: an invented clinical project manager (no domain pack, own English terms
among the tools) scores a clinical ad high and a finance ad low; packs, years, degrees, criteria;
a mandatory licence excludes, an optional one caps.

### Metrics

`common/eval.rs` and `examples/common/metrics.rs`, printed by `match_eval` (the private gold
set) and `heldout_report`:
- NDCG@10 and @20 (gain `2^grade - 1`, grade 0 for a job the labels exclude; mean over the
  profiles with a relevant job), P@5 against what a profile can reach (`P@5 / min(5,
  relevant)`), Spearman over all pairs, high-band precision, grade-3 jobs buried (below 40,
  excluded or unscorable), exclusion precision and recall. Excluded jobs rank last, unscorable
  ones just above them, and equal scores follow `Assessment.rank` (per-mille before caps and
  rounding), as in the app's list.
- The order below the top: the Spearman correlation of list order and gain over the relevant
  pairs only (gain > 0), and the concordance per grade pair (0v3, 0v2, 0v1, 1v3, 1v2, 2v3): the
  share of same-profile job pairs whose shown scores order them like their label grades, ties
  half, the score of an excluded job kept (it measures the fit; the exclusions have their own
  gates). Most pairs of a set have gain 0, so the pooled Spearman has a low ceiling (a perfect
  order reaches 0.51 on set 7) and gates nothing.

Gates of the gold set (`match_eval`, enforced from 60 labelled jobs): exclusion precision 1.0,
recall >= 0.80, NDCG@10 >= 0.75, P@5 >= 0.80, no grade-3 job buried, high-band precision
>= 0.80, Spearman over the relevant pairs >= 0.50, concordance 0v3 >= 0.95, 0v2 >= 0.85,
1v3 >= 0.80, 2v3 >= 0.70 (0v1 and 1v2 are reported only: the labelers themselves disagree most
there).

## Measurements at version 20

`cargo test -p jobalert-core --test matching_heldout -- --ignored heldout_report --nocapture`:

| Set | NDCG@10 | P@5 | Spearman relevant | Concordance 2v3 | Concordance 1v2 | Buried | Exclusions P / R |
|---|---|---|---|---|---|---|---|
| heldout1 | 0.923 | 1.000 | 0.782 | 0.755 | 0.621 | 0 | 1.000 / 0.971 |
| heldout2 | 0.892 | 0.875 | 0.717 | 0.663 | 0.774 | 0 | 1.000 / 0.845 |
| heldout3 | 0.911 | 0.933 | 0.595 | 0.595 | 0.667 | 0 | 1.000 / 0.900 |
| heldout4 | 0.830 | 0.843 | 0.564 | 0.481 | 0.833 | 0 | 1.000 / 0.959 |
| heldout5 | 0.802 | 0.967 | 0.717 | 0.826 | 0.693 | 0 | 0.987 / 0.955 |
| heldout6 | 0.902 | 0.950 | 0.797 | 0.818 | 0.836 | 0 | 1.000 / 0.982 |
| heldout7 | 0.921 | 0.910 | 0.673 | 0.824 | 0.583 | 2 | 1.000 / 0.851 |
| heldout8 | 0.952 | 0.957 | 0.815 | 0.855 | 0.776 | 0 | 1.000 / 0.856 |
| heldout9 | 0.890 | 0.854 | 0.652 | 0.755 | 0.676 | 0 | 1.000 / 0.860 |
| heldout10 | 0.942 | 1.000 | 0.836 | 0.734 | 0.812 | 0 | 1.000 / 1.000 |

Engine 20 has no Schwerpunkte (the owner's decision of 2026-10-10): every competence counts the
same, without a weight by its years. Gone are the double weight of a requirement met in full
through a starred competence, the relevance a demanded one added (100 for at most three), the
exemption from the off-field cap for a title that names one, the reason `focus`, the factor
`focus` and the wish `focus` of the profile summary. NDCG@10, P@5, Spearman over the relevant
pairs and concordance 2v3, engine 19 and engine 20:

| Set | Engine 19 | Engine 20 |
|---|---|---|
| heldout1 | 0.923 / 1.000 / 0.782 / 0.755 | 0.923 / 1.000 / 0.782 / 0.755 |
| heldout2 | 0.892 / 0.875 / 0.717 / 0.663 | 0.892 / 0.875 / 0.717 / 0.663 |
| heldout3 | 0.911 / 0.933 / 0.595 / 0.595 | 0.911 / 0.933 / 0.595 / 0.595 |
| heldout4 | 0.832 / 0.843 / 0.570 / 0.500 | 0.830 / 0.843 / 0.564 / 0.481 |
| heldout5 | 0.802 / 0.967 / 0.721 / 0.848 | 0.802 / 0.967 / 0.717 / 0.826 |
| heldout6 | 0.902 / 0.950 / 0.797 / 0.818 | 0.902 / 0.950 / 0.797 / 0.818 |
| heldout7 | 0.918 / 0.888 / 0.668 / 0.812 | 0.921 / 0.910 / 0.673 / 0.824 |
| heldout8 | 0.953 / 0.957 / 0.819 / 0.868 | 0.952 / 0.957 / 0.815 / 0.855 |
| heldout9 | 0.900 / 0.854 / 0.661 / 0.748 | 0.890 / 0.854 / 0.652 / 0.755 |
| heldout10 | 0.945 / 1.000 / 0.842 / 0.734 | 0.942 / 1.000 / 0.836 / 0.734 |

P@5 drops on no set; buried grade-3 jobs and the exclusions are unchanged. The largest losses are
NDCG@10 of heldout9 (0.900 to 0.890; its floor follows the decision at 0.889) and concordance
2v3 of heldout4 (0.500 to 0.481). In the corpus only the two profiles with Schwerpunkte move
(wish K03, K04, K07, K11, K21, K22, K26, K30, K34, K39, K42, K54, K58; wishSap K31, K57), down
by 1 to 7 points; 331 of 348 rows stay in their band (wishSap K31 off band before, 50 to 47).

Engine 19 reads Profil-JSON v19 through its typed form (`profile::ProfileForm`) and nothing else.
Every fixture profile was migrated in one pass: contract types from the excluded ones, `titel` to
`wunschrollen` where those were missing, Stichworte, wished industries (as starred `branchen`) and
the `auch` terms of a competence into the new fields (the terms into `methoden_tools`), the
Schwerpunkte as stars, the remote wish to the work mode (`ueberwiegend` to `remote`), the workload
to full or part time, degrees with their field; titles, USPs and career stations have no field
any more. 86 held-out pairs the labels excluded only for remote work abroad or the region of
permanent roles (rules v19 dropped) are relabeled (`Profil v19:` in their reason); in the corpus
the expectations of the region (senior and wish K33, K43, K45, K46, K51) are gone.

Two steps, NDCG@10 and exclusion recall (engine 18 on the old profiles; engine 18 on the migrated
ones, relabeled; engine 19):

| Set | Engine 18 | Engine 18, migrated | Engine 19 |
|---|---|---|---|
| heldout1 | 0.928 / 0.971 | 0.923 / 0.971 | 0.923 / 0.971 |
| heldout2 | 0.852 / 0.845 | 0.857 / 0.845 | 0.857 / 0.845 |
| heldout3 | 0.869 / 0.900 | 0.865 / 0.900 | 0.865 / 0.900 |
| heldout4 | 0.821 / 0.960 | 0.824 / 0.959 | 0.821 / 0.959 |
| heldout5 | 0.819 / 0.956 | 0.795 / 0.955 | 0.797 / 0.955 |
| heldout6 | 0.902 / 0.983 | 0.902 / 0.982 | 0.902 / 0.982 |
| heldout7 | 0.915 / 0.855 | 0.910 / 0.848 | 0.915 / 0.848 |
| heldout8 | 0.944 / 0.835 | 0.929 / 0.824 | 0.930 / 0.824 |
| heldout9 | 0.860 / 0.863 | 0.877 / 0.860 | 0.886 / 0.860 |
| heldout10 | 0.945 / 1.000 | 0.945 / 1.000 | 0.945 / 1.000 |

What moved, moved with the profiles (step 1); on the same profiles engine 19 is engine 18 but for
heldout4 (-0.003, two ties of P6) and the table of role names (heldout7, heldout9). The floors of
`matching_heldout.rs` that moved follow the migrated profiles; set 10 has its floors since 19.

Second round of engine 19: ESCO under the engine's words ("ESCO"), the fills of the gap finder
and the fixes of an error analysis on sets 1 to 10 and the corpus; every change measured alone,
kept only when it lost on no set. NDCG@10, Spearman over the relevant pairs, buried grade-3 jobs
and exclusion recall, before and after:

| Set | Before | After |
|---|---|---|
| heldout1 | 0.923 / 0.776 / 0 / 0.971 | 0.923 / 0.782 / 0 / 0.971 |
| heldout2 | 0.857 / 0.676 / 1 / 0.845 | 0.892 / 0.717 / 0 / 0.845 |
| heldout3 | 0.865 / 0.521 / 0 / 0.900 | 0.871 / 0.634 / 0 / 0.900 |
| heldout4 | 0.821 / 0.558 / 0 / 0.959 | 0.832 / 0.570 / 0 / 0.959 |
| heldout5 | 0.797 / 0.713 / 0 / 0.955 | 0.802 / 0.721 / 0 / 0.955 |
| heldout6 | 0.902 / 0.797 / 0 / 0.982 | 0.902 / 0.797 / 0 / 0.982 |
| heldout7 | 0.915 / 0.668 / 2 / 0.848 | 0.918 / 0.668 / 2 / 0.851 |
| heldout8 | 0.930 / 0.795 / 2 / 0.824 | 0.954 / 0.819 / 0 / 0.856 |
| heldout9 | 0.886 / 0.646 / 0 / 0.860 | 0.898 / 0.659 / 0 / 0.860 |
| heldout10 | 0.945 / 0.840 / 0 / 1.000 | 0.945 / 0.842 / 0 / 1.000 |

The corpus keeps 331 of 348 rows in their band (K12 of five profiles up within its band). The
floors that rose follow (sets 2 to 9); set 10 keeps the floors set with the first round.

The error analysis, by kind:
- Missed exclusions: all of heldout9's P9 and P12 and most of sets 2, 3, 7 and 8 are the
  engine's decisions (the retired target years, the pay of agency work and of student jobs as
  employment pay, remote work for a place abroad). Fixed: full remote work denied in its clause
  (heldout8 R10, heldout7 K04).
- Buried grade-3 jobs: fixed are an ad's offer and next steps read as musts (heldout8 N14 and
  S07), function words that halved met musts (heldout8 P10 S07) and spellings (heldout2 Y05).
  Left: heldout7 P5 K06 (system integrators, vendor contracts and ERP programmes, which the
  profile names in other words) and sample_profile_senior_wishes J08 (a teaser whose one term is
  LinkedIn's badge `Actively recruiting`; dropping such badges lost on sets 6 and 7).
- Grade 1 against 2 (concordance 0.59 to 0.84): most discordant pairs are jobs the labels
  exclude and grade with the exclusion in mind (heldout1 C04, C06, C07: the rate or the place),
  or hands-on consultant roles the labels rank below leading roles in other words of the profile
  (heldout7 P5, heldout9 P12): the level of a role, which its requirements do not carry. Left.
- Tried and left out (a set lost): items of place-of-work and contract words only as the frame,
  the ANÜ notice headings, portal buttons and badges as no part of the ad, a place split off a
  frame line (no set moved).

Where the engine and the labels part on purpose:
- The labels exclude by the retired target years (`zielprofil_min_jahre`); the engine scores
  those pairs, so exclusion recall stays below 1.0, most on sets 2, 3 and 9.
- The labels of sets 2, 7 and 8 read the pay of temporary agency work x 8 as a day rate and
  exclude such jobs for freelance profiles that allow ANÜ and set no salary; the engine reads it
  as employment pay (the user's decision).
- Set 5 reads a student wage as no salary; the engine excludes C10 for two profiles by that wage
  per year, as the labels of set 3 do (T04).

Against the gates of the gold set these results are reported only. Concordance 2v3 stays below
0.70 on sets 2, 3 and 4: there the engine tells a profile's best jobs from the merely good ones
least well.

Corpus (`-- --ignored report --nocapture` of `matching_corpus.rs`): 331 of 348 rows in their
band, the same as engine 18 on the migrated profiles (336 on the old ones). Off band: fin K11 82,
K29 78, K32 46, K50 60; it K12 13, K39 35; sap K39 31; senior K02 55, K17 92, K32 46; wish K17
96, K28 79, K31 70; wishSap K31 50, K32 62, K39 37, K44 24.

Third round of engine 19 (2026-10-04): a live search with a real CV profile (an interim head of
customer service; the stored runs and their comparison in `core/tests/fixtures/private/baseline/`)
scored the core of its field low (`Teamleiter Call Center` 44, `Service Manager - Callcenter
Manager` 43) and jobs off it high (`Support / Workplace Management` 81, `Servicetechniker` 64,
`Teamlead SAP Purchase to Pay` 74). The causes and their fixes, every one measured alone:
- Musts of the field the CV covers stayed open: `Customer Service Management` and `Call Center
  Management` are the leads of their field now (as `Kundenservicemanagement` was), an ad's words a
  hyphenated profile atom joins are read as that atom (`Contact Center`), an abbreviation is met by
  a profile compound it starts (`Kennzahlen` by `KPI-Reporting`, never `DIN` by `DIN 276`),
  `Zendesk` and `Freshdesk` are ticket systems, `Leadership` is met half by a competence of
  leadership, service orientation and its kin are soft skills, a recruiter's greeting ends the
  requirements.
- `Zendesk` read as a compound of `Desk` met `Service Desk` (the 81).
- An ad whose musts are languages only scored them as a full `M`: such musts weigh a quarter
  beside the nice-to-haves (`(M+3K)/4`).
- `Ingenieurstudium` was no degree (a compound ending in `studium` is one).
- An off-field cap held ads whose title names the profile's target role or Schwerpunkt
  (`Leiter Kundenservice` 25): such a title is no ad off the field (corpus: wish K55 25 -> 28, in
  band).

Held-out sets before and after (NDCG@10 / Spearman relevant / buried / exclusion recall):
heldout3 0.871 / 0.634 / 0 / 0.900 -> 0.911 / 0.595 / 0 / 0.900 (T06, the one ad of the sets
whose musts are languages only: its grade-0 pairs fall, P1's grade 3 rises, two grade-2 pairs fall
with them); heldout8 NDCG@10 0.954 -> 0.953, heldout9 0.898 -> 0.900, Spearman over all pairs
heldout6 0.520 -> 0.519; every other number unchanged. Tried and left out: industries out of the
relevance or at half weight (heldout10 Spearman below its floor), atoms of multi-word entries at
half weight (a buried grade 3 in heldout4, heldout5 below its floor), general business words
(`Projektmanagement`) at the generic weight (heldout2 and 3 below their floors), leadership met in
full by a competence of leadership (grade-0 heads of sales rose on heldout5), a tool name as no
compound (heldout2 lost a must its profile met through a tool).

Projects as a contract type to choose (2026-10-04, still engine 19): `vertragsarten` may leave out
`projekt` (at least one type; a missing key allows all). Without it an interim or project role is
excluded (`project {excluded, stated, type}` as a violation, criterion `noProject`): stated by the
ad or from a source that lists projects only; an ad that offers a permanent role and freelance
work both is a check; a stated permanent role or temporary agency work meets the criterion. Every
fixture profile allows projects: corpus and held-out reports are unchanged, and so is the
fingerprint of a profile that allows them (only `projects excluded` joins it).

A new profile allows projects only (2026-10-10, still engine 19): `ProfileForm::default()` and a
missing `vertragsarten` are `projekt` alone, so a new profile excludes stated permanent roles
(`noPermanent`) and temporary agency work (`noAnue`) and has no minimum salary. Fixture profiles
name their types and are unchanged.

## The engine

Integer-only, per-mille throughout; `core/src/matching/{job,atoms,fit,facts,contract,permanent,
seniority,limits,exclusion,relevance,wishes,engine,explain}.rs`, parameters in `params.rs`.
Word lists: the general core in `lexicon/engine.rs` and one file per domain pack in
`lexicon/domains/` (external contract). Nothing person-specific is in code: every threshold
comes from the profile.

| Step | Rule |
|---|---|
| Reading | Must/nice/other headings incl. English (`Why join us`, `What we offer`, `Was wir dir bieten`, `Dein Start`, `So geht es weiter` end requirements), a heading in two languages (`Aufgaben / Tasks`), tender headings (`Muss-`, `Soll-`, `Kann-Anforderungen`), inline (`Anforderungen: ...`), frame sections; closing lines (`Interessiert? ...`), portal footers (`Projekt-ID`, `Eingestellt am`, `Branche`, `Karrierestufe`), the portal's tags (a bare `Skills` heading), tag and notice lines (`Hinweis`, `Datenschutz`) and company lines (legal form, founding year) are no requirements; nice cues (`von Vorteil`, `is an advantage`, `hilfreich`) make a nice-to-have, per item; requirement sentences only without a must section; vocabulary only when nothing else was found |
| Other listings | the ad ends for the hard criteria and the seniority at the first heading of the other listings a portal shows under it (`facts::own_text`, `lexicon::OTHER_LISTINGS`: `Ähnliche Projekte (12)`, `Weitere Projekte von ...`, `Similar jobs`), a heading only with its words whole and followed by nothing, a count, a colon or a tail of `LISTING_TAILS`; the requirement parser stops there too, the stored and shown ad stays whole |
| Items | AND at `,` `;` `und` `sowie` `&` `and` `inkl.`; OR alternatives at `oder` `bzw.` `or` ` / ` (an OR requirement is met when one branch is met); examples after `z. B.`/`e.g.` are alternatives of their head; negated items dropped; comma tails (`, gerne auch`, `, ob`) stay with their item, `in Wort und Schrift` never splits, the partners after `Zusammenarbeit mit`, `gegenüber` and `rund um` stay one item, parts joined by `und` keep the object the last one names |
| Kinds | skill, language (CEFR level; weight 250 in `M`, a hygiene factor, full weight in the evidence `n`; an item that names a language among four or more other atoms is a skill line), degree, licence (`Zulassung als Steuerberater`), soft (weight 250, unproven = half; a sentence starting with `Sie`, `Du`, `You` that names no known skill is one soft item), frame (weight 0: rate, duration, place, `Vollzeit`, `Verlängerung`) |
| Vocabulary | general core (languages, degrees, contract, remote and seniority words, general business pairs such as `project management` = `Projektmanagement`) plus domain packs (finance, sap, itProject, hr, procurement, data, pharma, operations, sales, legal, software, restructuring, consulting, energy, customerService, itService, marketing) that switch on when at least `PACK_HITS` 2 tokens of the profile's competences start with a pack trigger; a pack never maps words for other profiles, only its broad companion words (`Personal`, `Lieferant`, `Kunde`, `Entwicklung`) are generic for every profile; ESCO under them ("ESCO") |
| Ladder | umlauts folded, light stemming, concepts, compounds (light modifier or head = equal, other modifier = half, profile more specific = full; a modifier of three letters or more, a hyphen marks a compound however short; with or without the linking `s`), two thirds of a long entry = half; frame and soft words are words, not prefixes (`Verfügbarkeit` is frame, `Vergütungsmanagement` a skill); `SQL-Kenntnisse` is the skill, `ISO 9001` keeps its number, short codes (`QP`, `R`, `5S`, `CI/CD`) survive the minimum length; generic atoms (`SAP`, `Management`, `Finance`, `Einführung`, `ERP`, `Unternehmen`, `Head`, `Chief`) never alone and never reach a compound; verbal particles are no modifiers (`Einführung`, `Durchführung` are no `Führung`); a USP sentence or a long free-text entry never proves a requirement; an ad that asks for more than the profile names (`Tableau im Reporting` against `Reporting`) is half; knowledge of a product family (`SAP-Kenntnisse`) is met by an entry naming a product of it; leadership asked for alone is met half by a leading role; an industry of the profile is the setting of a requirement, never its function; leading roles are one concept (`Head of Finance`, `VP Finance`, `Kaufmännischer Leiter` = CFO) |
| Degrees | field (same = full, neighbouring such as business and business informatics = half, other = open), level (`Master` needs master level: `Diplom (Univ.)` counts as master, `Diplom (FH)` and a bachelor are half), `vergleichbar` accepts any field; `Promotion`, `Staatsexamen`, `MSc`, `PhD` are degrees, `Master Data` is none; `Qualified Person` and `Sachkundige Person` are one licence |
| Languages, years | a language one level below the required one is half, further below open; English language names in profiles and ads. Years against the profile's own years (`berufserfahrung_jahre`, else the most years of a competence): general experience (`10 Jahre Berufserfahrung`, plain `Erfahrung`) met at or below them, from four fifths on in part, below open, not weighed without the profile's years; years in a topic (`3 Jahre S/4HANA`) use the competence's own years where the profile names it, else the profile's; a range counts from its lower end and keeps its upper end (`max`); a part of a total (`davon mindestens drei Jahre`) is no minimum |
| Contract type | stated (`Festanstellung`, `Jahresgehalt`, `Werkvertrag`, `Tagessatz`, `Interim`, `permanent, full-time`, a page's limited employment type `Befristet`, `Contract`, `Freiberuflich`) > hints (benefits, `Why join us`, work permit: permanent, inferred) > portal (freelance portals: interim); both stated = unclear; an agency without details = unclear with `anueRisk`; denied interim wording is no interim signal; `Vakanzüberbrückung`, `übergangsweise` and `fractional` are interim; employment pay (an hourly wage, `Stundenlohn`, `iGZ`, `equal pay`, a pay scale; never a part of another word such as `Lohnbuchhaltung`) states an employment; reason `contractType {type, inferred}` |
| Hard criteria | read in the ad's own text only. ANÜ: decided when the contract is offered through it, not as an option (`freiberuflich oder ANÜ`), denied (also in English), a topic of the requirements (`Erfahrung mit Arbeitnehmerüberlassung`, `ANÜ-Erfahrung`), the business of the company or the field of a staffing role; the title counts like a contract sentence. Country: the country of the on-site clause decides, second sites and travel are a check, remote work for a place abroad is never decided (full remote work denied in its clause, `unable to consider fully remote`, is none). Day rate: an amount next to a currency or rate unit or after a rate word, in every spelling (`110 EUR/h`, `€420/day - €520/day`, `EUR 1,050 to 1,180`), the upper end of a range compared, an hourly rate x 8 (`HOURS_PER_DAY`); employment pay and the pay of temporary agency work are never a day rate; not for permanent roles. Availability against the stated start |
| Permanent roles | minimum salary: upper bound with the bonus share its sentence names, EUR per year (LinkedIn's salary chip states a permanent role and its salary; employment pay per hour x 2,080); decided only for a stated permanent role (`salary`), else a check; no salary = `salaryUnknown`; a salary in another currency is never compared (a `salary` check). Without `festanstellung` among the contract types the engine excludes a stated permanent role (`permanent` as a violation, criterion `noPermanent`), an inferred one is a check. Without `projekt` it excludes an interim or project role (`project`, criterion `noProject`), one offered next to a permanent role is a check |
| Seniority | `seniority.rs`, whatever topic the highest years name: a closed range whose upper end is at most half the profile's years, and from `JUNIOR_ROLE_YEARS` 5 on a junior title, a junior or entry level of the page (an internship, a working student) or a must that asks for first experience, is `overqualified` (met in part, never an exclusion); an assistant or associate level without years is `seniorityUnclear`; a junior role caps a profile of `SENIOR_YEARS` 10 or more at `JUNIOR_CAP` 40 |
| Formal duties | a must degree of another field or a missing licence = `formalOpen` check with a cap of 40; decided only when worded as mandatory (`zwingend`, `unabdingbar`, `mandatory`); no degree in the profile = a check |
| Relevance | title fit and a BM25F-like lexical score (title 3, requirement lines 2, rest 1) of the ad against the profile's query; an atom only named in an entry long enough to be a sentence weighs half; languages, contract words and quantities are no part of the query |
| Score | `M`, `K`, `P` and the shrinkage of "Formulas"; permanent roles x 0.9 (second category); caps: open formal must 40, several musts open (at least two and at least half) 40, an open must on the title's topic 60 (for a teaser an open field word of the title), no skill must met (at least two) 25, a single open skill must under a title of little fit 30, a text without requirements 60 (judged from its title, low evidence), a junior role for a senior profile 40; a scored ad keeps at least 10 |

A text long enough to read but without any requirement is scored from its title alone; a short
teaser is judged from its title, a short full text stays unscorable. Titles lose gender markers
and a marketing tail without a skill; contract words in a title (`Interim`, `Freelance`,
`befristet`) never match the profile.

### Profile keys

Profil-JSON v19 (`core/src/profile/form.rs`, the one reader of the file): flat German keys, every
key always written; a file with another key, a value of another type or one out of range does
not read at all. An empty value turns its rule off.

| Key | Meaning |
|---|---|
| `wunschrollen` | target roles, matched against the title |
| `vertragsarten` | at least one of `projekt`, `festanstellung`, `zeitarbeit` (missing: `projekt` only, as a new profile); without `projekt` an interim or project role is excluded, without `festanstellung` a stated permanent role, without `zeitarbeit` temporary agency work |
| `tagessatz_wunsch` | wished day rate (EUR); never a minimum |
| `tagessatz_min` | minimum day rate (EUR) |
| `mindestgehalt` | minimum annual salary (EUR) of permanent roles and temporary agency work; none without both |
| `arbeitsmodell` | wish: `remote` at least fully remote, `hybrid` at least partly, `vor_ort` on site, `egal` none |
| `laender` | allowed countries (ISO codes or names the engine knows); remote work counts everywhere |
| `regionen` | wished regions (cities, states, regions such as `Rhein-Main`, countries) |
| `verfuegbar_ab` | `sofort` or `TT.MM.JJJJ` |
| `auslastung` | `vollzeit` at least four days a week, `teilzeit` at most three, `egal` none |
| `mindestlaufzeit_monate` | 0, 3, 6 or 12 |
| `kernkompetenzen[]` | `kompetenz`, `jahre`; every competence counts the same (an old file's `schwerpunkt` reads and is ignored, never written) |
| `methoden_tools` | tools and methods |
| `berufserfahrung_jahre` | total years of experience |
| `branchen[]` | `branche`, `wunsch` (the star: a preferred industry, the industry wish) |
| `sprachen[]` | `sprache`, `niveau` (A1 to C2, `Muttersprache`) |
| `abschluesse` | degrees, each with its field |
| `zertifizierungen` | certificates |
| `ausschlusswoerter` | words that exclude an ad |

`ProfileSummary` names the criteria, `packs`, `years`, `degrees`, the wishes and the warnings
(`noCompetences`, `fewCompetences`, `noCriteria`).

### Formulas

Integer per-mille, parameters in `params.rs`.

- Requirements: `M = sum(w*e)/sum(w)` over the musts (`w` 1000, soft and language 250, frame 0;
  `e` the evidence 1000, 500 or 0), `K` the mean of `e` over the nice-to-haves, `P = must ? (nice
  ? (3M+K)/4 : M) : K`; every competence counts the same. The evidence is `n = sum(w_must) + 500
  * n_nice`.
- Shrinkage: `P' = (n*P + k*R' + prior_w*prior) / (n + k + prior_w)` with `k` = `K_SHRINK` 2000;
  low evidence (a teaser, vocabulary only, nice-to-haves only, fewer than two items) also
  shrinks towards `LOW_PRIOR` 400 with weight 1500; permanent roles x 0.9.
- Target role: the title meets a role (topic atoms without lead words, contract words such as
  `Interim` met by the title or an interim contract, a lead role needs a lead title) =
  `ROLE_FULL` 80; a junior title or a lead role without lead title = `ROLE_HALF` 40.
  Every name of a role group of `ROLE_GROUPS` (the one table of role names, which the search
  and the Profil's suggestions use too) reads as that group's first name.
- Wishes: met `+w`, clearly missed `-w`, near or unknown 0; `w` = rate 30, remote 30, region 20,
  industry 20; the sum clamped to `WISH_MAX` +-100. Day rate: met at or above the wish, near from
  `WISH_RATE_NEAR` 95 %, else missed (only for non-permanent roles). Work mode: as minimum
  shares `remote` 100, `hybrid` 20, `vor_ort` at most `ONSITE_MAX` 60; the
  ad's share is an interval (page fact > stated percent or days (`2 Tage vor Ort` = 60 %) > full
  remote wording > `REMOTE_NONE` (0) > hybrid (20-60) > remote named (60-100) > on site only
  (0)); met when the interval's low end reaches the wish, missed when its high end is 0 or more
  than `REMOTE_MARGIN` 30 below it. Region: the first place of the ad in a wished region = met,
  outside with at least `REGION_REMOTE_NEAR` 60 % remote = near, outside = missed, fully remote
  = met. Industry: the page's industries, else title, company and context lines, in the wish =
  met, another named industry = missed.
- `S = clamp(P' + role + clamp(sum wishes, -100, 100), 0, 1000)`; while fewer than half of the
  musts are met in full, a lift ends at `LIFT_CAP` 790 (score 79, below the high band 80); then
  `round_half_even(S/10)`, the caps (target role and wishes never lift a capped score) and the
  floor 10.

### Reasons, criteria and key facts

Every input is a reason with code and params (no prose): the requirements with their profile
entry and its JSON path as evidence, `targetRole {role, fit, points}`, `dayRateWish`,
`remoteWish`, `regionWish`, `industryWish`, each with `state`, `points` and the passages. The
requirement's params carry `max`, `general`, `have` (the years compared with), `yearsFit` and
`entryYears`, so the reader's row "Erfahrung" and every tooltip say one thing.

A criterion of the strip is `ok` only when the ad states a value that meets it (rate, place,
contract type, start, salary, years), with that value in `params` and the passage as a UTF-16
range; without one it is `notMentioned` (strip kind `open`); a criterion that does not fit the
contract type (salary for a freelance role, day rate for a permanent one) is left out. The key
facts of every ad (`KeyFacts`: rate with `rateFrom`, hourly, currency, rateOpen, start
`now`/`vague`/ISO date, months or `weeks` with `durationFrom`, remote from/to, workload,
contract, `salaryFrom`, `salaryBonus`, the application deadline and the contact,
`application.rs`) are stored in the match note and sent on `JobMatch.facts`.

The assessment also says what moved its score (`Assessment::factors`, the reader's "Warum diese
Zahl?"): the musts met, the optional requirements, the target role, the summed wishes, a text
with little evidence, the factor of a permanent role and the cap that held the score down
(`engine::CapKind`, only when the rounded score lay above it). At most five lines
(`MAX_FACTORS`; a cap, the permanent factor and the musts stay first), codes and params only
(`factors.rs`); they never change a score.

### Limits of an engagement

**Workload** (`limits.rs`), a share of a five-day week in `KeyFacts.workloadFrom`/`workloadTo`:
full-time 100, days x 20 (`3 Tage/Woche`), hours / 40 (`20 h/Woche` 50; without the week only in
a sentence with a workload word from 12 hours on, never the hours of a day or a month or a clock
time), a percentage in a clause with a workload word (`Auslastung 80 %`), part-time without a
number up to 80, part-time as an option (`Vollzeit, Teilzeit möglich`) up to 100. A number of
days or a share next to a place word (`3 Tage/Woche vor Ort`, `2 Tage pro Woche im Home Office`,
`80 % remote`) is the place of work. An explicit statement wins: the first sentence with a
workload word and a number, then the first that says full-time or part-time, then any other
number of days or hours per week, last the page's employment type. Outside the profile's days it
is the check `workload {from?, to, minDays?, maxDays?}`, never an exclusion; the strip key
`c:workload` is met with the ad's share inside the days.

**Duration**: an engagement whose months are known and shorter than `min_laufzeit_monate` is the
check `duration {months, min}`; the strip key `c:duration` is met at or above the minimum and not
set for a permanent role. Only a real duration statement sets the months: the page's duration
field, then the first sentence with a duration word (`lexicon::DURATION_TERMS`: `Laufzeit`,
`Projektdauer`, `befristet`, `Duration`), then the first duration phrase of any sentence (`für 6
Monate`, `6+ Monate`, `12 months` as a clause of its own). A lead time, a notice or trial period
or years of experience are never a duration. Weeks stay weeks and count as a 4.33rd of a month
(`Duration::below_months`); a range keeps its lower end. An end date (`bis Ende März 2027`) counts
from the stated start date, else from the posting date, a started month counted whole; an
application deadline is none.

### Exclusion words

`exclusion.rs`: a word excludes where it names the job itself, `exclusionWord {word}` (as the
profile writes it) with the deciding sentences highlighted; strip key `c:exclusionWords`, shown
only when violated. When unsure a word does not exclude: a false exclusion hides a good job, a
missed one only costs a look.

- The title and the page's career level or employment type (LinkedIn `Praktikum`) always decide.
- A word that names a kind of position (`lexicon::EXCLUSION_ROLE_WORDS`: `Werkstudent`,
  `Praktikum`, `Junior`, `Trainee`, `Ausbildung`, `Sachbearbeitung`, person nouns ending in
  `-ent`, `-ant`, `-and`, `-ist`) decides in the ad's own text only where the ad states the
  offered role: a gender marker on it (`Werkstudent (m/w/d)`), a hiring word (`Wir suchen einen
  Praktikanten`, `hiring a Junior ...`), a role label (`Position: Praktikum`), an offer with an
  indefinite article (`im Rahmen eines Pflichtpraktikums`) or a short line that starts with it.
  Never in a passing mention: the team, people one supervises, trains or mentors, a denial, a
  requirement, an offer of the company, a compound about something else, a list.
- Any other word (a condition: `Provisionsbasis`, `Rufbereitschaft`, `Callcenter`) decides in any
  sentence of the ad's own text unless it is denied, about the team or the company, about
  supervising, training or planning others, or a requirement of experience.

Case-insensitive whole words with their German forms: inflections and the compounds a word
starts (`Werkstudentin`, `Werkstudentenstelle`), from eight letters also the compounds it ends
(`Pflichtpraktikum`); a female form in the profile matches the male one; a phrase matches word by
word or as one word (`Call Center`, `Callcenter`). Words under four letters match only whole
(`IT`). Generated forms match only as whole words with their inflections: the participle of an
`-ent` noun from seven letters (`Werkstudierende`), `-mann` as `-frau`/`-leute`, `-um` as `-a`
(`Praktika`, never `praktikable`). `Praktikum` and `Praktikant` are one family
(`lexicon::EXCLUSION_WORD_FAMILIES`).

## ESCO

ESCO (the EU classification of occupations, skills and knowledge, German and English,
`lexicon/esco.rs`, data `esco.bin` from `tools/esco/build.py`) is the broad layer under the
engine's own words. `esco::named` finds the concepts a text names and keeps only what cannot name
the wrong one: never a transversal concept, a one-word label only as the text writes it
(`Security` is no `securities`, which the stemmer folds alike) and never a word the engine finds
generic (`SAP`), a label of several concepts only for the one whose preferred label it is.

- Requirements (`fit::Broad`): a requirement and a competence, tool or certificate the ladder
  leaves apart meet through a concept both name, when the profile names it by its preferred label
  (German or English), the engine's own words (the core and the profile's packs) leave the meaning
  of at least one side to ESCO and the concept is most of what each side says: in full (`via`
  `synonym`) when the ad names it by its preferred label too and asks nothing else (`Accounting`
  for `Buchführung`), else half (`semantic`: another name in the ad, or a product ESCO files under
  the concept, `Tableau` under data visualisation software). Two other names (`Tableau`, `Power
  BI`) never meet; soft skills, industries and languages stay out.
- Target roles (`roles::best`): a title that fits no role through the engine's words but names
  the occupation a role names by its preferred label (contract words left out) fits in half
  (`Accounting Manager` for `Leiter der Buchhaltung`).

Measured on heldout1-10 and the corpus, one pair moves: heldout9 P8 S081 (grade 3) from 87 to 92,
`battery management systems` for `Batteriemanagementsysteme`. The sets speak the engine's own
words; ESCO is for the other words of real ads and profiles. Looser forms lost and stay out: every
shared concept (`Power BI` for `Tableau`, `Kommunikation` for a line about an interview: heldout5,
heldout7 and the corpus worse), a profile's other name of a concept (heldout5 P7 A08, `Internal
Investigations` for an internal audit role).

The gap finder (`core/examples/vocab_gaps.rs`, `matching::vocabulary_gaps`, in debug builds only:
the shipped app carries the fixed vocabulary alone) runs over every ad
there is (the corpus, the held-out sets, the private real pages and mails) and lists the words
of the skill requirements and titles that neither the engine's words (every pack, the word lists)
nor ESCO know, by frequency: the vocabulary is filled from the top, a word that occurs nowhere
stays out. A code written in capitals (`VOB`) and a compound of a known head
(`Transformationsprojekt`) count as known, as the engine reads them. Before the fills: 1,825 of
3,136 skill requirements known in full (58.1 %).

Filled so far, every word measured alone and with the others (a word that lost on any set stays
out: `Verständnis`, `bis`, `beim`, `mehreren`, `großen`, the number words, `Aufbau`, `Planung`,
`Umsetzung`):
- 102 function words of German and English requirements are fillers (`davon`, `mehrere`,
  `gegenüber`, `überwiegend`, `which`, `ideally`, `both`, `via`): they no longer halve a met
  requirement as something more the ad asks for.
- 19 activity and setting words are generic atoms, too broad to meet a requirement alone
  (`Erstellung`, `Umstellung`, `Anwendung`, `Zusammenarbeit`, `Erfolg`, `Transaktion`,
  `Transition`, `international`, `reguliert`).
- Spellings of the error analysis: `Projekt Management` written apart, `S/4 HANA` with a space,
  the typo `Kentnisse`.
- Treasury and accounting pairs in the finance pack (`FX hedging` = `Devisensicherung`,
  `refinancing`, `payment transactions`, `subledger`, `tax audit`); `fractional` in a title is a
  contract word like `Interim`, `Specialist` a level word like `Expert`, `Direktion` a lead word,
  `Advisor` generic like `Consultant`; 19 tools and one certificate for the terms of the Profil
  and the reader (`Helm`, `ArgoCD`, `BlackLine`, `Migration Cockpit`, `Universal Journal`,
  `AUTOSAR`, `ISTQB`). No set moved by these.

Known in full after the fills: 1,975 of 3,070 (64.3 %; 61.9 % after the function words). NDCG@10 against the round's start
(engine 19 with ESCO): heldout2 0.857 to 0.877, heldout3 0.865 to 0.871, heldout4 0.821 to
0.832, heldout5 0.797 to 0.802, heldout7 0.915 to 0.918, heldout8 0.930 to 0.940 (one buried
grade-3 job less), heldout9 0.886 to 0.898; Spearman over the relevant pairs up on eight sets
(heldout3 0.521 to 0.634), concordance 2v3 up on seven; the rest the same.

The packs stay as they are where ESCO names alike: the 47 entries whose key and concept are
preferred labels of one ESCO concept (`Risk Management` and `Risikomanagement`, `Data Science`,
`Public Relations`, in the customer service pack `Kundendienst`) were taken out one at a time;
42 moved no set, three gained a little and two lost a little. They stay, because ESCO only meets
a requirement with a profile entry, while a pack's entry also carries the relevance, the title
fit and the Profil's suggestions. Gone: the keys the synonym table maps first, so no ad ever
reached them (`projektleiter`, `projektleiterin`, `s4hana`, `s4`).

## Domain packs

Packs in `lexicon/domains/`: German and English terms and spellings, role titles with the female
forms the stemmer does not fold (`Personalleiterin`, `Einkäuferin`), hyphenated keys for
spellings whose second part the text drops (`GMP-Umfeld`), and false friends mapped apart
(`Einkaufszentrum`, `DAX-Konzern`, `Purchase Price Allocation`, `Transfer Pricing`,
`Revisionssicherheit`). Concept values are German compounds where a hyphenated value would hand
its parts to other words (`strategischereinkauf`, not `strategisch-einkauf`, so `strategische
Planung` stays apart). A key in two packs names the same concept (`negotiation`, the quality
terms of pharma and operations); unit tests per pack check paraphrases and false friends.
Interim wording stays a contract word of the core: it never matches a profile's `Interim
Management`.

### Rubric of the AI prompts

`core/src/export/ai_rubric.de.md` (German) is the one rubric for the app's AI prompts: bands 1 to 10 (9 to 10 only with
a met Schwerpunkt when the profile names some), the caps, contract and ANÜ rules, wishes never
exclude and move at most one point. `core/tests/rubric.rs` checks its bands and that the
English rubric says the same.

The copied prompts (`core/src/export/ai_prompt.rs`) carry the rubric whole (German, or
`ai_rubric.en.md` in English), the skill's method and the engine's assessment of the job in
words: the result or the exclusion, every hard criterion with the profile's threshold and the
ad's own words (the highlight ranges), the requirements with their profile entry and its years,
the checks, Schwerpunkte, target role and wishes. No reason code reaches the text; a test builds
every code and looks for none.

## In the app

`pipeline::LocalMatcher` wraps one compiled profile; revision `e{ENGINE_VERSION}.{INPUTS}:{fingerprint}`
(a stored score of another revision is stale; `INPUTS` counts what a stored job hands the engine besides
its text - since 2 the page facts under `matching::fact_key` and the teaser flag, since 4 the career level, the
industries and a remote field in words, since 5 the stored key facts carry the workload). A panic of the engine
leaves the job `unscorable` with the note `engineFailed` and the run goes on. The profile is compiled once and kept until its file changes
(`src-tauri/src/commands/scoring.rs`); an empty profile or a parse error means no matcher, so nothing is
scored and nothing is pending. Jobs without text are judged from title and location (usually
`unscorable`, a clear location can exclude).

| Output | Content |
|---|---|
| List (`JobMatch`, stored) | status, score, `mustMet`/`mustTotal`, `top` (<= 2 met musts, then nice), `note`: first violation code (excluded), `shortText` (unscorable), else first check code; params flattened to scalars (lists joined with `, `); `facts` (`KeyFacts`, null values left out in the store) |
| Reader (`MatchDetail`, recomputed) | reasons `r{id}` (<= 40: violations, checks, musts, nice, info), highlights `h{id}` of kept reasons (<= 200, UTF-16), `summary` = `{code: "summary", params: mustMet, mustPartial, mustOpen, mustTotal, niceMet, niceTotal, evidence}`, criteria strip `c:{key}` for every criterion the profile sets that fits the contract type (kind met only with the ad's value as evidence, open = not mentioned, check, violation; profile values, the ad's value, `reason` id, the passages); the reader adds the ad's rate and start from its facts as plain chips where no criterion covers them |
| Profile (`ProfileInfo`) | quality, understood (competences, source path patterns, criteria `{code, params.set, ...}`, warnings), `scoredAt`, `pending` |

Rust starts a `rescore` run by itself (rules in `pipeline::rescore`): after choosing or removing the
profile or another workspace with another profile (no usable profile: scores are cleared first), at the
first page load when jobs are pending (new profile, engine update), and once after the current run when
the profile changed during it. Never without jobs (the first-run state stays), never while closing.
The reader saves a fresh score of a stale job only while no run is active.
