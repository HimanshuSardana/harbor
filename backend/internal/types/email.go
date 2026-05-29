package types

import "time"

type Email struct {
	Subject string    `json:"subject"`
	From    string    `json:"from"`
	Date    time.Time `json:"date"`
	Body    string    `json:"body"`
}

