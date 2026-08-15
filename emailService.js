import dns from 'dns';
import nodemailer from 'nodemailer';

// Render & cloud hosts do not support outbound IPv6 for SMTP.
try {
  if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {}

const GMAIL_USER_FALLBACK = 'marimilkat@gmail.com';
const GMAIL_PASS_FALLBACK = 'gsxa gfma vwsi fbrm';

let primaryTransporter = null;
let fallbackTransporter = null;

function buildTransporter(port, secure) {
  const gmailUser = (process.env.GMAIL_USER || GMAIL_USER_FALLBACK).trim();
  const gmailPass = (process.env.GMAIL_PASS || GMAIL_PASS_FALLBACK).replace(/\s+/g, '');

  if (gmailUser && gmailPass) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port,
      secure,
      family: 4,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 14,
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
      connectionTimeout: 3500, // Short timeout to avoid hanging if host blocks SMTP
      greetingTimeout: 3500,
      socketTimeout: 5000,
      dnsTimeout: 3000,
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
    });
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      family: 4,
      pool: true,
      maxConnections: 5,
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 3500,
      greetingTimeout: 3500,
      socketTimeout: 5000,
    });
  }

  return null;
}

function getTransporters() {
  if (!primaryTransporter) {
    primaryTransporter = buildTransporter(465, true);
  }
  if (!fallbackTransporter) {
    fallbackTransporter = buildTransporter(587, false);
  }
  return { primary: primaryTransporter, fallback: fallbackTransporter };
}

// Background verification
const { primary } = getTransporters();
if (primary) {
  primary.verify().then(() => {
    console.log('[Email Service] ⚡ Gmail SMTP (IPv4/SSL) verified and ready');
  }).catch((err) => {
    console.warn('[Email Service] SMTP port blocked or unreachable on this host (Render blocks raw SMTP). HTTPS API recommended.');
  });
}

/**
 * Sends email via Resend HTTPS REST API (Port 443 - 100% works on Render)
 */
async function sendViaResend(toEmail, otpCode, htmlContent) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Mari Milkat <onboarding@resend.dev>',
      to: [toEmail],
      subject: `${otpCode} is your Mari Milkat verification code`,
      html: htmlContent,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend API Error: ${data.message || JSON.stringify(data)}`);
  }
  return data.id || 'resend-ok';
}

/**
 * Sends email via Brevo (Sendinblue) HTTPS REST API (Port 443 - 100% works on Render)
 */
async function sendViaBrevo(toEmail, otpCode, htmlContent) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return null;

  const gmailUser = (process.env.GMAIL_USER || GMAIL_USER_FALLBACK).trim();
  const senderEmail = process.env.BREVO_FROM || gmailUser;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey.trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Mari Milkat', email: senderEmail },
      to: [{ email: toEmail }],
      subject: `${otpCode} is your Mari Milkat verification code`,
      htmlContent: htmlContent,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Brevo API Error: ${data.message || JSON.stringify(data)}`);
  }
  return data.messageId || 'brevo-ok';
}

/**
 * Sends email via SendGrid HTTPS REST API (Port 443 - 100% works on Render)
 */
async function sendViaSendGrid(toEmail, otpCode, htmlContent) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;

  const gmailUser = (process.env.GMAIL_USER || GMAIL_USER_FALLBACK).trim();
  const fromEmail = process.env.SENDGRID_FROM || gmailUser;

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: 'Mari Milkat' },
      subject: `${otpCode} is your Mari Milkat verification code`,
      content: [{ type: 'text/html', value: htmlContent }],
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`SendGrid API Error: ${errorText}`);
  }
  return 'sendgrid-ok';
}

