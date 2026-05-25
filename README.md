# Harbor

A desktop email client with a Go backend and Electrobun GUI frontend.

## Architecture

```
harbor/
├── backend/       # Go HTTP API server (IMAP email fetching)
│   ├── cmd/server/      # Server entry point
│   ├── internal/        # Core packages (config, imap, services, types)
│   └── configs/         # Account configuration (TOML)
├── frontend/      # Electrobun desktop GUI
│   ├── src/bun/         # Main process (Bun runtime)
│   ├── src/views/       # Browser views (HTML/CSS/TS)
│   └── src/shared/      # Shared RPC types
└── README.md
```

## Getting Started

### Prerequisites

- Go 1.26+
- Bun 1.4+
- Electrobun CLI (`bunx electrobun`)

### Backend

```bash
cd backend
go run ./cmd/server/
```

### Frontend

```bash
cd frontend
bun install
bun start
```
