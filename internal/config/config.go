package config

import (
	"os"

	"github.com/pelletier/go-toml/v2"
)

type Account struct {
	Name     string `toml:"name"`
	Email    string `toml:"email"`
	Password string `toml:"password"`
	ImapHost string `toml:"imap_host"`
	ImapPort int    `toml:"imap_port"`
	SmtpHost string `toml:"smtp_host"`
	SmtpPort int    `toml:"smtp_port"`
}

type Config struct {
	Accounts []Account `toml:"accounts"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config

	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}
