package store

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// SaveRaw writes an .eml file to the maildir and returns the filename (relative
// to the cur/ directory). The filename follows Maildir conventions for
// uniqueness: {unix_nano}.{random}.{account_index}:2,{flags}.
func (s *Store) SaveRaw(mailbox string, imapUID uint32, raw []byte, seen bool) (string, error) {
	host, _ := os.Hostname()
	now := time.Now().UnixNano()
	rand := strconv.FormatInt(now%100000, 36) + fmt.Sprintf("%x", now&0xFFF)

	flags := "S" // Seen
	if !seen {
		flags = ""
	}

	name := fmt.Sprintf("%d.%s.%s:2,%s", now, rand, sanitizeHost(host), flags)
	tmpPath := filepath.Join(s.rootDir, "tmp", name)
	curPath := filepath.Join(s.Maildir, name)

	// Write to tmp/ first, then rename atomically.
	if err := os.WriteFile(tmpPath, raw, 0600); err != nil {
		return "", fmt.Errorf("write tmp: %w", err)
	}
	if err := os.Rename(tmpPath, curPath); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("rename to cur: %w", err)
	}

	return name, nil
}

// ReadRaw returns the raw bytes of an .eml file given its filename.
func (s *Store) ReadRaw(filename string) ([]byte, error) {
	return os.ReadFile(filepath.Join(s.Maildir, filename))
}

// DeleteRaw removes an .eml file from the maildir.
func (s *Store) DeleteRaw(filename string) error {
	return os.Remove(filepath.Join(s.Maildir, filename))
}

// sanitizeHost makes a hostname safe for Maildir filenames.
func sanitizeHost(h string) string {
	h = strings.ReplaceAll(h, ".", "_")
	h = strings.ReplaceAll(h, ":", "_")
	return h
}
