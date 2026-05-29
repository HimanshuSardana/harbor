package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DefaultDir is the default data directory under $HOME.
const DefaultDir = ".harbor"

// Store wraps the SQLite database handle and the maildir path.
type Store struct {
	DB      *sql.DB
	Maildir string // absolute path to the cur/ directory
	rootDir string // absolute path to the $HOME/.harbor directory
}

// Open opens (or creates) the local email cache.
// dataDir is the directory (defaults to $HOME/.harbor if empty).
func Open(dataDir string) (*Store, error) {
	if dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("cannot determine home dir: %w", err)
		}
		dataDir = filepath.Join(home, DefaultDir)
	}

	// Create directory structure.
	curDir := filepath.Join(dataDir, "cur")
	tmpDir := filepath.Join(dataDir, "tmp")
	for _, d := range []string{dataDir, curDir, tmpDir} {
		if err := os.MkdirAll(d, 0700); err != nil {
			return nil, fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	dbPath := filepath.Join(dataDir, "harbor.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// WAL mode for concurrent reads during background sync.
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("wal pragma: %w", err)
	}
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		return nil, fmt.Errorf("busy_timeout pragma: %w", err)
	}

	s := &Store{
		DB:      db,
		Maildir: curDir,
		rootDir: dataDir,
	}

	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return s, nil
}

// Close shuts down the database.
func (s *Store) Close() error {
	return s.DB.Close()
}

// migrate creates the schema if it doesn't exist.
func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS emails (
		id           INTEGER PRIMARY KEY AUTOINCREMENT,
		mailbox      TEXT    NOT NULL,
		imap_uid     INTEGER NOT NULL,
		filename     TEXT    NOT NULL UNIQUE,
		subject      TEXT    NOT NULL DEFAULT '',
		from_addr    TEXT    NOT NULL DEFAULT '',
		date         TEXT    NOT NULL,
		body_text    TEXT    NOT NULL DEFAULT '',
		body_html    TEXT    NOT NULL DEFAULT '',
		flags        TEXT    NOT NULL DEFAULT '',
		created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
		UNIQUE(mailbox, imap_uid)
	);

	CREATE INDEX IF NOT EXISTS idx_emails_date     ON emails(date DESC);
	CREATE INDEX IF NOT EXISTS idx_emails_mailbox  ON emails(mailbox);

	CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
		subject, from_addr, body_text, body_html,
		tokenize='porter unicode61',
		content='emails',
		content_rowid='id'
	);

	CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
		INSERT INTO emails_fts (rowid, subject, from_addr, body_text, body_html)
		VALUES (new.id, new.subject, new.from_addr, new.body_text, new.body_html);
	END;

	CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
		INSERT INTO emails_fts (emails_fts, rowid, subject, from_addr, body_text, body_html)
		VALUES ('delete', old.id, old.subject, old.from_addr, old.body_text, old.body_html);
	END;

	CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
		INSERT INTO emails_fts (emails_fts, rowid, subject, from_addr, body_text, body_html)
		VALUES ('delete', old.id, old.subject, old.from_addr, old.body_text, old.body_html);
		INSERT INTO emails_fts (rowid, subject, from_addr, body_text, body_html)
		VALUES (new.id, new.subject, new.from_addr, new.body_text, new.body_html);
	END;

	CREATE TABLE IF NOT EXISTS sync_state (
		mailbox      TEXT PRIMARY KEY,
		uid_next     INTEGER NOT NULL DEFAULT 1,
		uid_validity INTEGER NOT NULL DEFAULT 0,
		updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
	);
	`
	_, err := s.DB.Exec(schema)
	return err
}
