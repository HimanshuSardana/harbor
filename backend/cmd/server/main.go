package main

import (
	"log"
	"net/http"
	"os"

	"github.com/HimanshuSardana/harbor/backend/internal/api"
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

	h := api.NewHandler(configPath)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.Health)
	mux.HandleFunc("GET /api/accounts", h.GetAccounts)
	mux.HandleFunc("GET /api/emails", h.GetEmails)

	h.RegisterDocs(mux)

	handler := api.CORS(mux)

	addr := ":" + port
	log.Printf("Harbor API server starting on %s", addr)
	log.Printf("Config path: %s", configPath)

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
