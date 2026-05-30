package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/HimanshuSardana/harbor/backend/internal/api"
	"github.com/HimanshuSardana/harbor/backend/internal/imap"
	"github.com/HimanshuSardana/harbor/backend/internal/store"
)

func main() {
	configPath := os.Getenv("HARBOR_CONFIG")
	if configPath == "" {
		configPath = "configs/accounts.toml"
	}

	port := os.Getenv("HARBOR_PORT")
	if port == "" {
		port = "3002"
	}

	dataDir := os.Getenv("HARBOR_DATA")
	if dataDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			dataDir = home + "/.harbor"
		}
	}

	h := api.NewHandler(configPath)

	// Open the local cache store (Maildir + SQLite).
	if dataDir != "" {
		st, err := store.Open(dataDir)
		if err != nil {
			log.Printf("Warning: could not open store at %s: %v (running without cache)", dataDir, err)
		} else {
			h.Store = st
			defer st.Close()
			log.Printf("Store opened at %s", dataDir)

			// Background periodic sync.
			syncInterval := 5 * time.Minute
			if s := os.Getenv("HARBOR_SYNC_INTERVAL"); s != "" {
				if d, err := time.ParseDuration(s); err == nil {
					syncInterval = d
				}
			}
			go func() {
				// Initial sync after a short delay.
				time.Sleep(3 * time.Second)
				for _, acct := range h.Cfg().Accounts {
					if err := imap.Sync(acct, st); err != nil {
						log.Printf("[sync] %s: %v", acct.Email, err)
					}
				}
				// Periodic re-sync.
				ticker := time.NewTicker(syncInterval)
				defer ticker.Stop()
				for range ticker.C {
					for _, acct := range h.Cfg().Accounts {
						if err := imap.Sync(acct, st); err != nil {
							log.Printf("[sync] %s: %v", acct.Email, err)
						}
					}
				}
			}()
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.Health)
	mux.HandleFunc("GET /api/accounts", h.GetAccounts)
	mux.HandleFunc("GET /api/emails", h.GetEmails)
	mux.HandleFunc("GET /api/search", h.SearchEmails)
	mux.HandleFunc("POST /api/sync", h.SyncNow)
	mux.HandleFunc("PATCH /api/emails/{id}/seen", h.MarkSeen)
	mux.HandleFunc("PATCH /api/emails/{id}/unread", h.MarkUnread)

	h.RegisterDocs(mux)

	handler := api.CORS(mux)

	addr := ":" + port
	log.Printf("Harbor API server starting on %s", addr)
	log.Printf("Config path: %s", configPath)

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
