package imap

import (
	"github.com/HimanshuSardana/harbor/internal/config"
	"github.com/HimanshuSardana/harbor/internal/types"
	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

// FetchEmails connects to an IMAP server and retrieves emails for a specified account
//
// Parameters:
//
//	accountName - The name of the account to fetch emails from (must exist in accounts.toml)
//
// This function:
// 1. Loads the configuration from accounts.toml
// 2. Finds the specified account configuration
// 3. Connects to the IMAP server using the account's host and port
// 4. Logs in using the account's email and password
// 5. Fetches and displays the most recent emails (up to 10)
func FetchEmails(account config.Account) ([]types.Email, error) {
	c, err := client.DialTLS(
		account.ImapHost+":993",
		nil,
	)
	if err != nil {
		return nil, err
	}

	defer c.Logout()

	if err := c.Login(
		account.Email,
		account.Password,
	); err != nil {
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

	items := []imap.FetchItem{
		imap.FetchEnvelope,
	}

	messages := make(chan *imap.Message, 10)

	var emails []types.Email

	go func() {
		_ = c.Fetch(seqset, items, messages)
	}()

	for msg := range messages {
		email := types.Email{
			Subject: msg.Envelope.Subject,
			Date:    msg.Envelope.Date,
		}

		if len(msg.Envelope.From) > 0 {
			email.From = msg.Envelope.From[0].Address()
		}

		emails = append(emails, email)
	}

	return emails, nil
}
