import { Resend } from "resend";
import { randomUUID } from "node:crypto";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const resendClient = () => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error("Resend email delivery is not configured: RESEND_API_KEY is missing.");
    error.code = "RESEND_CONFIG_MISSING";
    throw error;
  }
  return new Resend(apiKey);
};

export const isSecurityEmailConfigured = () => Boolean(
  process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim(),
);

const sendEmail = async ({ to, subject, text, html, idempotencyKey }) => {
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    const error = new Error("Resend email delivery is not configured: EMAIL_FROM is missing.");
    error.code = "RESEND_CONFIG_MISSING";
    throw error;
  }
  if (!to || !subject || (!html && !text)) {
    throw new Error("Email requires explicit to, subject, and html or text content.");
  }

  // A stable key is supplied for retryable security alerts; other sends get a unique key.
  const key = String(idempotencyKey || randomUUID()).replace(/[^a-zA-Z0-9._/-]/g, "-").slice(0, 240);
  const payload = { from, to, subject, ...(html ? { html } : {}), ...(text ? { text } : {}) };
  const { data, error } = await resendClient().emails.send(payload, { idempotencyKey: key });
  if (error) {
    const deliveryError = new Error(`Resend rejected email delivery: ${error.message || "unknown provider error"}`);
    deliveryError.name = "ResendDeliveryError";
    deliveryError.code = error.name || "RESEND_API_ERROR";
    deliveryError.statusCode = error.statusCode;
    throw deliveryError;
  }
  if (!data?.id) {
    const deliveryError = new Error("Resend did not return an email ID.");
    deliveryError.code = "RESEND_EMPTY_RESPONSE";
    throw deliveryError;
  }
  return data;
};

const brandedEmail = (title, body) => `<!doctype html><html><body style="margin:0;background:#000;color:#fff;font-family:Arial,sans-serif"><div style="max-width:560px;margin:32px auto;padding:32px;background:#0a0a0a;border:1px solid #292929;border-radius:12px"><strong style="font-size:20px">FixLab</strong><h1 style="font-size:22px;margin:32px 0 16px">${escapeHtml(title)}</h1><div style="color:#d4d4d4;line-height:1.6">${body}</div></div></body></html>`;

const brandedOtpEmail = (otp, signInUrl) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Your FixLab sign-in code</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#ffffff">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#ffffff">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;background:#000000;border:1px solid #292d33;border-radius:14px">
            <tr>
              <td style="padding:36px 36px 40px">
                <div style="font-size:24px;font-weight:700;line-height:1.3;color:#ffffff">FixLab</div>
                <h1 style="margin:32px 0 18px;font-size:30px;line-height:1.2;font-weight:700;color:#ffffff">Your sign-in code</h1>
                <p style="margin:0 0 28px;font-size:17px;line-height:1.65;color:#c0c6d0">Use this one-time code to continue:</p>
                <p style="margin:0 0 28px;font-size:36px;line-height:1.4;font-weight:700;letter-spacing:8px;color:#ffffff;overflow-wrap:anywhere">${escapeHtml(otp)}</p>
                ${signInUrl ? `<p style="margin:0 0 24px;font-size:16px;line-height:1.6"><a href="${escapeHtml(signInUrl)}" style="color:#ffffff;text-decoration:underline">Or sign in with this secure link</a></p>` : ""}
                <p style="margin:0;font-size:15px;line-height:1.7;color:#c0c6d0">This code expires in 10 minutes. Do not share it with anyone. If you did not request it, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export const sendOtpEmail = (email, otp, signInUrl) => sendEmail({
  to: email,
  subject: "Your FixLab sign-in code",
  text: `Use this one-time code to continue: ${otp}. This code expires in 10 minutes. Do not share it with anyone.${signInUrl ? ` Or sign in with this secure link: ${signInUrl}` : ""} If you did not request it, you can ignore this email.`,
  html: brandedOtpEmail(otp, signInUrl),
});

