package imap

import (
	"encoding/base64"
	"fmt"
	"io"
	"mime/quotedprintable"
	"net/mail"
	"strings"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"

	"github.com/HimanshuSardana/harbor/backend/internal/config"
	"github.com/HimanshuSardana/harbor/backend/internal/types"
)

// FetchEmails connects to an IMAP server and retrieves emails for a specified
// account. Returns up to 10 most recent emails including their HTML body when
// available (falls back to plain text).
func FetchEmails(account config.Account) ([]types.Email, error) {
	c, err := client.DialTLS(account.ImapHost+":993", nil)
	if err != nil {
		return nil, err
	}
	defer c.Logout()

	if err := c.Login(account.Email, account.Password); err != nil {
		return nil, err
	}

	mbox, err := c.Select("INBOX", false)
	if err != nil {
		return nil, err
	}

	from := uint32(1)
	if mbox.Messages > 10 {
		from = mbox.Messages - 9
	}
	to := mbox.Messages

	seqset := new(imap.SeqSet)
	seqset.AddRange(from, to)

	// ---------------------------------------------------------------------------
	// Phase 1 — fetch envelope + body structure for every message
	// ---------------------------------------------------------------------------
	items := []imap.FetchItem{
		imap.FetchEnvelope,
		imap.FetchBodyStructure,
	}

	messages := make(chan *imap.Message, 10)
	var fetchErr error
	go func() {
		fetchErr = c.Fetch(seqset, items, messages)
	}()

	type partial struct {
		email types.Email
		bs    *imap.BodyStructure
		seq   uint32
	}
	var partials []partial

	for msg := range messages {
		e := types.Email{
			Subject: msg.Envelope.Subject,
			Date:    msg.Envelope.Date,
		}
		if len(msg.Envelope.From) > 0 {
			e.From = msg.Envelope.From[0].Address()
		}
		partials = append(partials, partial{email: e, bs: msg.BodyStructure, seq: msg.SeqNum})
	}

	if fetchErr != nil {
		return nil, fetchErr
	}

	// ---------------------------------------------------------------------------
	// Phase 2 — fetch the best body section (HTML preferred) for each message
	//
	// go-imap's message.Body map uses *BodySectionName as keys parsed from the
	// server response (different pointers). The server also strips .PEEK from the
	// response key. We therefore iterate the map and compare by BodyPartName
	// equality (ignoring Peek) instead of doing a direct pointer lookup.
	//
	// Additionally, Gmail IMAP rejects BODY[<path>.TEXT] for sub-parts, so we
	// request the entire sub-part (BODY[<path>]) and strip the MIME headers that
	// precede the content.
	// ---------------------------------------------------------------------------
	for i, p := range partials {
		path := findTextBodyPart(p.bs, true)
		if path == nil {
			continue
		}

		// For single-part messages (empty path) use TEXT specifier.
		// For sub-parts use the entire-part specifier and strip MIME headers.
		section := &imap.BodySectionName{
			BodyPartName: imap.BodyPartName{
				Specifier: imap.EntireSpecifier,
				Path:      path,
			},
			Peek: true,
		}
		if len(path) == 0 {
			section.Specifier = imap.TextSpecifier
		}

		// Build a lightweight matcher that ignores the Peek flag.
		matchSpec := imap.BodyPartName{
			Specifier: section.Specifier,
			Path:      path,
		}

		singleSeq := new(imap.SeqSet)
		singleSeq.AddNum(p.seq)

		bodyCh := make(chan *imap.Message, 1)
		go func() {
			_ = c.Fetch(singleSeq, []imap.FetchItem{section.FetchItem()}, bodyCh)
		}()

		for bodyMsg := range bodyCh {
			for s, lit := range bodyMsg.Body {
				if s.Specifier == matchSpec.Specifier && pathsEqual(s.Path, matchSpec.Path) {
					data, err := io.ReadAll(lit)
					if err == nil {
						body := decodeMIMEBody(data)
						partials[i].email.Body = body
					}
					break
				}
			}
		}
	}

	emails := make([]types.Email, len(partials))
	for i, p := range partials {
		emails[i] = p.email
	}
	return emails, nil
}

