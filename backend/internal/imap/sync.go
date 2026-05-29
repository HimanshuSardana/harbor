package imap

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"

	"github.com/HimanshuSardana/harbor/backend/internal/config"
	"github.com/HimanshuSardana/harbor/backend/internal/store"
)

const syncBatchSize   = 50    // max new emails per forward sync
const backfillBatchSize = 50  // max old emails per backfill request

// SyncOlder fetches up to count messages before the oldest synced UID.
// This is a backfill — it reaches backwards into the mailbox history.
// Pass count=0 to use the default batch size (50).
func SyncOlder(account config.Account, st *store.Store, count int) error {
	st.LockSync()
	defer st.UnlockSync()

	mailbox := account.Email
	_, uidFirst, _ := st.GetSyncState(mailbox)

	if count <= 0 {
		count = backfillBatchSize
	}

	log.Printf("[backfill] %s: start (uid_first=%d, count=%d)", mailbox, uidFirst, count)

	c, err := client.DialTLS(account.ImapHost+":993", nil)
	if err != nil {
		return fmt.Errorf("dial %s: %w", account.ImapHost, err)
	}
	defer c.Logout()

	if err := c.Login(account.Email, account.Password); err != nil {
		return fmt.Errorf("login: %w", err)
	}

	mbox, err := c.Select("INBOX", true)
	if err != nil {
		return fmt.Errorf("select: %w", err)
	}

	// If we've never synced uid_first defaults to 0 meaning "not set."
	// In that case uid_first = uid_next - 1 or just mbox.UidNext - 1.
	if uidFirst == 0 {
		uidFirst = mbox.UidNext - 1
	}

	// Everything is already synced.
	if uidFirst <= 1 {
		log.Printf("[backfill] %s: no older messages (uid_first=%d)", mailbox, uidFirst)
		return nil
	}

	// Build a range for older messages.
	end := uidFirst - 1
	start := uint32(1)
	if end > uint32(count) {
		start = end - uint32(count) + 1
	}

	log.Printf("[backfill] %s: fetching UIDs %d–%d (%d msgs)", mailbox, start, end, end-start+1)

	seqset := new(imap.SeqSet)
	seqset.AddRange(start, end)

	bodySection := &imap.BodySectionName{
		BodyPartName: imap.BodyPartName{Specifier: imap.EntireSpecifier},
		Peek:         true,
	}

	items := []imap.FetchItem{
		imap.FetchEnvelope,
		imap.FetchBodyStructure,
		imap.FetchFlags,
		imap.FetchUid,
		bodySection.FetchItem(),
	}

	messages := make(chan *imap.Message, count)
	var fetchErr error
	go func() { fetchErr = c.UidFetch(seqset, items, messages) }()

	var oldestUID uint32
	synced := 0
	for msg := range messages {
		raw := extractRawFromBody(msg)
		if raw == nil {
			continue
		}
		row := emailRowFromMessage(msg, mailbox)
		row.BodyText, row.BodyHTML = extractTextBodies(raw)

		seen := hasFlag(msg.Flags, "\\Seen")
		filename, err := st.SaveRaw(mailbox, msg.Uid, raw, seen)
		if err != nil {
			log.Printf("[backfill] %s: save .eml UID=%d: %v", mailbox, msg.Uid, err)
			continue
		}
		row.Filename = filename

		if err := st.InsertEmail(row); err != nil {
			log.Printf("[backfill] %s: insert UID=%d: %v", mailbox, msg.Uid, err)
			continue
		}
		if oldestUID == 0 || msg.Uid < oldestUID {
			oldestUID = msg.Uid
		}
		synced++
	}

	if fetchErr != nil {
		return fmt.Errorf("fetch: %w", fetchErr)
	}

	// Update the uid_first boundary so subsequent backfills go further back.
	if synced > 0 {
		if err := st.SetSyncStateBackfill(mailbox, oldestUID); err != nil {
			return fmt.Errorf("save backfill state: %w", err)
		}
	}

	log.Printf("[backfill] %s: done — %d synced, uid_first now %d", mailbox, synced, oldestUID)
	return nil
}

