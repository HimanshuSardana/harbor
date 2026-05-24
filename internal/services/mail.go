package services

import (
	"github.com/HimanshuSardana/harbor/internal/config"
	"github.com/HimanshuSardana/harbor/internal/imap"
	"github.com/HimanshuSardana/harbor/internal/types"
)

func GetEmails() ([]types.Email, error) {
	cfg, err := config.LoadConfig("configs/accounts.toml")
	if err != nil {
		return nil, err
	}

	if len(cfg.Accounts) == 0 {
		return nil, nil
	}

	account := cfg.Accounts[0]

	return imap.FetchEmails(account)
}
