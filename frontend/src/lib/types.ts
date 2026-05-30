export type Email = {
	subject: string;
	from_addr: string;
	date: string;
	body_text?: string;
	body_html?: string;
	flags?: string;
	filename?: string | undefined;
	id?: number | undefined;
	mailbox?: string | undefined;
};

export type Account = {
	email: string;
};
