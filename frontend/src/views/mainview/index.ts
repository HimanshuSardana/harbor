import { Electroview } from "electrobun/view";
import type { HarbowRPC } from "../../shared/types";

const rpc = Electroview.defineRPC<HarbowRPC>({
  handlers: {
    requests: {
      getDocumentTitle: () => document.title,
    },
    messages: {
      showNotification: ({ text }) => console.log(text),
    },
  },
});

const electroview = new Electroview({ rpc });

// --- UI State ---
let currentEmails: any[] = [];

// --- DOM refs ---
const accountListEl = document.getElementById("account-list")!;
const emailListEl = document.getElementById("email-list")!;
const emailDetailEl = document.getElementById("email-detail")!;
const refreshBtn = document.getElementById("refresh-btn")!;

// --- Load accounts ---
async function loadAccounts() {
  try {
    const accounts = await electroview.rpc.request.getAccounts({});
    accountListEl.innerHTML = "";
    for (const acc of accounts) {
      const li = document.createElement("li");
      li.innerHTML = `${acc.name} <span class="email-addr">${acc.email}</span>`;
      li.addEventListener("click", () => loadEmails());
      accountListEl.appendChild(li);
    }
    if (accounts.length > 0) loadEmails();
  } catch (err) {
    accountListEl.innerHTML = `<li class="loading">Failed to load accounts</li>`;
    console.error("loadAccounts error:", err);
  }
}

// --- Load emails ---
async function loadEmails() {
  emailListEl.innerHTML = "<li class='loading'>Loading emails...</li>";
  try {
    const emails = await electroview.rpc.request.fetchEmails({});
    currentEmails = emails;
    renderEmailList(emails);
  } catch (err) {
    emailListEl.innerHTML = "<li class='loading'>Failed to load emails</li>";
    console.error("loadEmails error:", err);
  }
}

// --- Render email list ---
function renderEmailList(emails: any[]) {
  emailListEl.innerHTML = "";
  if (emails.length === 0) {
    emailListEl.innerHTML = "<li class='loading'>No emails found</li>";
    return;
  }
  for (const email of emails) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="subject">${escapeHtml(email.Subject || "(No Subject)")}</div>
      <div class="from">${escapeHtml(email.From || "Unknown")}</div>
    `;
    li.addEventListener("click", () => showEmailDetail(email));
    emailListEl.appendChild(li);
  }
}

// --- Show email detail ---
function showEmailDetail(email: any) {
  emailDetailEl.innerHTML = `
    <h3>${escapeHtml(email.Subject || "(No Subject)")}</h3>
    <p><strong>From:</strong> ${escapeHtml(email.From || "Unknown")}</p>
    <p><strong>Date:</strong> ${email.Date ? new Date(email.Date).toLocaleString() : "Unknown"}</p>
  `;
}

// --- Helpers ---
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Init ---
loadAccounts();

refreshBtn.addEventListener("click", loadEmails);

// Close button
document.getElementById("close-btn")?.addEventListener("click", () => {
  electroview.rpc.send.showNotification({ text: "Closing..." });
});
