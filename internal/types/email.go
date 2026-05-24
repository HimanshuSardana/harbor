package types

import "time"

type Email struct {
	Subject string
	From    string
	Date    time.Time
}

