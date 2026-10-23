import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { sendSecurityAlert } from "../utils/email.js";

test("security alert is branded, escapes user content, and contains no authentication secrets", async (t) => {
  let payload;
  let smtpOptions;
  let transportClosed = false;
  t.mock.method(nodemailer, "createTransport", (options) => {
    smtpOptions = options;
    return {
      async sendMail(message) { payload = message; },
      close() { transportClosed = true; },
    };
  });
  process.env.EMAIL_HOST = "smtp.example.com";
  process.env.EMAIL_PORT = "587";
  process.env.EMAIL_USER = "mailer@example.com";
  process.env.EMAIL_PASS = "test-password";
  process.env.EMAIL_FROM = "FixLab <test@example.com>";

  await sendSecurityAlert("person@example.com", "<script>alert(1)</script>", {
    time: "2026-10-19 12:00 UTC",
    device: "Browser & OS",
    location: "Unavailable",
    sessionsUrl: "https://fixlab.example/dashboard/sessions",
  }, "session-test-id");

  assert.equal(payload.to, "person@example.com");
  assert.equal(payload.subject, "Security alert: New sign-in to your FixLab account.");
  assert.match(payload.html, /&lt;script&gt;/);
  assert.doesNotMatch(payload.html, /<script>/);
  assert.doesNotMatch(payload.text, /password=|otp=|token=|cookie=/i);
  assert.match(payload.text, /2026-10-19 12:00 UTC/);
  assert.equal(payload.messageId, "<login-alert/session-test-id@fixlab.local>");
  assert.equal(smtpOptions.host, "smtp.example.com");
  assert.equal(smtpOptions.port, 587);
  assert.equal(smtpOptions.secure, false);
  assert.equal(transportClosed, true);
  assert.match(payload.html, /Review account security/);
});