// findTextBodyPart walks the MIME body-structure tree and returns the part-path
// to the best text leaf. It prefers text/html over text/plain.
//
// The returned path is safe to use directly in a BodySectionName. Returns nil
// when no suitable text part exists.
func findTextBodyPart(bs *imap.BodyStructure, preferHTML bool) []int {
	if bs == nil {
		return nil
	}

	// Leaf — single-part message
	if len(bs.Parts) == 0 {
		if strings.EqualFold(bs.MIMEType, "text") &&
			(strings.EqualFold(bs.MIMESubType, "html") || strings.EqualFold(bs.MIMESubType, "plain")) {
			if strings.EqualFold(bs.MIMESubType, "html") {
				return []int{}
			}
			if !preferHTML {
				return []int{}
			}
			// Plain text while we prefer HTML – return sentinel so caller can
			// still pick it when no HTML exists anywhere in the tree.
			return []int{-1}
		}
		return nil
	}

	// Multipart — search children.
	var htmlPaths [][]int
	var textPaths [][]int
	for i, part := range bs.Parts {
		childPath := findTextBodyPart(part, preferHTML)
		if childPath == nil {
			continue
		}

		isHTML := false
		var fullPath []int

		if len(childPath) > 0 && childPath[0] == -1 {
			// Sentinel: leaf was plain text while we wanted HTML.
			fullPath = append([]int{i + 1}, childPath[1:]...)
		} else {
			fullPath = append([]int{i + 1}, childPath...)
			if len(childPath) == 0 && len(part.Parts) == 0 {
				isHTML = strings.EqualFold(part.MIMESubType, "html")
			} else {
				leaf := leafPart(part)
				isHTML = leaf != nil && strings.EqualFold(leaf.MIMESubType, "html")
			}
		}

		if isHTML {
			htmlPaths = append(htmlPaths, fullPath)
		} else {
			textPaths = append(textPaths, fullPath)
		}
	}

	// For multipart/alternative: later parts are more preferred.
	// For other multipart types: first text part is the primary content.
	switch {
	case len(htmlPaths) > 0:
		if strings.EqualFold(bs.MIMESubType, "alternative") {
			return htmlPaths[len(htmlPaths)-1]
		}
		return htmlPaths[0]
	case len(textPaths) > 0:
		if strings.EqualFold(bs.MIMESubType, "alternative") {
			return textPaths[len(textPaths)-1]
		}
		return textPaths[0]
	default:
		return nil
	}
}

// leafPart walks down to the first non-multipart leaf.
func leafPart(bs *imap.BodyStructure) *imap.BodyStructure {
	if bs == nil {
		return nil
	}
	for len(bs.Parts) > 0 {
		bs = bs.Parts[0]
	}
	return bs
}

// DumpBodyStructure returns a human-readable tree representation of an IMAP
// body structure. Useful for debugging what the server returns.
func DumpBodyStructure(bs *imap.BodyStructure) string {
	var b strings.Builder
	dumpBSTree(bs, &b, 0)
	return b.String()
}

func dumpBSTree(bs *imap.BodyStructure, b *strings.Builder, depth int) {
	if bs == nil {
		fmt.Fprintf(b, "%s(nil)\n", indent(depth))
		return
	}
	fmt.Fprintf(b, "%s%s/%s  enc=%q  size=%d\n", indent(depth), bs.MIMEType, bs.MIMESubType, bs.Encoding, bs.Size)
	for i, part := range bs.Parts {
		fmt.Fprintf(b, "%s[%d]:\n", indent(depth), i+1)
		dumpBSTree(part, b, depth+2)
	}
}

func indent(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		s += "  "
	}
	return s
}

// pathsEqual reports whether two IMAP body-part paths are identical.
func pathsEqual(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// decodeMIMEBody parses a raw MIME part (headers + body), decodes the body
// per Content-Transfer-Encoding, and returns the decoded string.
// Uses net/mail.ReadMessage which properly handles header unfolding and
// multi-line headers.
func decodeMIMEBody(raw []byte) string {
	// Find the blank line separating headers from body.
	sep := []byte("\r\n\r\n")
	idx := strings.Index(string(raw), string(sep))
	if idx == -1 {
		sep = []byte("\n\n")
		idx = strings.Index(string(raw), string(sep))
	}
	if idx == -1 {
		// No headers — entire content is the body.
		return string(raw)
	}

	// Read headers via net/mail.
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		// Fallback: return everything after the header separator.
		return string(raw[idx+len(sep):])
	}

	enc := strings.ToLower(msg.Header.Get("Content-Transfer-Encoding"))

	switch enc {
	case "quoted-printable":
		dec, err := io.ReadAll(quotedprintable.NewReader(msg.Body))
		if err == nil {
			return string(dec)
		}
		// Fallback: read raw body
		rawBody, _ := io.ReadAll(msg.Body)
		return string(rawBody)
	case "base64":
		rawBody, _ := io.ReadAll(msg.Body)
		// Try standard base64 first.
		dst := make([]byte, base64.StdEncoding.DecodedLen(len(rawBody)))
		n, err := base64.StdEncoding.Decode(dst, rawBody)
		if err == nil {
			return string(dst[:n])
		}
		// Strip line breaks and retry (common for MIME base64).
		clean := strings.Map(func(r rune) rune {
			if r == '\n' || r == '\r' {
				return -1
			}
			return r
		}, string(rawBody))
		dst2 := make([]byte, base64.StdEncoding.DecodedLen(len(clean)))
		n2, err2 := base64.StdEncoding.Decode(dst2, []byte(clean))
		if err2 == nil {
			return string(dst2[:n2])
		}
		return string(rawBody)
	default:
		// 7bit, 8bit, binary, or unspecified — return as-is.
		rawBody, _ := io.ReadAll(msg.Body)
		return string(rawBody)
	}
}
