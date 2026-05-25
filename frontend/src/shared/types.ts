import type { RPCSchema } from "electrobun/bun";

export type HarbowRPC = {
  bun: RPCSchema<{
    requests: {
      fetchEmails: { params: {}; response: Email[] };
      getAccounts: { params: {}; response: Account[] };
    };
    messages: {
      log: { msg: string };
    };
  }>;
  webview: RPCSchema<{
    requests: {
      getDocumentTitle: { params: {}; response: string };
    };
    messages: {
      showNotification: { text: string };
    };
  }>;
};

export interface Email {
  Subject: string;
  From: string;
  Date: string;
}

export interface Account {
  name: string;
  email: string;
}
