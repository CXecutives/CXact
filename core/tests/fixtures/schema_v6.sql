-- Frozen schema 6: schema 5 and the indexes of the overview (a date window over the jobs,
-- the last alert mail per portal), before a job knew how it came (user_version 6). Never
-- change this file together with the code - otherwise the migration tests would check their
-- own present instead of the way there.
CREATE TABLE job (
    portal            TEXT    NOT NULL,
    job_id            TEXT    NOT NULL,
    url               TEXT    NOT NULL,
    title             TEXT    NOT NULL,
    company           TEXT    NOT NULL,
    location          TEXT    NOT NULL,
    mail_date         INTEGER,
    mail_subject      TEXT    NOT NULL,
    gmail_id          TEXT,
    first_seen_at     INTEGER NOT NULL,
    first_seen_run    INTEGER NOT NULL,
    last_seen_run     INTEGER NOT NULL,
    desc_status       TEXT    NOT NULL DEFAULT 'missing',
    desc_short        INTEGER NOT NULL DEFAULT 0,
    desc_closed       INTEGER NOT NULL DEFAULT 0,
    desc_text         TEXT,
    desc_fetched_at   INTEGER,
    desc_attempted_at INTEGER,
    desc_attempts     INTEGER NOT NULL DEFAULT 0,
    desc_error        TEXT,
    txt_name          TEXT,
    txt_written_at    INTEGER,
    search            TEXT    NOT NULL,
    match_score       INTEGER,
    match_status      TEXT,
    match_note        TEXT,
    match_at          INTEGER,
    match_rev         TEXT,
    read_at           INTEGER,
    desc_facts        TEXT,
    dup_of            TEXT,
    parser_version    INTEGER,
    pinned_at         INTEGER,
    app_status        TEXT,
    app_status_at     INTEGER,
    note              TEXT,
    archived_at       INTEGER,
    override_include  INTEGER,
    mail_version      INTEGER,
    trashed_at        INTEGER,
    inbox_at          INTEGER,
    PRIMARY KEY (portal, job_id)
) WITHOUT ROWID;
CREATE INDEX job_by_run ON job (first_seen_run);
CREATE TABLE alert_mail (
    mail_key       TEXT    PRIMARY KEY,
    portal         TEXT    NOT NULL,
    subject        TEXT    NOT NULL,
    mail_date      INTEGER,
    gmail_id       TEXT,
    n_postings     INTEGER NOT NULL,
    last_seen_run  INTEGER NOT NULL
) WITHOUT ROWID;
CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE tombstone (
    portal      TEXT    NOT NULL,
    job_id      TEXT    NOT NULL,
    deleted_at  INTEGER NOT NULL,
    PRIMARY KEY (portal, job_id)
) WITHOUT ROWID;
CREATE INDEX job_by_date ON job (COALESCE(mail_date, first_seen_at));
CREATE INDEX alert_by_portal ON alert_mail (portal, mail_date);
