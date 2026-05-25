import { BrowserView, BrowserWindow } from "electrobun/bun";
import type { HarbowRPC } from "../shared/types";

const BACKEND_URL = process.env.HARBOR_BACKEND_URL ?? "http://localhost:3002";

const win = new BrowserWindow({
  title: "Harbor",
  url: "views://mainview/index.html",
  titleBarStyle: "hidden",
  frame: { width: 1000, height: 700 },
  rpc: BrowserView.defineRPC<HarbowRPC>({
    handlers: {
      requests: {
        fetchEmails: async () => {
          const res = await fetch(`${BACKEND_URL}/api/emails`);
          if (!res.ok) throw new Error(`Backend error: ${res.status}`);
          return res.json();
        },
        getAccounts: async () => {
          const res = await fetch(`${BACKEND_URL}/api/accounts`);
          if (!res.ok) throw new Error(`Backend error: ${res.status}`);
          return res.json();
        },
      },
      messages: {
        log: ({ msg }) => console.log("[View]", msg),
      },
    },
  }),
});

win.on("close", () => {
  console.log("Harbor window closed");
});
