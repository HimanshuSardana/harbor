package services

import (
	"github.com/HimanshuSardana/harbor/backend/internal/config"
	"github.com/HimanshuSardana/harbor/backend/internal/imap"
	"github.com/HimanshuSardana/harbor/backend/internal/types"
)

// GetEmails loads the config and fetches emails for the first account.
func GetEmails(limit, offset int) ([]types.Email, error) {
	cfg, err := config.LoadConfig("configs/accounts.toml")
	if err != nil {
		return nil, err
	}

	if len(cfg.Accounts) == 0 {
		return nil, nil
	}

	account := cfg.Accounts[0]

	return imap.FetchEmails(account, limit, offset)
}

// FetchEmails fetches emails for a given account configuration.
func FetchEmails(account config.Account, limit, offset int) ([]types.Email, error) {
	return imap.FetchEmails(account, limit, offset)
}
