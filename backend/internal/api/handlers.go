package api

import (
	"encoding/json"
	"fmt"
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

// GetEmails returns cached or live emails with optional ?limit, ?offset and ?mailbox.
//
//	GET /api/emails                      — first account, limit 10
//	GET /api/emails?mailbox=user@ex.com  — specific account
//	GET /api/emails?limit=50&offset=100  — pagination
func (h *Handler) GetEmails(w http.ResponseWriter, r *http.Request) {
	acct, err := h.resolveAccount(r.URL.Query().Get("mailbox"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	mailbox := acct.Email

	limit := parseIntParam(r, "limit", 10)
	offset := parseIntParam(r, "offset", 0)

	// Store-backed path.
	if h.Store != nil {
		cnt, _ := h.Store.CountEmails(mailbox)
		if cnt == 0 {
			go func() {
				if err := imap.Sync(acct, h.Store); err != nil {
					log.Printf("[sync] %s: %v", mailbox, err)
				}
			}()
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

	// Legacy fallback: no store, fetch directly from IMAP.
	emails, err := imap.FetchEmails(acct, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, emails)
}

// SearchEmails performs a full-text search over cached emails.
//
//	GET /api/search?q=hello+world&limit=10               — first account
//	GET /api/search?q=meeting&mailbox=user@ex.com&limit=5 — specific account
func (h *Handler) SearchEmails(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "search requires a store (no cache configured)"})
		return
	}

	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing query parameter ?q="})
		return
	}

	acct, err := h.resolveAccount(r.URL.Query().Get("mailbox"))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}

	limit := parseIntParam(r, "limit", 20)

	emails, err := h.Store.SearchEmails(q, acct.Email, limit)
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
//	POST /api/sync                      — forward sync all accounts
//	POST /api/sync?backfill=50          — backfill all accounts
//	POST /api/sync?mailbox=user@ex.com  — sync a specific account only
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
	accts := h.cfg.Accounts

	// Filter to a single account if ?mailbox= is specified.
	if m := r.URL.Query().Get("mailbox"); m != "" {
		a, err := h.resolveAccount(m)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		accts = []config.Account{a}
	}

	go func() {
		for _, acct := range accts {
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

// MarkSeen marks an email as read (seen).
//
//	PATCH /api/emails/{id}/seen
func (h *Handler) MarkSeen(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no store configured"})
		return
	}

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid email id"})
		return
	}

	if err := h.Store.MarkSeen(id); err != nil {
		if err.Error() == "email not found" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "email not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// MarkUnread marks an email as unread (removes the seen flag).
//
//	PATCH /api/emails/{id}/unread
func (h *Handler) MarkUnread(w http.ResponseWriter, r *http.Request) {
	if h.Store == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no store configured"})
		return
	}

	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid email id"})
		return
	}

	if err := h.Store.MarkUnread(id); err != nil {
		if err.Error() == "email not found" {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "email not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// AddAccount creates a new IMAP account and persists it to the config file.
//
//	POST /api/accounts  { "name": "...", "email": "...", "password": "...", "imap_host": "...", "imap_port": 993, "smtp_host": "...", "smtp_port": 587 }
func (h *Handler) AddAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		ImapHost string `json:"imap_host"`
		ImapPort int    `json:"imap_port"`
		SmtpHost string `json:"smtp_host"`
		SmtpPort int    `json:"smtp_port"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if body.Email == "" || body.Password == "" || body.ImapHost == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email, password, and imap_host are required"})
		return
	}

	if body.ImapPort == 0 {
		body.ImapPort = 993
	}
	if body.SmtpPort == 0 {
		body.SmtpPort = 587
	}

	// Check for duplicate.
	for _, a := range h.cfg.Accounts {
		if a.Email == body.Email {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "account already exists"})
			return
		}
	}

	account := config.Account{
		Name:     body.Name,
		Email:    body.Email,
		Password: body.Password,
		ImapHost: body.ImapHost,
		ImapPort: body.ImapPort,
		SmtpHost: body.SmtpHost,
		SmtpPort: body.SmtpPort,
	}

	h.cfg.Accounts = append(h.cfg.Accounts, account)

	if err := config.SaveConfig(h.configPath, h.cfg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save config: " + err.Error()})
		return
	}

	log.Printf("[accounts] added %s (%s)", body.Email, body.Name)
	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok", "email": body.Email})
}

// Health check endpoint.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

// resolveAccount looks up an account by email. If mailbox is empty, it
// returns the first configured account. Returns an error if no accounts
// exist or the given email doesn't match any account.
func (h *Handler) resolveAccount(mailbox string) (config.Account, error) {
	if len(h.cfg.Accounts) == 0 {
		return config.Account{}, fmt.Errorf("no accounts configured")
	}
	if mailbox == "" {
		return h.cfg.Accounts[0], nil
	}
	for _, a := range h.cfg.Accounts {
		if a.Email == mailbox {
			return a, nil
		}
	}
	return config.Account{}, fmt.Errorf("unknown mailbox %q", mailbox)
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
