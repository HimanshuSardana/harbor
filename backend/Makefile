all: run

run:
	go run ./cmd/server
	
build-release:
	go build -ldflags="-s -w" -o server ./cmd/server/
	upx --best --lzma server

