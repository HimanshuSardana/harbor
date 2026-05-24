package imap

import (
	"fmt"
	"log"

	"github.com/HimanshuSardana/harbor/internal/config"
	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

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
