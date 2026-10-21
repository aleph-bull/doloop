import { randomUUID } from 'node:crypto';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  mode: 'resend' | 'local';
  send(message: MailMessage): Promise<void>;
  messages?: Array<MailMessage & { id: string; createdAt: string }>;
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    mode: 'resend',
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok)
        throw new Error(`Email delivery failed (${response.status}). Please try again later.`);
    },
  };
}

/** Explicitly local-only; never used as a silent fallback for hosted email delivery. */
export function createLocalMailer(): Mailer {
  const messages: NonNullable<Mailer['messages']> = [];
  return {
    mode: 'local',
    messages,
    async send(message) {
      messages.push({ ...message, id: randomUUID(), createdAt: new Date().toISOString() });
      if (messages.length > 50) messages.shift();
    },
  };
}
