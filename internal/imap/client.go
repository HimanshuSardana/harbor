package imap

import (
	"fmt"
	"log"

	"github.com/HimanshuSardana/harbor/internal/config"
	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

// FetchMails connects to an IMAP server and retrieves emails for a specified account
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
func FetchMails(accountName string) {
	cfg, err := config.LoadConfig("accounts.toml")
	if err != nil {
		log.Fatal("Failed to load config:", err)
	}

	var account *config.Account
	for _, acc := range cfg.Accounts {
		if acc.Name == accountName {
			account = &acc
			break
		}
	}

	if account == nil {
		log.Fatal("Account not found:", accountName)
	}

	c, err := client.DialTLS(fmt.Sprintf("%s:%d", account.ImapHost, account.ImapPort), nil)
	if err != nil {
		log.Fatal("Failed to connect:", err)
	}
	defer c.Logout()

	fmt.Printf("Connected to %s\n", account.ImapHost)

	if err := c.Login(account.Email, account.Password); err != nil {
		log.Fatal("Failed to login:", err)
	}

	fmt.Printf("Logged in as %s\n", account.Email)

	mbox, err := c.Select("INBOX", false)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println("Total messages:", mbox.Messages)

	if mbox.Messages == 0 {
		fmt.Println("No messages found")
		return
	}

	from := uint32(1)

	if mbox.Messages > 10 {
		from = mbox.Messages - 9
	}

	to := mbox.Messages

	seqset := new(imap.SeqSet)
	seqset.AddRange(from, to)

	section := &imap.BodySectionName{}

	items := []imap.FetchItem{
		imap.FetchEnvelope,
		section.FetchItem(),
	}

	messages := make(chan *imap.Message, 10)

	go func() {
		if err := c.Fetch(seqset, items, messages); err != nil {
			log.Fatal(err)
		}
	}()

	for msg := range messages {
		fmt.Println("===================================")
		fmt.Println("Subject:", msg.Envelope.Subject)

		if len(msg.Envelope.From) > 0 {
			fmt.Println("From:", msg.Envelope.From[0].Address())
		}

		fmt.Println("Date:", msg.Envelope.Date)
	}
}
