package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// GetEmail returns a single email row by its database ID.
func (s *Store) GetEmail(id int64) (*EmailRow, error) {
	row := s.DB.QueryRow(`
		SELECT id, mailbox, imap_uid, filename, subject, from_addr, date, body_text, body_html, flags
		FROM emails WHERE id = ?`, id)
	var r EmailRow
	var bodyText, bodyHTML sql.NullString
	err := row.Scan(&r.ID, &r.Mailbox, &r.IMAPUID, &r.Filename,
		&r.Subject, &r.FromAddr, &r.Date, &bodyText, &bodyHTML, &r.Flags)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	r.BodyText = bodyText.String
	r.BodyHTML = bodyHTML.String
	return &r, nil
}

// MarkSeen adds the Seen flag (S) to the email's flags.
func (s *Store) MarkSeen(id int64) error {
	e, err := s.GetEmail(id)
	if err != nil {
		return err
	}
	if e == nil {
		return fmt.Errorf("email not found")
	}
	newFlags := setFlag(e.Flags, "S")
	if newFlags == e.Flags {
		return nil // already seen
	}
	return s.updateEmailFlags(id, newFlags, e.Filename, true)
}

// MarkUnread removes the Seen flag (S) from the email's flags.
func (s *Store) MarkUnread(id int64) error {
	e, err := s.GetEmail(id)
	if err != nil {
		return err
	}
	if e == nil {
		return fmt.Errorf("email not found")
	}
	newFlags := clearFlag(e.Flags, "S")
	if newFlags == e.Flags {
		return nil // already unread
	}
	return s.updateEmailFlags(id, newFlags, e.Filename, false)
}

// updateEmailFlags updates the flags column in the DB and renames the maildir
// file to reflect the new flags.
func (s *Store) updateEmailFlags(id int64, flags, filename string, seen bool) error {
	// Rename the maildir file to reflect updated flags.
	newName := maildirFilenameWithFlags(filename, seen)
	if newName != filename {
		oldPath := filepath.Join(s.Maildir, filename)
		newPath := filepath.Join(s.Maildir, newName)
		if err := os.Rename(oldPath, newPath); err != nil {
			// Non-fatal — log but still update DB.
			fmt.Fprintf(os.Stderr, "warn: rename maildir %s -> %s: %v\n", oldPath, newPath, err)
		}
	}

	_, err := s.DB.Exec(`UPDATE emails SET flags = ?, filename = ? WHERE id = ?`, flags, newName, id)
	return err
}

// setFlag ensures a single-char flag (e.g. "S") is present in the flags string.
func setFlag(flags, flag string) string {
	if strings.Contains(flags, flag) {
		return flags
	}
	// Maildir convention: flags sorted SFRDT (Seen, Flagged, Replied, Deleted, Draft).
	return sortFlags(flags + flag)
}

// clearFlag removes a single-char flag from the flags string.
func clearFlag(flags, flag string) string {
	return strings.ReplaceAll(flags, flag, "")
}

// sortFlags sorts the flags string in maildir convention: S F R T D.
func sortFlags(flags string) string {
	order := []string{"S", "F", "R", "T", "D"}
	var out string
	for _, ch := range order {
		if strings.Contains(flags, ch) {
			out += ch
		}
	}
	return out
}

// maildirFilenameWithFlags returns a new maildir filename with flags updated
// to reflect whether the message is seen.
func maildirFilenameWithFlags(filename string, seen bool) string {
	// Maildir filename format: {info}:2,{flags}
	// The part after ":2," is the flags.
	i := strings.LastIndex(filename, ":2,")
	if i < 0 {
		// Not a proper maildir name — leave as-is.
		return filename
	}
	oldFlags := filename[i+3:]
	newFlags := oldFlags
	if seen {
		if !strings.Contains(oldFlags, "S") {
			newFlags = sortFlags(oldFlags + "S")
		}
	} else {
		newFlags = strings.ReplaceAll(oldFlags, "S", "")
	}
	return filename[:i+3] + newFlags
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
