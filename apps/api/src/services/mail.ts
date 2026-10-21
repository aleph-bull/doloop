/**
 * Outgoing email. The API sends very little (so far only university verification codes),
 * so this is one interface with two makers: Resend's HTTP API when `RESEND_API_KEY` is
 * set, and the console otherwise, which prints the message so local copies and sandboxes
 * still work without an account.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createResendMailer(
  apiKey: string,
  from: string,
  fetchImpl: FetchLike = fetch,
): Mailer {
  return {
    async send(mail) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend answered ${res.status}: ${body.slice(0, 200)}`);
      }
    },
  };
}

/** Prints each message instead of sending it. For local copies and tests. */
export function createConsoleMailer(log: (line: string) => void = console.warn): Mailer {
  return {
    async send(mail) {
      log(`[mail] To: ${mail.to}\n[mail] Subject: ${mail.subject}\n[mail] ${mail.text}`);
    },
  };
}
