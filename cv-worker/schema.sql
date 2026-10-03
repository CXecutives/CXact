-- The usage counters of the CV worker. `key` is 'id:<install id>' or 'ip:<hmac of the address>'
-- (IPv6 by its /64), `day` a day 'YYYY-MM-DD' or a month 'YYYY-MM' (UTC), `n` the tries that
-- reached the AI and did not fail. Rows older than 31 days go by the daily cron.
CREATE TABLE IF NOT EXISTS cv_usage (
  key TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (key, day)
) WITHOUT ROWID;
