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

// LoadConfig reads and parses a TOML configuration file
//
// Parameters:
//   path - The file path to the TOML configuration file
//
// Returns:
//   *Config - The parsed configuration structure
//   error - Any error encountered during file reading or parsing
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

// SaveConfig writes the config to a TOML file at the given path.
func SaveConfig(path string, cfg *Config) error {
	data, err := toml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
