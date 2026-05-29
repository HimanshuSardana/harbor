use serde::Serialize;
use std::path::PathBuf;

// ── Data types ──

#[derive(Debug, Serialize)]
pub struct Email {
    pub subject: String,
    pub from_addr: String,
    pub date: String,
    pub body_text: String,
    pub body_html: String,
    pub id: i64,
    pub mailbox: String,
    pub filename: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Account {
    pub email: String,
    pub imap_uid: i64,
    pub active: bool,
}

// ── Helpers ──

fn harbor_dir() -> PathBuf {
    dirs::home_dir()
        .expect("HOME dir not found")
        .join(".harbor")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = harbor_dir().join("harbor.db");
    rusqlite::Connection::open(&path).map_err(|e| format!("Failed to open DB: {e}"))
}

// ── Commands ──

#[tauri::command]
fn get_emails(limit: u32, offset: u32) -> Result<Vec<Email>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, mailbox, subject, from_addr, date, body_text, body_html, filename
             FROM emails
             ORDER BY id DESC
             LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| format!("Query prepare failed: {e}"))?;

    let rows = stmt
        .query_map([limit, offset], |row| {
            Ok(Email {
                id: row.get(0)?,
                mailbox: row.get::<_, String>(1).unwrap_or_default(),
                subject: row.get::<_, String>(2).unwrap_or_default(),
                from_addr: row.get::<_, String>(3).unwrap_or_default(),
                date: row.get::<_, String>(4).unwrap_or_default(),
                body_text: row.get::<_, String>(5).unwrap_or_default(),
                body_html: row.get::<_, String>(6).unwrap_or_default(),
                filename: row.get::<_, Option<String>>(7).ok().flatten(),
            })
        })
        .map_err(|e| format!("Query execution failed: {e}"))?;

    let mut emails = Vec::new();
    for row in rows {
        emails.push(row.map_err(|e| format!("Row read failed: {e}"))?);
    }
    Ok(emails)
}

#[tauri::command]
fn get_accounts() -> Result<Vec<Account>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT mailbox, imap_uid FROM sync_state")
        .map_err(|e| format!("Query prepare failed: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Account {
                email: row.get::<_, String>(0).unwrap_or_default(),
                imap_uid: row.get::<_, i64>(1).unwrap_or(0),
                active: true,
            })
        })
        .map_err(|e| format!("Query execution failed: {e}"))?;

    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row.map_err(|e| format!("Row read failed: {e}"))?);
    }
    Ok(accounts)
}

#[tauri::command]
fn get_eml_content(filename: String) -> Result<String, String> {
    let path = harbor_dir().join("cur").join(&filename);
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read .eml file '{filename}': {e}"))
}

#[tauri::command]
fn get_total_email_count() -> Result<u32, String> {
    let conn = open_db()?;
    let count: u32 = conn
        .query_row("SELECT COUNT(*) FROM emails", [], |row| row.get(0))
        .map_err(|e| format!("Count query failed: {e}"))?;
    Ok(count)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_emails,
            get_accounts,
            get_eml_content,
            get_total_email_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
