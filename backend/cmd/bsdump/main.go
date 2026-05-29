package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"strings"

	"github.com/HimanshuSardana/harbor/backend/internal/config"
	goimap "github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
)

func main() {
	configPath := os.Getenv("HARBOR_CONFIG")
	if configPath == "" {
		configPath = "configs/accounts.toml"
	}

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		log.Fatal("Config error:", err)
	}
	if len(cfg.Accounts) == 0 {
		log.Fatal("No accounts")
	}
	account := cfg.Accounts[0]

	c, err := client.DialTLS(account.ImapHost+":993", nil)
	if err != nil {
		log.Fatal("Dial error:", err)
	}
	defer c.Logout()

	if err := c.Login(account.Email, account.Password); err != nil {
		log.Fatal("Login error:", err)
	}

	mbox, err := c.Select("INBOX", false)
	if err != nil {
		log.Fatal("Select error:", err)
	}
	log.Printf("INBOX has %d messages", mbox.Messages)

	// Fetch latest email
	seqset := new(goimap.SeqSet)
	seqset.AddNum(mbox.Messages)

	messages := make(chan *goimap.Message, 1)
	errCh := make(chan error, 1)
	go func() {
		errCh <- c.Fetch(seqset, []goimap.FetchItem{goimap.FetchEnvelope, goimap.FetchBodyStructure}, messages)
	}()

	msg := <-messages
	if err := <-errCh; err != nil {
		log.Fatal("Phase 1 fetch error:", err)
	}

	fmt.Printf("Subject: %s\n", msg.Envelope.Subject)

	// Try BODY.PEEK[2] (entire second part)
	section := &goimap.BodySectionName{
		BodyPartName: goimap.BodyPartName{
			Path: []int{2},
		},
		Peek: true,
	}
	wanted := string(section.FetchItem())
	log.Printf("Fetching with: %s", wanted)

	bodyCh := make(chan *goimap.Message, 1)
	errCh2 := make(chan error, 1)
	go func() {
		errCh2 <- c.Fetch(seqset, []goimap.FetchItem{section.FetchItem()}, bodyCh)
	}()

	bodyMsg, ok := <-bodyCh
	if !ok {
		log.Fatal("no messages returned")
	}

	for s, lit := range bodyMsg.Body {
		key := string(s.FetchItem())
		log.Printf("Found key: %q (compared to wanted: %q)", key, wanted)
		if key == "BODY[2]" {
			data, _ := io.ReadAll(lit)
			text := string(data)
			fmt.Printf("\n=== Raw BODY[2] (%d bytes) ===\n%s\n", len(data), text[:min(len(data), 1000)])
			
			// Check if it has MIME headers
			if strings.Contains(text, "Content-Type:") {
				fmt.Println("\n--- Contains MIME headers ---")
				// Split headers from body
				parts := strings.SplitN(text, "\r\n\r\n", 2)
				if len(parts) == 2 {
					fmt.Printf("Headers:\n%s\n", parts[0])
					fmt.Printf("Body (%d bytes):\n%s\n", len(parts[1]), parts[1][:min(len(parts[1]), 500)])
				} else {
					parts = strings.SplitN(text, "\n\n", 2)
					if len(parts) == 2 {
						fmt.Printf("Headers:\n%s\n", parts[0])
						fmt.Printf("Body (%d bytes):\n%s\n", len(parts[1]), parts[1][:min(len(parts[1]), 500)])
					}
				}
			}
		}
	}

	if err := <-errCh2; err != nil {
		log.Printf("Phase 2 error: %v", err)
	}
}
