package api

import (
	"net/http"
)

// OpenAPI spec helpers — built programmatically so it stays in sync with the actual handlers.

// BuildDocsSpec constructs the full OpenAPI 3.0 document describing every route.
func BuildDocsSpec() map[string]interface{} {
	return map[string]interface{}{
		"openapi": "3.0.3",
		"info": map[string]interface{}{
			"title":       "Harbor API",
			"description": "IMAP email aggregation backend for the Electrobun frontend.",
			"version":     "0.1.0",
		},
		"servers": []map[string]interface{}{
			{
				"url": "http://localhost:3002",
			},
		},
		"paths": map[string]interface{}{
			"/health": map[string]interface{}{
				"get": map[string]interface{}{
					"summary":     "Health check",
					"description": "Returns the server health status.",
					"operationId": "health",
					"tags":        []string{"System"},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "Service is healthy.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"$ref": "#/components/schemas/HealthResponse",
									},
								},
							},
						},
					},
				},
			},
			"/api/accounts": map[string]interface{}{
				"get": map[string]interface{}{
					"summary":     "List email accounts",
					"description": "Returns the list of email accounts configured in the TOML config file. Passwords and connection details are never exposed.",
					"operationId": "getAccounts",
					"tags":        []string{"Accounts"},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "An array of configured accounts.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type":  "array",
										"items": map[string]interface{}{"$ref": "#/components/schemas/Account"},
									},
								},
							},
						},
					},
				},
			},
			"/api/search": map[string]interface{}{
				"get": map[string]interface{}{
					"summary":     "Full-text search emails",
					"description": "Searches cached emails using FTS5 full-text search. Supports FTS5 query syntax: phrases, AND, OR, NOT, prefix, and field-specific queries like `subject:meeting`.",
					"operationId": "searchEmails",
					"tags":        []string{"Search"},
					"parameters": []map[string]interface{}{
						{
							"name":        "q",
							"in":          "query",
							"description": "Full-text search query (FTS5 syntax).",
							"required":    true,
							"schema": map[string]interface{}{"type": "string"},
						},
						{
							"name":        "limit",
							"in":          "query",
							"description": "Max results (default 20, max 100).",
							"required":    false,
							"schema": map[string]interface{}{
								"type":    "integer",
								"default": 20,
							},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "Matching emails.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type":  "array",
										"items": map[string]interface{}{"$ref": "#/components/schemas/Email"},
									},
								},
							},
						},
						"400": map[string]interface{}{
							"description": "Missing ?q parameter.",
						},
					},
				},
			},
			"/api/sync": map[string]interface{}{
				"post": map[string]interface{}{
					"summary":     "Trigger IMAP sync",
					"description": "Triggers an immediate background sync. By default syncs new messages forward. Add ?backfill=N to fetch N older messages before the oldest cached one.",
					"operationId": "syncNow",
					"tags":        []string{"System"},
					"parameters": []map[string]interface{}{
						{
							"name":        "backfill",
							"in":          "query",
							"description": "Number of older messages to fetch (backfill). Omit or set to 0 for forward sync only.",
							"required":    false,
							"schema": map[string]interface{}{
								"type":    "integer",
								"default": 0,
							},
						},
					},
					"responses": map[string]interface{}{
						"202": map[string]interface{}{
							"description": "Sync started.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type": "object",
										"properties": map[string]interface{}{
											"status": map[string]interface{}{"type": "string"},
										},
									},
								},
							},
						},
					},
				},
			},
			"/api/emails/{id}/seen": map[string]interface{}{
				"patch": map[string]interface{}{
					"summary":     "Mark email as seen",
					"description": "Sets the Seen flag (S) on an email, marking it as read.",
					"operationId": "markSeen",
					"tags":        []string{"Emails"},
					"parameters": []map[string]interface{}{
						{
							"name":        "id",
							"in":          "path",
							"description": "Email ID to mark as seen.",
							"required":    true,
							"schema": map[string]interface{}{"type": "integer"},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "Email marked as seen.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type": "object",
										"properties": map[string]interface{}{
											"status": map[string]interface{}{"type": "string"},
										},
									},
								},
							},
						},
						"400": map[string]interface{}{
							"description": "Invalid email ID.",
						},
						"404": map[string]interface{}{
							"description": "Email not found or no store configured.",
						},
					},
				},
			},
			"/api/emails/{id}/unread": map[string]interface{}{
				"patch": map[string]interface{}{
					"summary":     "Mark email as unread",
					"description": "Removes the Seen flag (S) from an email, marking it as unread.",
					"operationId": "markUnread",
					"tags":        []string{"Emails"},
					"parameters": []map[string]interface{}{
						{
							"name":        "id",
							"in":          "path",
							"description": "Email ID to mark as unread.",
							"required":    true,
							"schema": map[string]interface{}{"type": "integer"},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "Email marked as unread.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type": "object",
										"properties": map[string]interface{}{
											"status": map[string]interface{}{"type": "string"},
										},
									},
								},
							},
						},
						"400": map[string]interface{}{
							"description": "Invalid email ID.",
						},
						"404": map[string]interface{}{
							"description": "Email not found or no store configured.",
						},
					},
				},
			},
			"/api/emails": map[string]interface{}{
				"get": map[string]interface{}{
					"summary":     "Fetch recent emails",
					"description": "Fetches recent emails from the first configured IMAP account.",
					"operationId": "getEmails",
					"tags":        []string{"Emails"},
					"parameters": []map[string]interface{}{
						{
							"name":        "limit",
							"in":          "query",
							"description": "Max number of emails to return (default 10, max 100).",
							"required":    false,
							"schema": map[string]interface{}{
								"type":    "integer",
								"default": 10,
								"maximum": 100,
							},
						},
						{
							"name":        "offset",
							"in":          "query",
							"description": "Number of most-recent emails to skip (for pagination).",
							"required":    false,
							"schema": map[string]interface{}{
								"type":    "integer",
								"default": 0,
								"minimum": 0,
							},
						},
					},
					"responses": map[string]interface{}{
						"200": map[string]interface{}{
							"description": "An array of recent emails.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"type":  "array",
										"items": map[string]interface{}{"$ref": "#/components/schemas/Email"},
									},
								},
							},
						},
						"404": map[string]interface{}{
							"description": "No accounts configured.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"$ref": "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
						"500": map[string]interface{}{
							"description": "IMAP fetch failure.",
							"content": map[string]interface{}{
								"application/json": map[string]interface{}{
									"schema": map[string]interface{}{
										"$ref": "#/components/schemas/ErrorResponse",
									},
								},
							},
						},
					},
				},
			},
		},
		"components": map[string]interface{}{
			"schemas": map[string]interface{}{
				"HealthResponse": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"status": map[string]interface{}{
							"type":    "string",
							"example": "ok",
						},
					},
				},
				"Account": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"name": map[string]interface{}{
							"type":        "string",
							"description": "Display name for the account.",
							"example":     "Personal",
						},
						"email": map[string]interface{}{
							"type":        "string",
							"format":      "email",
							"description": "Email address of the account.",
							"example":     "you@example.com",
						},
					},
				},
				"Email": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"id": map[string]interface{}{
							"type":    "integer",
							"example": 1,
						},
						"mailbox": map[string]interface{}{
							"type":    "string",
							"example": "user@gmail.com",
						},
						"imap_uid": map[string]interface{}{
							"type":    "integer",
							"example": 42,
						},
						"filename": map[string]interface{}{
							"type":    "string",
							"example": "1745894400.a1b2c3.0:2,S",
						},
						"subject": map[string]interface{}{
							"type":        "string",
							"description": "Subject line of the email.",
							"example":     "Hello from Harbor",
						},
						"from_addr": map[string]interface{}{
							"type":        "string",
							"description": "Sender address.",
							"example":     "sender@example.com",
						},
						"date": map[string]interface{}{
							"type":        "string",
							"format":      "date-time",
							"description": "Date the email was sent.",
							"example":     "2025-05-29T12:00:00Z",
						},
						"body_text": map[string]interface{}{
							"type":        "string",
							"description": "Plain-text body (decoded).",
						},
						"body_html": map[string]interface{}{
							"type":        "string",
							"description": "HTML body (decoded).",
							"example":     "<html><body><p>Hello from Harbor</p></body></html>",
						},
						"flags": map[string]interface{}{
							"type":        "string",
							"description": "Maildir-style flags (S=Seen, F=Flagged, etc.).",
							"example":     "S",
						},
					},
				},
				"ErrorResponse": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"error": map[string]interface{}{
							"type":        "string",
							"description": "Error message.",
							"example":     "no accounts configured",
						},
					},
				},
			},
		},
	}
}

// serveDocsJSON responds with the raw OpenAPI JSON spec.
func (h *Handler) serveDocsJSON(w http.ResponseWriter, r *http.Request) {
	spec := BuildDocsSpec()
	writeJSON(w, http.StatusOK, spec)
}

// serveDocsUI responds with a Swagger UI HTML page that loads the OpenAPI spec.
func (h *Handler) serveDocsUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)

	page := `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Harbor API — Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body style="margin:0">
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/docs/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout",
    });
  </script>
</body>
</html>`
	w.Write([]byte(page))
}

// RegisterDocs registers the /docs routes on the given ServeMux.
func (h *Handler) RegisterDocs(mux *http.ServeMux) {
	mux.HandleFunc("GET /docs", h.serveDocsUI)
	mux.HandleFunc("GET /docs/openapi.json", h.serveDocsJSON)
}
