package main

import (
	"fmt"

	"github.com/HimanshuSardana/harbor/internal/services"
)

func main() {
	emails, err := services.GetEmails()
	if err != nil {
		fmt.Println(err)
	}
	for _, m := range emails {
		fmt.Println(m.Subject)
	}
}