// Sync pulls new messages from the IMAP server since the last sync, writes
// each as an .eml file into the maildir, and indexes the metadata + body text
// in the SQLite store.
func Sync(account config.Account, st *store.Store) error {
	st.LockSync()
	defer st.UnlockSync()

	mailbox := account.Email
	uidNext, _, uidValidity := st.GetSyncState(mailbox)

	log.Printf("[sync] %s: start (uid_next=%d, uid_validity=%d)", mailbox, uidNext, uidValidity)

	c, err := client.DialTLS(account.ImapHost+":993", nil)
	if err != nil {
		return fmt.Errorf("dial %s: %w", account.ImapHost, err)
	}
	defer c.Logout()

	if err := c.Login(account.Email, account.Password); err != nil {
		return fmt.Errorf("login: %w", err)
	}

	mbox, err := c.Select("INBOX", true) // read-only
	if err != nil {
		return fmt.Errorf("select: %w", err)
	}

	// UIDVALIDITY changed → full re-sync.
	if uidValidity != 0 && mbox.UidValidity != uidValidity {
		log.Printf("[sync] %s: UIDVALIDITY changed (%d → %d), re-syncing", mailbox, uidValidity, mbox.UidValidity)
		uidNext = 0
	}

	if mbox.UidNext <= uidNext {
		log.Printf("[sync] %s: up-to-date", mailbox)
		return nil
	}

	// Build UID range for new messages.
	start := uidNext
	if start == 0 {
		start = 1
	}
	end := mbox.UidNext - 1

	count := int(end - start + 1)
	if count > syncBatchSize {
		// Only sync the most recent batch to keep initial sync fast.
		start = end - syncBatchSize + 1
	}

	log.Printf("[sync] %s: fetching UIDs %d–%d (%d msgs)", mailbox, start, end, end-start+1)

	seqset := new(imap.SeqSet)
	seqset.AddRange(start, end)

	// Request: envelope, structure, flags, UID, and the full raw message body.
	bodySection := &imap.BodySectionName{
		BodyPartName: imap.BodyPartName{Specifier: imap.EntireSpecifier},
		Peek:         true, // don't mark as seen
	}

	items := []imap.FetchItem{
		imap.FetchEnvelope,
		imap.FetchBodyStructure,
		imap.FetchFlags,
		imap.FetchUid,
		bodySection.FetchItem(), // "BODY.PEEK[]"
	}

	messages := make(chan *imap.Message, syncBatchSize)
	var fetchErr error
	go func() { fetchErr = c.UidFetch(seqset, items, messages) }()

	var oldestUID uint32
	synced := 0
	for msg := range messages {
		// Extract the raw message bytes from the BODY[] response.
		raw := extractRawFromBody(msg)
		if raw == nil {
			log.Printf("[sync] %s: no BODY[] for UID %d, skipping", mailbox, msg.Uid)
			continue
		}

		// Parse metadata.
		row := emailRowFromMessage(msg, mailbox)
		row.BodyText, row.BodyHTML = extractTextBodies(raw)

		// Write .eml to maildir.
		seen := hasFlag(msg.Flags, "\\Seen")
		filename, err := st.SaveRaw(mailbox, msg.Uid, raw, seen)
		if err != nil {
			log.Printf("[sync] %s: save .eml UID=%d: %v", mailbox, msg.Uid, err)
			continue
		}
		row.Filename = filename

		// Write metadata to SQLite.
		if err := st.InsertEmail(row); err != nil {
			log.Printf("[sync] %s: insert UID=%d: %v", mailbox, msg.Uid, err)
			continue
		}
		if oldestUID == 0 || msg.Uid < oldestUID {
			oldestUID = msg.Uid
		}
		synced++
	}

	if fetchErr != nil {
		return fmt.Errorf("fetch: %w", fetchErr)
	}

	if err := st.SetSyncState(mailbox, mbox.UidNext, mbox.UidValidity); err != nil {
		return fmt.Errorf("save sync state: %w", err)
	}

	// Record uid_first on the very first forward sync so backfill knows
	// where the oldest synced message lives.
	if uidNext == 0 && synced > 0 {
		_ = st.SetSyncStateBackfill(mailbox, oldestUID)
	}

	log.Printf("[sync] %s: done — %d new, uid_next now %d", mailbox, synced, mbox.UidNext)
	return nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// extractRawFromBody looks for the BODY[] section in the FETCH response.
func extractRawFromBody(msg *imap.Message) []byte {
	for section, lit := range msg.Body {
		if section.Specifier == imap.EntireSpecifier && len(section.Path) == 0 {
			data, err := io.ReadAll(lit)
			if err == nil && len(data) > 0 {
				return data
			}
		}
	}
	return nil
}

// emailRowFromMessage builds an EmailRow from the IMAP message metadata.
func emailRowFromMessage(msg *imap.Message, mailbox string) *store.EmailRow {
	return &store.EmailRow{
		Mailbox:  mailbox,
		IMAPUID:  int(msg.Uid),
		Subject:  msg.Envelope.Subject,
		FromAddr: senderFromEnvelope(msg.Envelope),
		Date:     msg.Envelope.Date.Format(time.RFC3339),
		Flags:    formatFlags(msg.Flags),
	}
}

// extractTextBodies parses a raw RFC 5322 message and returns the plain-text
// and HTML bodies (fully decoded), extracted from the MIME tree.
func extractTextBodies(raw []byte) (textBody, htmlBody string) {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return "", ""
	}
	return extractFromPart(msg.Header, msg.Body)
}

