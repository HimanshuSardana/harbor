package main

import (
	"fmt"

	"github.com/HimanshuSardana/harbor/internal/config"
	"github.com/HimanshuSardana/harbor/internal/imap"
)

func main() {
	cfg, err := config.LoadConfig("./accounts.toml")
	if err != nil {
		panic(err)
	}

	for _, acc := range cfg.Accounts {
		fmt.Println(acc.Email)
		imap.FetchMails(acc.Name)
	}
}