export async function sendVerificationEmail(toEmail, otpCode) {
  try {
    console.log(`\n======================================================`);
    console.log(`[EMAIL DISPATCH] ⚡ OTP Code: ${otpCode} -> ${toEmail}`);
    console.log(`======================================================\n`);

    const gmailUser = (process.env.GMAIL_USER || GMAIL_USER_FALLBACK).trim();
    const fromAddress = process.env.SMTP_FROM || `"Mari Milkat" <${gmailUser}>`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 30px 10px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden;">
                <tr>
                  <td style="padding: 24px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.06);">
                    <h1 style="font-size: 26px; color: #ffffff; margin: 0; font-weight: 700;">🏠 Mari<span style="color: #e2b857;">Milkat</span></h1>
                    <p style="font-size: 13px; color: #94a3b8; margin: 6px 0 0 0; text-transform: uppercase; letter-spacing: 1px;">Email Verification</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px 24px; text-align: center;">
                    <p style="font-size: 15px; color: #cbd5e1; margin: 0 0 20px 0;">Use the 6-digit verification code below to complete your sign-in:</p>
                    <div style="display: inline-block; background-color: #000000; border: 2px solid #e2b857; border-radius: 10px; padding: 14px 28px;">
                      <span style="font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #e2b857; font-family: monospace;">${otpCode}</span>
                    </div>
                    <p style="font-size: 13px; color: #94a3b8; margin: 20px 0 0 0;">
                      ⏱️ This code will expire in <strong>15 minutes</strong>.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 16px 24px; background-color: #0d131f; text-align: center; border-top: 1px solid rgba(255,255,255,0.06);">
                    <p style="font-size: 12px; color: #64748b; margin: 0;">
                      If you did not request this verification code, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const startTime = Date.now();
    let messageId = null;

    // 1. Try Resend HTTPS API (Fastest & 100% allowed on Render port 443)
    if (process.env.RESEND_API_KEY) {
      try {
        messageId = await sendViaResend(toEmail, otpCode, htmlContent);
        const elapsed = Date.now() - startTime;
        console.log(`[Email Service] ✅ Delivered via Resend HTTPS in ${elapsed}ms. Message ID: ${messageId}`);
        return { success: true, messageId, elapsedMs: elapsed };
      } catch (resendErr) {
        console.error('[Email Service] Resend dispatch failed:', resendErr.message);
      }
    }

    // 2. Try Brevo HTTPS API (Port 443)
    if (process.env.BREVO_API_KEY) {
      try {
        messageId = await sendViaBrevo(toEmail, otpCode, htmlContent);
        const elapsed = Date.now() - startTime;
        console.log(`[Email Service] ✅ Delivered via Brevo HTTPS in ${elapsed}ms. Message ID: ${messageId}`);
        return { success: true, messageId, elapsedMs: elapsed };
      } catch (brevoErr) {
        console.error('[Email Service] Brevo dispatch failed:', brevoErr.message);
      }
    }

    // 3. Try SendGrid HTTPS API (Port 443)
    if (process.env.SENDGRID_API_KEY) {
      try {
        messageId = await sendViaSendGrid(toEmail, otpCode, htmlContent);
        const elapsed = Date.now() - startTime;
        console.log(`[Email Service] ✅ Delivered via SendGrid HTTPS in ${elapsed}ms. Message ID: ${messageId}`);
        return { success: true, messageId, elapsedMs: elapsed };
      } catch (sgErr) {
        console.error('[Email Service] SendGrid dispatch failed:', sgErr.message);
      }
    }

    // 4. Try SMTP (Direct SSL port 465 or STARTTLS port 587)
    const { primary, fallback } = getTransporters();
    const mailOptions = {
      from: fromAddress,
      to: toEmail,
      subject: `${otpCode} is your Mari Milkat verification code`,
      text: `Your Mari Milkat verification code is: ${otpCode}. It expires in 15 minutes.`,
      html: htmlContent,
      priority: 'high',
      headers: {
        'X-Priority': '1 (Highest)',
        'X-MSMail-Priority': 'High',
        'Importance': 'High',
        'Priority': 'urgent',
        'X-Mailer': 'MariMilkat Auth',
      },
    };

    if (primary) {
      try {
        const res = await primary.sendMail(mailOptions);
        const elapsed = Date.now() - startTime;
        console.log(`[Email Service] ✅ Delivered via SMTP in ${elapsed}ms. Message ID: ${res.messageId}`);
        return { success: true, messageId: res.messageId, elapsedMs: elapsed };
      } catch (primaryErr) {
        console.warn('[Email Service] Primary SMTP failed (Render firewall blocks SMTP ports):', primaryErr.message);
      }
    }

    if (fallback) {
      try {
        const res = await fallback.sendMail(mailOptions);
        const elapsed = Date.now() - startTime;
        console.log(`[Email Service] ✅ Delivered via Fallback SMTP in ${elapsed}ms. Message ID: ${res.messageId}`);
        return { success: true, messageId: res.messageId, elapsedMs: elapsed };
      } catch (fallbackErr) {
        console.warn('[Email Service] Fallback SMTP failed:', fallbackErr.message);
      }
    }

    console.warn(`[Email Service] ⚠️ Notice: Render blocks raw SMTP ports (465/587). Add RESEND_API_KEY or BREVO_API_KEY in Render Environment Variables for instant HTTPS email delivery.`);
    return { success: false, error: 'SMTP ports blocked on host. Use HTTPS API (Resend/Brevo).' };
  } catch (err) {
    console.error('[Email Service] ❌ Error sending email:', err.message);
    return { success: false, error: err.message };
  }
}

