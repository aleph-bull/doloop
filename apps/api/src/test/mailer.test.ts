import { afterEach, expect, it, vi } from 'vitest';
import { createResendMailer } from '../services/mailer';
afterEach(() => vi.unstubAllGlobals());
it('sends bare plain text through Resend without HTML or tracking content', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: 'mail' }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await createResendMailer('fake-key', 'Komodon <noreply@komogon.app>').send({
    to: 'test@example.test',
    subject: 'Your code',
    text: '123456\n\nExpires in 10 minutes.',
  });
  const message = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(message).toEqual({
    from: 'Komodon <noreply@komogon.app>',
    to: ['test@example.test'],
    subject: 'Your code',
    text: '123456\n\nExpires in 10 minutes.',
  });
  expect(message.html).toBeUndefined();
});
it('reports delivery failure instead of pretending a code was sent', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
  await expect(
    createResendMailer('fake-key', 'test@example.test').send({
      to: 'to@example.test',
      subject: 'Code',
      text: '123456',
    }),
  ).rejects.toThrow('delivery failed');
});
