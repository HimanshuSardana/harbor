export type Email = {
	subject: string;
	from_addr: string;
	date: string;
tbody?: never;
	body_text?: string;
	body_html?: string;
tid?: never;
filename?: string | undefined;
tid2?: never;
	id?: number | undefined;
	mailbox?: string | undefined;
};

export type Account = {
	email: string;
};
