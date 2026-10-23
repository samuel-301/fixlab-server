import { createHash, randomInt, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isValidEmail = (value) =>
  typeof value === "string" && value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const maskEmail = (email) => {
  const [local, domain] = normalizeEmail(email).split("@");
  if (!local || !domain) return "your email address";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(local.length - 1, 8)))}@${domain}`;
};

export const generateOtp = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

export const generateOpaqueToken = () => randomBytes(32).toString("base64url");

export const hashSecret = (value) => {
  const salt = randomBytes(16);
  const derived = scryptSync(value, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
};

export const secretsMatch = (candidate, expectedHash) => {
  const [saltHex, hashHex] = (expectedHash || "").split(":");
  if (!/^[a-f0-9]{32}$/i.test(saltHex || "") || !/^[a-f0-9]{64}$/i.test(hashHex || "")) return false;
  const expected = Buffer.from(hashHex, "hex");
  const candidateHash = scryptSync(candidate, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(candidateHash, expected);
};

export const isStrongPassword = (password) =>
  typeof password === "string" && password.length >= 12 && Buffer.byteLength(password, "utf8") <= 72;

export const safeRedirect = (value, fallback = "/dashboard") => {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  try {
    const parsed = new URL(value, "https://fixlab.invalid");
    return parsed.origin === "https://fixlab.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
};