// extractFromPart recursively walks a MIME part tree and collects text content.
func extractFromPart(header mail.Header, body io.Reader) (text, html string) {
	mediaType, params, err := mime.ParseMediaType(header.Get("Content-Type"))
	if err != nil {
		mediaType = "text/plain"
	}
	mediaType = strings.ToLower(mediaType)

	enc := strings.ToLower(strings.TrimSpace(header.Get("Content-Transfer-Encoding")))

	switch {
	case mediaType == "text/plain":
		data := decodeBodyReader(body, enc)
		return data, ""

	case mediaType == "text/html":
		data := decodeBodyReader(body, enc)
		return "", data

	case strings.HasPrefix(mediaType, "multipart/"):
		// The body is itself a multipart container.
		boundary := params["boundary"]
		if boundary == "" {
			full, _ := io.ReadAll(body)
			_ = full // can't parse without boundary
			return "", ""
		}
		mr := multipart.NewReader(body, boundary)
		for {
			p, err := mr.NextPart()
			if err != nil {
				break
			}
			t, h := extractFromPart(mail.Header(p.Header), p)
			if t != "" && text == "" {
				text = t
			}
			if h != "" && html == "" {
				html = h
			}
			if text != "" && html != "" {
				break
			}
		}

	case mediaType == "message/rfc822":
		// Nested (forwarded) message — recurse.
		nested, err := mail.ReadMessage(body)
		if err == nil {
			t, h := extractFromPart(nested.Header, nested.Body)
			if text == "" {
				text = t
			}
			if html == "" {
				html = h
			}
		}
	}

	return text, html
}

// decodeBodyReader reads all bytes from r and decodes per the given
// Content-Transfer-Encoding.
func decodeBodyReader(r io.Reader, enc string) string {
	var dec io.Reader
	switch enc {
	case "quoted-printable":
		dec = quotedprintable.NewReader(r)
	case "base64":
		dec = base64.NewDecoder(base64.StdEncoding, r)
	default:
		dec = r
	}
	data, err := io.ReadAll(dec)
	if err != nil {
		return ""
	}
	return string(data)
}

// hasFlag checks if the flags slice contains the given flag (case-insensitive).
func hasFlag(flags []string, flag string) bool {
	for _, f := range flags {
		if strings.EqualFold(f, flag) {
			return true
		}
	}
	return false
}

// senderFromEnvelope extracts the sender address from an IMAP envelope.
func senderFromEnvelope(env *imap.Envelope) string {
	if len(env.From) > 0 {
		return env.From[0].Address()
	}
	if len(env.Sender) > 0 {
		return env.Sender[0].Address()
	}
	return ""
}

// formatFlags formats IMAP flags into a compact Maildir-style string.
func formatFlags(flags []string) string {
	var out string
	for _, f := range flags {
		switch {
		case strings.EqualFold(f, "\\Seen"):
			out += "S"
		case strings.EqualFold(f, "\\Flagged"):
			out += "F"
		case strings.EqualFold(f, "\\Answered"):
			out += "R"
		case strings.EqualFold(f, "\\Deleted"):
			out += "T"
		case strings.EqualFold(f, "\\Draft"):
			out += "D"
		}
	}
	return out
}
