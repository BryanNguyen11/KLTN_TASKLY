const nodemailer = require('nodemailer');
let Resend;
try { ({ Resend } = require('resend')); } catch (_) { /* optional dependency */ }

let transporter;
let resendClient;

function getTransporter(){
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    // Fallback: log-only mode
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return transporter;
}

function getResend(){
  const key = process.env.RESEND_API_KEY;
  if (!Resend || !key) return null;
  if (resendClient) return resendClient;
  resendClient = new Resend(key);
  return resendClient;
}

async function sendMail({ to, subject, html, text }){
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  // Temporary test-mode: redirect all non-owner recipients to owner email for Resend testing accounts
  const redirectTo = process.env.RESEND_TEST_REDIRECT_TO || null;
  let actualTo = to;
  let noteSuffixHtml = '';
  let noteSuffixText = '';
  if (redirectTo && to && to.toLowerCase() !== redirectTo.toLowerCase()) {
    noteSuffixHtml = `<hr/><small>Originally addressed to: ${to}</small>`;
    noteSuffixText = `\n\nOriginally addressed to: ${to}`;
    actualTo = redirectTo;
  }
  // Prefer Resend if configured (simpler: only needs API key)
  const resend = getResend();
  if (resend) {
    try {
      const fromResend = from || 'Taskly <onboarding@resend.dev>';
      const r = await resend.emails.send({ from: fromResend, to: actualTo, subject, html: (html || '') + noteSuffixHtml, text: (text || '') + noteSuffixText });
      const data = r && r.data;
      const error = r && r.error;
      if (error) {
        console.log('[MAIL][RESEND][ERROR]', error?.message || error);
        return { queued: false, provider: 'resend', error: { message: error?.message || String(error), code: error?.name || error?.code || null } };
      } else {
        const id = data?.id || 'n/a';
        console.log(`[MAIL][RESEND] Queued -> to=${to} subject="${subject}" id=${id}`);
        return { queued: true, provider: 'resend', id };
      }
    } catch (e) {
      console.log('[MAIL][RESEND][ERROR]', e?.message);
      return { queued: false, provider: 'resend', error: { message: e?.message || String(e), code: e?.code || null } };
    }
  }

  const tx = getTransporter();
  if (!tx) {
    console.log('✉️ [MAIL:LOG-ONLY] To:', to);
    console.log('Subject:', subject);
    if (text) console.log('Text:', text);
    if (html) console.log('HTML:', html);
    return { queued: false, logged: true };
  }
  console.log(`[MAIL][SMTP] Send via ${tx.options.host}:${tx.options.port} secure=${tx.options.secure}`);
  const info = await tx.sendMail({ from, to, subject, html, text });
  console.log(`[MAIL][SMTP] Queued -> messageId=${info.messageId}`);
  return { queued: true, provider: 'smtp', messageId: info.messageId };
}

function mailProviderStatus(){
  const hasResendModule = !!Resend;
  const hasResendKey = !!process.env.RESEND_API_KEY;
  const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
  const mode = hasResendModule && hasResendKey ? 'resend' : (hasSmtp ? 'smtp' : 'log-only');
  return {
    mode,
    resend: { module: hasResendModule, apiKey: hasResendKey },
    smtp: {
      host: process.env.SMTP_HOST || null,
      port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
      user: process.env.SMTP_USER ? 'configured' : null,
      pass: process.env.SMTP_PASS ? 'configured' : null
    }
  };
}

function renderResetEmail({ name, email, otp, resetToken }){
  const appUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:8081';
  const resetUrl = `${appUrl}/auth/reset-password?token=${encodeURIComponent(resetToken)}`;
  const safeName = name || email || 'bạn';
  const html = `
    <div style="font-family: Arial, sans-serif; line-height:1.6;">
      <h2>Đặt lại mật khẩu Taskly</h2>
      <p>Xin chào ${safeName},</p>
      <p>Mã OTP của bạn là: <b style="font-size:18px;">${otp}</b> (hiệu lực 10 phút).</p>
      <p>Bạn cũng có thể nhấn vào liên kết sau để đặt lại mật khẩu trực tiếp:</p>
      <p><a href="${resetUrl}" target="_blank">Đặt lại mật khẩu</a></p>
      <p>Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
      <hr/>
      <small>Taskly • Do not reply</small>
    </div>
  `;
  const text = `Dat lai mat khau Taskly\n\nOTP: ${otp} (hieu luc 10 phut)\nLink dat lai: ${resetUrl}\nNeu khong phai ban yeu cau, vui long bo qua.`;
  return { html, text };
}
module.exports = { sendMail, renderResetEmail, mailProviderStatus };
