//! Frozen parameters of the engine (change them only with a new `ENGINE_VERSION`).

/// Evidence of an item in per-mille.
pub(crate) const E_FULL: u16 = 1000;
pub(crate) const E_HALF: u16 = 500;
pub(crate) const E_NONE: u16 = 0;

/// Weight of a must item (skill, language, degree, years).
pub(crate) const W_MUST: u64 = 1000;
/// Weight of a soft skill (shown, never counted: engine 22).
pub(crate) const W_SOFT: u64 = 250;
/// Weight of a vocabulary term (no explicit requirements).
pub(crate) const W_TERM: u64 = 250;
/// A language asked at this level or higher (C1) counts against the profile while it is not
/// met in full; below it, or met, a language is hygiene and adds nothing (engine 22).
pub(crate) const LANGUAGE_MUST_LEVEL: u8 = 5;
/// Musts a typical real ad names (the median over the 641 private real ads with musts,
/// engine 22): the share of the other musts counts at least this many, and the ones a short
/// list does not name count as role and field does (engine 25).
pub(crate) const MUST_SATURATION: u64 = 7;
/// BM25F-like relevance: k1 and b in per-mille, fixed document length in characters.
pub(crate) const BM25_K1: u64 = 1200;
pub(crate) const BM25_B: u64 = 750;
pub(crate) const BM25_LENGTH: u64 = 2400;
/// Field weights: title, requirement lines, rest.
pub(crate) const FIELD_TITLE: u64 = 3;
pub(crate) const FIELD_REQUIREMENTS: u64 = 2;
pub(crate) const FIELD_REST: u64 = 1;
/// Static specificity of a profile atom: specific and generic.
pub(crate) const SPECIFIC_WEIGHT: u64 = 1000;
pub(crate) const GENERIC_WEIGHT: u64 = 200;
/// Relevance mass at which the lexical relevance reaches one half.
pub(crate) const RELEVANCE_HALF: u64 = 7000;

/// Texts shorter than this (characters, stripped) cannot be scored.
pub(crate) const MIN_TEXT_CHARS: usize = 100;
/// Fewer assessable items than this is low evidence.
pub(crate) const LOW_EVIDENCE_ITEMS: usize = 2;
/// A text this long (characters, stripped) read with fewer than `THIN_MUSTS` weighted musts
/// is low evidence too: its requirements were not found, the few items found say little.
pub(crate) const THIN_TEXT_CHARS: usize = 1500;
pub(crate) const THIN_MUSTS: usize = 3;
/// Hours per day for hourly rates.
pub(crate) const HOURS_PER_DAY: u64 = 8;
/// A profile entry with this many specific atoms is free text: containing a requirement
/// proves nothing (USP sentences never do).
pub(crate) const SENTENCE_ATOMS: usize = 4;
/// Permanent roles are the second category of a consultant: the score keeps this share
/// (per-mille), shown as a line of its own after the frame.
pub(crate) const PERMANENT_FACTOR: u64 = 900;
/// Score caps of the Passungsgrad, each with its reason: an open formal must (degree field,
/// licence, mandatory certificate) at most 40; the core of the role clearly open (less than
/// half of it met, a must on it open) at most 49; a foreign field at most 24.
pub(crate) const FORMAL_CAP: u8 = 40;
pub(crate) const CORE_OPEN_CAP: u8 = 49;
pub(crate) const OFF_FIELD_CAP: u8 = 24;

// --- ENGINE_VERSION 25: the Passungsgrad (`scorer.rs`) ---
// score = content x frame factor, then the lowest cap. The weights, the level values, the
// field values, the frame step and the caps are fixed by what they mean (the owner's rules
// in `export/ai_rubric.de.md`); only `PARTIAL` and `UNNAMED` are fitted, on the private
// teacher labels (train and lockbox without the gold pairs) by `tools/scorer/train.py`.

