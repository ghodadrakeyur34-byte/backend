import nodemailer from 'nodemailer';

let transporter = null;
let etherealAttempted = false;

async function createEtherealAccountWithTimeout() {
  return Promise.race([
    nodemailer.createTestAccount(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Ethereal setup timeout')), 3000))
  ]);
}

async function getTransporter() {
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    const cleanPass = process.env.GMAIL_PASS.replace(/\s+/g, '');
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER.trim(),
        pass: cleanPass,
      },
    });
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: process.env.SMTP_PASS,
      },
    });
  }

  if (transporter) return transporter;

  if (!etherealAttempted) {
    etherealAttempted = true;
    try {
      const testAccount = await createEtherealAccountWithTimeout();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log('[Email Service] Created Ethereal test SMTP account:', testAccount.user);
      return transporter;
    } catch (err) {
      console.log('[Email Service] Ethereal setup skipped/timed out. Falling back to console.');
    }
  }

  return null;
}

export async function sendVerificationEmail(toEmail, otpCode) {
  try {
    const mailTransporter = await getTransporter();
    const fromAddress = process.env.SMTP_FROM || process.env.GMAIL_USER || '"Mari Milkat" <noreply@marimilkat.com>';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background-color: #090d16; color: #ffffff; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="font-size: 24px; color: #ffffff; margin: 0;">🏠 Mari<span style="color: #e2b857;">Milkat</span></h1>
          <p style="font-size: 14px; color: #94a3b8; margin-top: 4px;">Email Verification Code</p>
        </div>

        <div style="background: rgba(17, 24, 39, 0.8); padding: 20px; border-radius: 8px; text-align: center; border: 1px solid rgba(226, 184, 87, 0.2);">
          <p style="font-size: 15px; color: #cbd5e1; margin-bottom: 12px;">Your 6-digit verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #e2b857; background: #000000; padding: 12px 24px; border-radius: 6px; display: inline-block;">
            ${otpCode}
          </div>
          <p style="font-size: 13px; color: #94a3b8; margin-top: 16px; margin-bottom: 0;">
            This code will expire in <strong>15 minutes</strong>.
          </p>
        </div>

        <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 24px;">
          If you did not request this verification code, please ignore this email.
        </p>
      </div>
    `;

    console.log(`\n======================================================`);
    console.log(`[EMAIL DISPATCH] Sent to: ${toEmail}`);
    console.log(`[EMAIL DISPATCH] Verification Code: ${otpCode}`);
    console.log(`======================================================\n`);

    if (!mailTransporter) {
      return { success: true, simulated: true };
    }

    const info = await mailTransporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: `${otpCode} is your Mari Milkat verification code`,
      text: `Your Mari Milkat verification code is: ${otpCode}. It expires in 15 minutes.`,
      html: htmlContent,
    });

    console.log(`[Email Service] Delivered email to ${toEmail}. Message ID: ${info.messageId}`);
    
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[Email Service] Web Inbox Preview URL: ${previewUrl}`);
    }

    return { success: true, messageId: info.messageId, previewUrl };
  } catch (err) {
    console.error('[Email Service] Error sending email:', err);
    return { success: false, error: err.message };
  }
}
