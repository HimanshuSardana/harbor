package api

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/HimanshuSardana/harbor/backend/internal/config"
	"github.com/HimanshuSardana/harbor/backend/internal/services"
)

type Handler struct {
	configPath string
	cfg        *config.Config
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

// GetEmails fetches emails for the first account or a specified account.
func (h *Handler) GetEmails(w http.ResponseWriter, r *http.Request) {
	if len(h.cfg.Accounts) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "no accounts configured",
		})
		return
	}

	account := h.cfg.Accounts[0]
	emails, err := services.FetchEmails(account)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, emails)
}

// Health check endpoint.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// CORS wraps a handler to add CORS headers for the Electrobun frontend.
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