/// The weights of the three content parts in points (sum 100): role and field, core of the
/// role, other musts. Fixed by meaning: the role and its core decide, the rest of the list
/// adds.
pub(crate) const W_ROLE: u64 = 40;
pub(crate) const W_CORE: u64 = 40;
pub(crate) const W_MUSTS: u64 = 20;
/// What a requirement met in part counts (per-mille; fitted).
pub(crate) const PARTIAL: u64 = 900;
/// The other musts a short list does not name count this share of role and field
/// (per-mille; fitted).
pub(crate) const UNNAMED: u64 = 300;
/// The core of the role counts at least this many musts: the ones the ad does not name
/// count as role and field and the other musts do on average (a short ad is judged from its
/// title and field, the rubric's rule 8).
pub(crate) const CORE_SATURATION: u64 = 3;
/// Role and field at a level one above or one below the target roles, and two or more
/// above (per-mille of the part); two or more below caps at `LEVEL_CAP`.
pub(crate) const LEVEL_ONE: u64 = 850;
pub(crate) const LEVEL_TWO_ABOVE: u64 = 500;
/// Role and field by the field of the role (per-mille): the same field, near, far, foreign.
pub(crate) const FIELD_VALUES: [u64; 4] = [1000, 700, 200, 0];
/// The title fit (per-mille) from which a title of the profile's field is the same field,
/// and from which it is near.
pub(crate) const TITLE_SAME: u64 = 600;
pub(crate) const TITLE_NEAR: u64 = 300;
/// How the ad fits the profile's field (its relevance plus `HIT_RELEVANCE` for each of at
/// most `HITS_MAX` distinct core competences its requirements meet) from which it is the same
/// field, near and far; below, foreign.
pub(crate) const HIT_RELEVANCE: u64 = 150;
pub(crate) const HITS_MAX: u16 = 4;
pub(crate) const RELEVANCE_SAME: u64 = 900;
pub(crate) const RELEVANCE_NEAR: u64 = 650;
pub(crate) const RELEVANCE_FAR: u64 = 350;
/// The nice-to-have bonus at most (points; only a plus, inside the content).
pub(crate) const NICE_MAX: u64 = 5;
/// The frame factor: each stated condition worse than wished that breaks no hard criterion
/// (day rate, work mode and place, start, duration, workload) keeps this share of the score
/// (per-mille); what the ad does not state fits.
pub(crate) const FRAME_STEP: u64 = 950;

// --- ENGINE_VERSION 4: target roles and wishes (all off without their key) ---

/// Tokens of the profile a domain pack needs among its triggers to switch on.
pub(crate) const PACK_HITS: usize = 2;
/// Working hours of a year (40 per week): an hourly wage of an employment per year.
pub(crate) const HOURS_PER_YEAR: u64 = 2080;
/// A single open skill must makes a foreign field only when the title fit (per-mille) stays
/// below this: the title names little of the profile either.
pub(crate) const OFF_FIELD_TITLE_FIT: u64 = 300;
/// A profile with this many years of experience or more is senior: a junior role caps it
/// at `JUNIOR_CAP`.
pub(crate) const SENIOR_YEARS: u32 = 10;
pub(crate) const JUNIOR_CAP: u8 = 40;
/// A junior or entry-level role (a junior title, an internship, first professional
/// experience) is below a profile with this many years of experience or more: it is
/// over-qualified there (engine 18).
pub(crate) const JUNIOR_ROLE_YEARS: u32 = 5;
/// An ad two or more levels below the target roles caps at this (engine 23; one level below
/// is a signal of the learned scorer, engine 24).
pub(crate) const LEVEL_CAP: u8 = 40;
/// A day rate of at least this share of the wish (per-mille) is near, below it missed.
pub(crate) const WISH_RATE_NEAR: u64 = 950;
/// Work modes as minimum remote shares (percent): `remote`, `hybrid`.
pub(crate) const REMOTE_FULL: u64 = 100;
pub(crate) const REMOTE_PARTLY: u64 = 20;
/// `vor_ort`: the largest remote share that still means presence on site.
pub(crate) const ONSITE_MAX: u64 = 60;
/// A remote share at most this many points short of the wish is near, not missed.
pub(crate) const REMOTE_MARGIN: u64 = 30;
/// Remote share (percent, from-to) of hybrid wording without numbers, and of remote work
/// named without numbers and without presence on site.
pub(crate) const HYBRID_SHARE: (u64, u64) = (20, 60);
pub(crate) const REMOTE_NAMED_SHARE: (u64, u64) = (60, 100);
/// Workdays of a week (`zwei Tage vor Ort` = 60 % remote).
pub(crate) const WORKDAYS: u64 = 5;
/// A place outside the wished regions with at least this remote share is near, not missed.
pub(crate) const REGION_REMOTE_NEAR: u64 = 60;
