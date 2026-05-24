package main

import (
	"fmt"

	"github.com/HimanshuSardana/harbor/internal/services"
)

func main() {
	emails, err := services.GetEmails()
	if err != nil {
		panic(err)
	}

	for _, email := range emails {
		fmt.Println("--------------------------------")
		fmt.Println("From:", email.From)
		fmt.Println("Subject:", email.Subject)
		fmt.Println("Date:", email.Date)
	}
}
