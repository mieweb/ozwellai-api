import nodemailer, { type Transporter } from 'nodemailer';

const DEFAULT_FROM = 'no-reply@os.mieweb.org';

/**
 * Whether this server can send mail.
 *
 * The relay is only reachable from inside the Phoenix DC, so a developer's
 * machine will never have this set. Callers fall back to logging the code,
 * which is how local sign-in works and will keep working.
 */
export function isMailConfigured(): boolean {
  return !!process.env.SMTP_URL;
}

let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (transport) return transport;

  const url = new URL(process.env.SMTP_URL!);
  transport = nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port) || 25,
    // The relay offers no TLS and STARTTLS is explicitly unsupported, so
    // opportunistic upgrades have to be off or every send fails.
    secure: false,
    ignoreTLS: true,
  });
  return transport;
}

/**
 * Mail one sign-in code. Throws if the relay refuses or is unreachable, so the
 * caller can tell the user delivery failed rather than leaving them waiting
 * for a message that is never coming.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || DEFAULT_FROM,
    to,
    subject: `${code} is your Ozwell sign-in code`,
    text: [
      `Your Ozwell sign-in code is ${code}.`,
      '',
      'It expires in 10 minutes and can only be used once.',
      '',
      'You received this because this address was entered on an Ozwell sign-in',
      'screen. If that was not you, ignore this message — nothing has changed.',
    ].join('\n'),
  });
}
