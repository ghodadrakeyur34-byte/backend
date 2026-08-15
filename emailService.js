import nodemailer from 'nodemailer';

const GMAIL_USER_FALLBACK = 'marimilkat@gmail.com';
const GMAIL_PASS_FALLBACK = 'gsxa gfma vwsi fbrm';

let cachedTransporter = null;
let isVerifying = false;

/**
 * Creates an ultra-fast pooled SMTP transporter.
 * Connection pooling keeps connections open and authenticated,
 * avoiding the 2-4 second TLS handshake overhead on every email.
 */
function createTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const gmailUser = (process.env.GMAIL_USER || GMAIL_USER_FALLBACK).trim();
  const gmailPass = (process.env.GMAIL_PASS || GMAIL_PASS_FALLBACK).replace(/\s+/g, '');

  if (gmailUser && gmailPass) {
    cachedTransporter = nodemailer.createTransport({
      service: 'gmail',
      pool: true, // Keep open connections warm in a pool
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 14,
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      dnsTimeout: 5000,
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      },
    });

    // Pre-warm connection pool in background without blocking requests
    if (!isVerifying) {
      isVerifying = true;
      cachedTransporter.verify().then(() => {
        console.log(`[Email Service] ⚡ Gmail SMTP connection pool is ready & warm for ${gmailUser}`);
      }).catch((err) => {
        console.warn(`[Email Service] SMTP verification warning:`, err.message);
      }).finally(() => {
        isVerifying = false;
      });
    }

    return cachedTransporter;
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      pool: true,
      maxConnections: 5,
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: process.env.SMTP_PASS,
      },
    });
    return cachedTransporter;
  }

  return null;
}

// Pre-initialize transporter immediately on module load
try {
  createTransporter();
} catch (e) {
  // Silent catch during module bootstrap
}

export async function sendVerificationEmail(toEmail, otpCode) {
  try {
    console.log(`\n======================================================`);
    console.log(`[EMAIL DISPATCH] ⚡ Fast OTP to: ${toEmail}`);
    console.log(`[EMAIL DISPATCH] Verification Code: ${otpCode}`);
    console.log(`======================================================\n`);

    const mailTransporter = createTransporter();

    if (!mailTransporter) {
      console.warn('[Email Service] No mail transporter available. Email NOT sent.');
      return { success: false, simulated: true };
    }

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
    const result = await mailTransporter.sendMail({
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
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Email Service] ✅ Email DELIVERED to ${toEmail} in ${elapsed}ms. Message ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId, elapsedMs: elapsed };
  } catch (err) {
    console.error('[Email Service] ❌ Error sending email:', err.message);
    return { success: false, error: err.message };
  }
}

