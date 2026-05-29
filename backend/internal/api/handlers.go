package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/HimanshuSardana/harbor/backend/internal/config"
	"github.com/HimanshuSardana/harbor/backend/internal/imap"
	"github.com/HimanshuSardana/harbor/backend/internal/store"
)

type Handler struct {
	configPath string
	cfg        *config.Config
	Store      *store.Store
}

// Cfg returns the current config (used by main for background sync).
func (h *Handler) Cfg() *config.Config {
	return h.cfg
}

func NewHandler(configPath string) *Handler {
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		log.Printf("Warning: could not load config: %v", err)
		cfg = &config.Config{}
	}
	return &Handler{
		configPath: configPath,
		cfg:        cfg,
	}
}

// GetAccounts returns the list of configured email accounts.
func (h *Handler) GetAccounts(w http.ResponseWriter, r *http.Request) {
	type accountResponse struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}

	accounts := make([]accountResponse, len(h.cfg.Accounts))
	for i, a := range h.cfg.Accounts {
		accounts[i] = accountResponse{
			Name:  a.Name,
			Email: a.Email,
		}
	}

	writeJSON(w, http.StatusOK, accounts)
}

// GetEmails returns cached emails with optional ?limit and ?offset.
// Triggers a sync if the cache is empty or stale (first call).
func (h *Handler) GetEmails(w http.ResponseWriter, r *http.Request) {
	if len(h.cfg.Accounts) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no accounts configured"})
		return
	}

	limit := parseIntParam(r, "limit", 10)
	offset := parseIntParam(r, "offset", 0)
	mailbox := h.cfg.Accounts[0].Email

	// Sync on first request if empty.
	if h.Store != nil {
		cnt, _ := h.Store.CountEmails(mailbox)
		if cnt == 0 {
			go func() {
				if err := imap.Sync(h.cfg.Accounts[0], h.Store); err != nil {
					log.Printf("[sync] %s: %v", mailbox, err)
				}
			}()
			// Return empty 202 while syncing; caller can retry.
			writeJSON(w, http.StatusAccepted, map[string]string{
				"status":  "syncing",
				"message": "first sync in progress, try again shortly",
			})
			return
		}

		emails, err := h.Store.ListEmails(limit, offset, mailbox)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, emails)
		return
	}

	// Fallback: no store configured, fetch directly from IMAP (legacy).
	if len(h.cfg.Accounts) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no accounts configured"})
		return
	}
	account := h.cfg.Accounts[0]
	emails, err := imap.FetchEmails(account, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, emails)
}

// SearchEmails performs a full-text search over cached emails.
//
//	GET /api/search?q=hello+world&limit=10
func (h *Handler) SearchEmails(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "search requires a store (no cache configured)"})
		return
	}
	if len(h.cfg.Accounts) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no accounts configured"})
		return
	}

	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing query parameter ?q="})
		return
	}

	limit := parseIntParam(r, "limit", 20)
	mailbox := h.cfg.Accounts[0].Email

	emails, err := h.Store.SearchEmails(q, mailbox, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if emails == nil {
		emails = []store.EmailRow{} // always return [] not null
	}
	writeJSON(w, http.StatusOK, emails)
}

// SyncNow triggers an immediate IMAP sync in the background.
//
//	POST /api/sync             — forward sync (new messages only)
//	POST /api/sync?backfill=50 — backfill older messages
func (h *Handler) SyncNow(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no store configured"})
		return
	}
	if len(h.cfg.Accounts) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no accounts configured"})
		return
	}

	backfill := parseIntParam(r, "backfill", 0)

	go func() {
		for _, acct := range h.cfg.Accounts {
			if backfill > 0 {
				if err := imap.SyncOlder(acct, h.Store, backfill); err != nil {
					log.Printf("[backfill] %s: %v", acct.Email, err)
				}
			} else {
				if err := imap.Sync(acct, h.Store); err != nil {
					log.Printf("[sync] %s: %v", acct.Email, err)
				}
			}
		}
	}()

	msg := "syncing"
	if backfill > 0 {
		msg = "backfilling"
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": msg})
}

// Health check endpoint.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

// parseIntParam reads an integer query parameter.
func parseIntParam(r *http.Request, name string, defaultVal int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return defaultVal
	}
	val, err := strconv.Atoi(raw)
	if err != nil {
		return defaultVal
	}
	return val
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// CORS wraps a handler to add CORS headers.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