const brandedResetEmail = (resetUrl) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Reset your FixLab password</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#ffffff">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#ffffff">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;background:#08090b;border:1px solid #292d33;border-radius:14px">
            <tr>
              <td style="padding:36px 36px 40px">
                <div style="font-size:24px;font-weight:700;line-height:1.3;color:#ffffff">FixLab</div>
                <h1 style="margin:32px 0 18px;font-size:30px;line-height:1.2;font-weight:700;color:#ffffff">Reset your password</h1>
                <p style="margin:0 0 28px;font-size:17px;line-height:1.65;color:#c0c6d0">A password reset was requested for your FixLab account.</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate">
                  <tr>
                    <td align="center" bgcolor="#ffffff" style="border-radius:10px;background:#ffffff">
                      <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:16px 28px;border:1px solid #ffffff;border-radius:10px;color:#08090b;background:#ffffff;font-size:17px;line-height:1.3;font-weight:700;text-decoration:none">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:28px 0 0;font-size:15px;line-height:1.7;color:#c0c6d0">This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export const sendResetEmail = (email, resetUrl) => sendEmail({
  to: email,
  subject: "Reset your FixLab password",
  text: `A password reset was requested for your FixLab account. Reset password: ${resetUrl} This link expires in 30 minutes. If you did not request this, you can ignore this email.`,
  html: brandedResetEmail(resetUrl),
});

export const sendSecurityAlert = (email, username, details, idempotencyKey) => {
  const safeUsername = escapeHtml(username || "there");
  const safeTime = escapeHtml(details.time);
  const safeDevice = escapeHtml(details.device);
  const safeLocation = escapeHtml(details.location || "Location unavailable");
  const safeIp = escapeHtml(details.ip || "Unavailable");
  const safeSessionsUrl = details.sessionsUrl ? escapeHtml(details.sessionsUrl) : "";
  const safeBrowser = escapeHtml(details.browser || details.device || "Unknown browser");
  const safePlatform = escapeHtml(details.platform || "Unknown platform");
  const safeMethod = escapeHtml(details.authMethod === "google" ? "Google" : details.authMethod === "password" ? "Email and password" : "Email verification");
  const appUrl = process.env.CLIENT_URL || process.env.APP_URL || "https://fixlab-repair.vercel.app";
  const appDomain = (() => { try { return new URL(appUrl).host; } catch { return "FixLab"; } })();
  const logoUrl = `${appUrl.replace(/\/$/, "")}/icon.svg`;
  return sendEmail({
    to: email,
    subject: "Security alert: New sign-in to your FixLab account.",
    idempotencyKey: `login-alert/${idempotencyKey}`,
    text: `Hello ${username || "there"}, we detected a successful sign-in to FixLab (${appDomain}) at ${details.time} (UTC). Approximate location: ${details.location || "Unknown location"}. Device: ${details.device || "Unknown device"}. Browser: ${details.browser || "Unknown browser"}. Operating system: ${details.platform || "Unknown platform"}. Sign-in method: ${details.authMethod === "google" ? "Google" : details.authMethod === "password" ? "Email and password" : "Email verification"}. IP address: ${details.ip || "Unavailable"}. If this was you, no action is required. If you do not recognize this activity, open FixLab using a trusted bookmark and review your sessions${details.sessionsUrl ? `: ${details.sessionsUrl}` : ""}.`,
    html: brandedEmail("New login detected", `<p style="margin:0 0 20px"><img src="${escapeHtml(logoUrl)}" width="36" height="36" alt="FixLab" style="vertical-align:middle;margin-right:10px"><strong>FixLab</strong></p><p>Hello ${safeUsername},</p><p>We detected a successful sign-in to your FixLab account.</p><p><strong>Website:</strong> FixLab (${escapeHtml(appDomain)})<br><strong>Time:</strong> ${safeTime} (UTC)<br><strong>Approximate location:</strong> ${safeLocation}<br><strong>Device:</strong> ${safeDevice}<br><strong>Browser:</strong> ${safeBrowser}<br><strong>Operating system:</strong> ${safePlatform}<br><strong>Sign-in method:</strong> ${safeMethod}<br><strong>IP address:</strong> ${safeIp}</p><p>If this was you, no action is required.</p>${safeSessionsUrl ? `<p style="margin:28px 0"><a href="${safeSessionsUrl}" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#fff;color:#08090b;font-weight:700;text-decoration:none">Review account security</a></p>` : ""}<p>If you do not recognize this activity, open FixLab using a trusted bookmark, review your active sessions, and secure your account. Never share your password or verification codes.</p>`),
  });
};

export const sendAccountCreatedEmail = (email, username) => sendEmail({
  to: email,
  subject: "Your FixLab account was created",
  text: `Hello ${username}, your FixLab account has been created.`,
  html: brandedEmail("Welcome to FixLab", `<p>Hello ${escapeHtml(username)}, your FixLab account has been created.</p>`),
});

export const sendPasswordChangedEmail = (email) => sendEmail({
  to: email,
  subject: "Your FixLab password was changed",
  text: "The password for your FixLab account was changed. If this was not you, contact FixLab support immediately.",
  html: brandedEmail("Password changed", "<p>The password for your FixLab account was changed. If this was not you, contact FixLab support immediately.</p>"),
});
