import nodemailer, { type Transporter } from 'nodemailer';

const DEFAULT_FROM = 'no-reply@os.mieweb.org';

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
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  return transport;
}

export interface QuotaEmail {
  to: string;
  kind: 'warning' | 'limit';
  scopeType: 'user' | 'agent';
  scopeName: string;
  period: 'hourly' | 'daily' | 'monthly';
  usedTokens: number;
  limit: number;
  resetsAt: string;
}

export async function sendQuotaEmail(email: QuotaEmail): Promise<void> {
  const subject = email.scopeType === 'agent' ? `Agent "${email.scopeName}"` : `Your account`;
  const verb = email.kind === 'limit' ? 'has reached' : 'is approaching';
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || DEFAULT_FROM,
    to: email.to,
    subject: `${subject} ${verb} its ${email.period} Ozwell token quota`,
    text: [
      `${subject} ${verb} its ${email.period} token quota.`,
      '',
      `${email.scopeType === 'agent' ? 'Agent' : 'User'}: ${email.scopeName}`,
      `Quota period: ${email.period}`,
      `Usage: ${email.usedTokens.toLocaleString('en-US')} of ${email.limit.toLocaleString('en-US')} tokens`,
      `Window resets at: ${email.resetsAt}`,
      '',
      email.kind === 'limit'
        ? 'Further requests are rejected until the window resets or the limit is raised.'
        : 'Requests continue to work until the limit is reached.',
    ].join('\n'),
  });
}

/** Propagate delivery failures so callers do not report a code as sent. */
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
