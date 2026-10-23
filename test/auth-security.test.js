import test from "node:test";
import assert from "node:assert/strict";
import {
  generateOtp,
  hashSecret,
  isStrongPassword,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  safeRedirect,
  secretsMatch,
} from "../utils/auth-security.js";

test("email validation and normalization reject malformed input", () => {
  assert.equal(normalizeEmail("  Person@Example.com "), "person@example.com");
  assert.equal(isValidEmail("person@example.com"), true);
  assert.equal(isValidEmail("person@localhost"), false);
  assert.equal(isValidEmail("not an email"), false);
});

test("OTP values are six digits and only their hash is needed for verification", () => {
  const otp = generateOtp();
  assert.match(otp, /^\d{6}$/);
  assert.equal(secretsMatch(otp, hashSecret(otp)), true);
  assert.equal(secretsMatch("000000", hashSecret(otp)), otp === "000000");
  assert.notEqual(hashSecret(otp), otp);
});

test("email masking keeps the destination recognizable without revealing its local part", () => {
  assert.equal(maskEmail("person@example.com"), "p*****@example.com");
});

test("password policy requires a long bounded secret", () => {
  assert.equal(isStrongPassword("correct-horse-battery"), true);
  assert.equal(isStrongPassword("short"), false);
  assert.equal(isStrongPassword("x".repeat(73)), false);
  assert.equal(isStrongPassword("é".repeat(37)), false);
});

test("post-auth redirects remain on FixLab and reject protocol-relative values", () => {
  assert.equal(safeRedirect("/dashboard/devices?view=all"), "/dashboard/devices?view=all");
  assert.equal(safeRedirect("//attacker.example"), "/dashboard");
  assert.equal(safeRedirect("https://attacker.example"), "/dashboard");
  assert.equal(safeRedirect("/\\attacker.example"), "/dashboard");
});