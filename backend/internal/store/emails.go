package store

import (
	"database/sql"
	"time"
)

// EmailRow is a single row from the emails table.
type EmailRow struct {
	ID       int64  `json:"id"`
	Mailbox  string `json:"mailbox"`
	IMAPUID  int    `json:"imap_uid"`
	Filename string `json:"filename"`
	Subject  string `json:"subject"`
	FromAddr string `json:"from_addr"`
	Date     string `json:"date"`
	BodyText string `json:"body_text,omitempty"`
	BodyHTML string `json:"body_html,omitempty"`
	Flags    string `json:"flags"`
}

// InsertEmail inserts one email record. If the (mailbox, imap_uid) pair already
// exists it is a no-op (conflict is silently ignored).
func (s *Store) InsertEmail(e *EmailRow) error {
	_, err := s.DB.Exec(`
		INSERT OR IGNORE INTO emails
			(mailbox, imap_uid, filename, subject, from_addr, date, body_text, body_html, flags)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Mailbox, e.IMAPUID, e.Filename, e.Subject, e.FromAddr,
		e.Date, e.BodyText, e.BodyHTML, e.Flags,
	)
	return err
}

// ListEmails returns emails ordered by date descending with the given limit/offset.
func (s *Store) ListEmails(limit, offset int, mailbox string) ([]EmailRow, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	q := `SELECT id, mailbox, imap_uid, filename, subject, from_addr, date, body_text, body_html, flags
		  FROM emails
		  WHERE mailbox = ?
		  ORDER BY date DESC
		  LIMIT ? OFFSET ?`
	return s.queryEmails(q, mailbox, limit, offset)
}

// SearchEmails performs a full-text search on the FTS5 index.
// q is an FTS5 query string (supports AND, OR, NOT, phrases, prefix).
func (s *Store) SearchEmails(q, mailbox string, limit int) ([]EmailRow, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	stmt := `SELECT e.id, e.mailbox, e.imap_uid, e.filename,
					e.subject, e.from_addr, e.date, e.body_text, e.body_html, e.flags
			  FROM emails_fts
			  JOIN emails e ON e.id = emails_fts.rowid
			  WHERE emails_fts MATCH ?
			    AND e.mailbox = ?
			  ORDER BY rank
			  LIMIT ?`

	return s.queryEmails(stmt, q, mailbox, limit)
}

// queryEmails is a helper that scans rows into EmailRow slices.
func (s *Store) queryEmails(query string, args ...interface{}) ([]EmailRow, error) {
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EmailRow
	for rows.Next() {
		var r EmailRow
		var bodyText, bodyHTML sql.NullString
		if err := rows.Scan(&r.ID, &r.Mailbox, &r.IMAPUID, &r.Filename,
			&r.Subject, &r.FromAddr, &r.Date, &bodyText, &bodyHTML, &r.Flags); err != nil {
			return nil, err
		}
		r.BodyText = bodyText.String
		r.BodyHTML = bodyHTML.String
		out = append(out, r)
	}
	return out, rows.Err()
}

// CountEmails returns the total number of cached emails for a given mailbox.
func (s *Store) CountEmails(mailbox string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM emails WHERE mailbox = ?`, mailbox).Scan(&n)
	return n, err
}

// ---------------------------------------------------------------------------
// Sync-state helpers
// ---------------------------------------------------------------------------

// GetSyncState returns the stored UIDNEXT, UIDVALIDITY and UID_FIRST for a mailbox.
func (s *Store) GetSyncState(mailbox string) (uidNext, uidFirst, uidValidity uint32) {
	row := s.DB.QueryRow(`SELECT COALESCE(uid_next,0), COALESCE(uid_first,0), COALESCE(uid_validity,0) FROM sync_state WHERE mailbox = ?`, mailbox)
	row.Scan(&uidNext, &uidFirst, &uidValidity)
	return uidNext, uidFirst, uidValidity
}

// SetSyncState stores the forward sync boundary (uid_next = next new UID to fetch).
func (s *Store) SetSyncState(mailbox string, uidNext, uidValidity uint32) error {
	_, err := s.DB.Exec(`
		INSERT INTO sync_state (mailbox, uid_next, uid_validity, updated_at)
		VALUES (?, ?, ?, datetime('now'))
		ON CONFLICT(mailbox) DO UPDATE SET
			uid_next     = excluded.uid_next,
			uid_validity = excluded.uid_validity,
			updated_at   = datetime('now')`,
		mailbox, uidNext, uidValidity)
	return err
}

// SetSyncStateBackfill records a backfill — reduces uid_first so subsequent
// backfill calls know how far back we've gone.
func (s *Store) SetSyncStateBackfill(mailbox string, uidFirst uint32) error {
	_, err := s.DB.Exec(`
		INSERT INTO sync_state (mailbox, uid_first, updated_at)
		VALUES (?, ?, datetime('now'))
		ON CONFLICT(mailbox) DO UPDATE SET
			uid_first  = CASE
				WHEN sync_state.uid_first = 0 THEN excluded.uid_first
				WHEN excluded.uid_first = 0 THEN sync_state.uid_first
				ELSE MIN(sync_state.uid_first, excluded.uid_first)
			END,
			updated_at = datetime('now')`,
		mailbox, uidFirst)
	return err
}

// ParseTimeOrFallback tries to parse an RFC3339 time, returning a zero time on failure.
func ParseTimeOrFallback(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		var zero time.Time
		return zero
	}
	return t
}
