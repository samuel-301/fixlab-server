import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { deleteCloudinaryImage, getUserWithImageUrl, uploadImage } from "../config/cloudinary.js";

import User from "../models/User.js";
import Session from "../models/Session.js";
import Activity from "../models/Activity.js";
import Collection from "../models/Collection.js";
import Device from "../models/Device.js";
import Payment from "../models/Payment.js";
import ServiceCollection from "../models/ServiceCollection.js";
import AuthChallenge from "../models/AuthChallenge.js";
import {
  generateOpaqueToken,
  generateOtp,
  hashSecret,
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
  safeRedirect,
  secretsMatch,
} from "../utils/auth-security.js";
import {
  sendAccountCreatedEmail,
  sendOtpEmail,
  sendPasswordChangedEmail,
  sendResetEmail,
} from "../utils/email.js";
import { sendSecurityNotifications } from "../utils/security-notifications.js";
import { formatLocation, getRequestClientIp, resolveClientLocationAsync } from "../utils/geolocation.js";
import NotificationPreference from "../models/NotificationPreference.js";
import WebPushSubscription from "../models/WebPushSubscription.js";
import SecurityNotification from "../models/SecurityNotification.js";
import LoginEvent from "../models/LoginEvent.js";
import { compareAdminPassword, validateAdminConfiguration } from "../services/admin-initialization.js";
import {
  buildSessionResponse,
  describeUserAgent,
  revokeOtherSessions,
  revokeOwnedSession,
  SESSION_ID_PATTERN,
} from "../utils/session-management.js";

// Utility to extract session data
const createSession = async (req, userId, isRecognizedDevice = false, authMethod = "password") => {
  const sessionId = uuidv4();
  const ip = getRequestClientIp(req);
  const userAgent = typeof req.get("user-agent") === "string" ? req.get("user-agent") : "";
  const details = describeUserAgent(userAgent);
  // Session location is resolved server-side from the request IP only.
  // Never trust or store browser/device coordinates submitted by the client.
  const geolocation = await resolveClientLocationAsync(ip).then((resolved) => ({
    ...resolved,
    method: resolved.display ? "ip-geolocation" : "unavailable",
    accuracyMeters: null,
    capturedAt: new Date().toISOString(),
  }));
  const location = formatLocation(geolocation);

  const session = new Session({
    user: userId,
    sessionId,
    ip: ip || undefined,
    location,
    geolocation,
    locationMethod: geolocation.method,
    locationCapturedAt: geolocation.capturedAt ? new Date(geolocation.capturedAt) : undefined,
    locationAccuracyMeters: geolocation.accuracyMeters ?? undefined,
    userAgent,
    device: details.device,
    platform: details.platform,
    browser: details.browser,
    browserVersion: details.browserVersion,
    deviceType: details.deviceType,
    authMethod,
    isNewDevice: !isRecognizedDevice,
    isRecognizedDevice,
  });

  await session.save();
  return { sessionId, ip, geolocation, location, details };
};

const authCookieOptions = () => {
  const configuredSameSite = process.env.COOKIE_SAME_SITE?.toLowerCase();
  // The Vercel frontend and Render API use different sites. In production,
  // the browser needs SameSite=None; Secure to send the session cookie to the API.
  // COOKIE_SAME_SITE can still explicitly override this for custom deployments.
  const defaultSameSite = process.env.NODE_ENV === "production" ? "none" : "lax";
  const sameSite = ["lax", "strict", "none"].includes(configuredSameSite) ? configuredSameSite : defaultSameSite;
  return {
    httpOnly: true,
    sameSite,
    secure: process.env.NODE_ENV === "production" || sameSite === "none",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
};

const startSession = async (req, res, user, authMethod = "password") => {
  const userAgent = typeof req.get("user-agent") === "string" ? req.get("user-agent") : "";
  // IP changes are common (mobile networks, VPNs, travel) and are not enough
  // to classify a sign-in as a new device. Use the browser/device signature
  // as a conservative signal; the session itself remains independently tracked.
  const existingDevice = userAgent
    ? await Session.exists({ user: user._id, userAgent, createdAt: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } })
    : false;
  const { sessionId, ip, geolocation, location, details } = await createSession(req, user._id, Boolean(existingDevice), authMethod);
  const token = jwt.sign({ id: user._id, sessionId }, process.env.JWT_SECRET, { expiresIn: "1d" });
  try {
    await LoginEvent.create({
      user: user._id, sessionId, occurredAt: new Date(), ip: ip || undefined,
      location, geolocation, locationMethod: geolocation.method,
      userAgent: userAgent.slice(0, 500), browserVersion: details.browserVersion,
      deviceType: details.deviceType,
      locationCapturedAt: geolocation.capturedAt ? new Date(geolocation.capturedAt) : undefined,
      locationAccuracyMeters: geolocation.accuracyMeters ?? undefined,
      browser: details.browserName, platform: details.platform,
      device: details.device, authMethod, isNewDevice: !existingDevice,
    });
  } catch (error) {
    await Session.deleteOne({ user: user._id, sessionId }).catch(() => {});
    throw error;
  }
  res.cookie("token", token, authCookieOptions());
  const sessionsUrl = (process.env.CLIENT_URL || process.env.APP_URL)
    ? `${(process.env.CLIENT_URL || process.env.APP_URL).replace(/\/$/, "")}/dashboard/sessions`
    : undefined;
  // Login notifications are best-effort and never block a successful sign-in.
  void sendSecurityNotifications(user, {
    time: new Date().toISOString(),
    ip: ip || undefined,
    userAgent: userAgent.slice(0, 500),
    device: details.device,
    deviceType: details.deviceType,
    browser: details.browserName,
    browserVersion: details.browserVersion,
    platform: details.platform,
    authMethod,
    location,
    geolocation,
    locationMethod: geolocation.method,
    locationCapturedAt: geolocation.capturedAt,
    locationAccuracyMeters: geolocation.accuracyMeters,
    sessionsUrl,
  }, sessionId).catch(() => console.warn("Login security notification delivery failed"));
  return sessionId;
};

const validEmail = (email) => isValidEmail(email) && normalizeEmail(email).length <= 254;

const emailLookup = (email) => {
  const normalized = normalizeEmail(email);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    $or: [
      { normalizedEmail: normalized },
      { email: new RegExp(`^${escaped}$`, "i") },
    ],
  };
};

export const getEmailSignInMethods = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return res.status(400).json({ message: "Enter a valid email address." });
  try {
    const user = await User.findOne(emailLookup(email)).select("provider googleSub");
    const provider = user?.provider || "local";
    return res.json({ hasPasswordLogin: Boolean(user && provider === "local"), hasGoogleLogin: Boolean(user && (provider === "google" || user.googleSub)) });
  } catch {
    return res.status(503).json({ message: "Unable to check sign-in options right now." });
  }
};

export const startEmailChallenge = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return res.status(400).json({ message: "Enter a valid email address." });
  let challengeId;
  try {
    const recent = await AuthChallenge.findOne({ email, purpose: "sign-in", createdAt: { $gt: new Date(Date.now() - 60_000) } });
    if (recent) return res.status(202).json({ message: "If this address can be used, a code has been sent." });
    const otp = generateOtp();
    const appUrl = process.env.CLIENT_URL || process.env.APP_URL;
    const linkToken = appUrl ? generateOpaqueToken() : null;
    await AuthChallenge.deleteMany({ email, purpose: "sign-in" });
    const challenge = await AuthChallenge.create({
      email, purpose: "sign-in", otpHash: hashSecret(otp),
      linkTokenHash: linkToken ? hashSecret(linkToken) : undefined,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    challengeId = challenge._id;
    const signInUrl = linkToken
      ? `${appUrl.replace(/\/$/, "")}/auth/continue#emailToken=${encodeURIComponent(linkToken)}&email=${encodeURIComponent(email)}`
      : undefined;
    await sendOtpEmail(email, otp, signInUrl);
    return res.status(202).json({ message: "If this address can be used, a code has been sent." });
  } catch (error) {
    // Remove failed challenges so retries do not falsely report that an email was sent.
    if (challengeId) await AuthChallenge.deleteOne({ _id: challengeId }).catch(() => {});
    console.error("[auth-email] challenge delivery failed", {
      name: String(error?.name || "Error").slice(0, 80),
      code: String(error?.code || "").slice(0, 80),
      responseCode: Number(error?.statusCode || error?.responseCode) || undefined,
      command: String(error?.command || "").slice(0, 40) || undefined,
      message: String(error?.message || "Unknown email delivery error").slice(0, 300),
    });
    return res.status(503).json({ message: "Email sign-in is temporarily unavailable. Try again later." });
  }
};

export const verifyEmailLink = async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email) || token.length < 32) return res.status(400).json({ message: "That sign-in link is invalid or expired." });
  try {
    const candidates = await AuthChallenge.find({ email, purpose: "sign-in", consumedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(5);
    const candidate = candidates.find((item) => item.linkTokenHash && secretsMatch(token, item.linkTokenHash));
    if (!candidate) return res.status(400).json({ message: "That sign-in link is invalid or expired." });
    const user = await User.findOne(emailLookup(email));
    const update = user ? { consumedAt: new Date() } : { verifiedAt: new Date() };
    const challenge = await AuthChallenge.findOneAndUpdate(
      { _id: candidate._id, consumedAt: null, verifiedAt: null, expiresAt: { $gt: new Date() } },
      { $set: update },
      { new: true },
    );
    if (!challenge) return res.status(400).json({ message: "That sign-in link is invalid or expired." });
    if (user) {
      if (!user.emailVerified) { user.emailVerified = true; await user.save(); }
      await startSession(req, res, user, "email-link");
      return res.json({ state: "signed-in", redirect: safeRedirect(req.body?.redirect) });
    }
    const registrationToken = generateOpaqueToken();
    await AuthChallenge.updateOne({ _id: challenge._id }, { $set: { registrationTokenHash: hashSecret(registrationToken) } });
    return res.json({ state: "registration", registrationToken });
  } catch {
    return res.status(500).json({ message: "Unable to verify the sign-in link." });
  }
};

export const verifyEmailChallenge = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp = typeof req.body?.otp === "string" ? req.body.otp : "";
  if (!validEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: "Enter the six-digit code sent to your email." });
  }
  try {
    const challenge = await AuthChallenge.findOne({ email, purpose: "sign-in", consumedAt: null, verifiedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!challenge || challenge.attempts >= 5) return res.status(400).json({ message: "That code is invalid or expired. Request a new one." });
    if (!secretsMatch(otp, challenge.otpHash)) {
      await AuthChallenge.updateOne({ _id: challenge._id, verifiedAt: null, consumedAt: null }, { $inc: { attempts: 1 } });
      return res.status(400).json({ message: "That code is invalid or expired. Request a new one." });
    }
    const user = await User.findOne(emailLookup(email)).sort({ _id: 1 });
    if (user) {
      const consumed = await AuthChallenge.findOneAndUpdate(
        { _id: challenge._id, verifiedAt: null, consumedAt: null, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } },
        { $set: { consumedAt: new Date() } },
        { new: true },
      );
      if (!consumed) return res.status(400).json({ message: "That code is invalid or expired. Request a new one." });
      if (!user.emailVerified) { user.emailVerified = true; await user.save(); }
      await startSession(req, res, user, "email-link");
      return res.json({ state: "signed-in", redirect: safeRedirect(req.body?.redirect) });
    }
    const verified = await AuthChallenge.findOneAndUpdate(
      { _id: challenge._id, verifiedAt: null, consumedAt: null, attempts: { $lt: 5 }, expiresAt: { $gt: new Date() } },
      { $set: { verifiedAt: new Date() } },
      { new: true },
    );
    if (!verified) return res.status(400).json({ message: "That code is invalid or expired. Request a new one." });
    const registrationToken = generateOpaqueToken();
    await AuthChallenge.updateOne({ _id: verified._id }, { $set: { registrationTokenHash: hashSecret(registrationToken) } });
    return res.json({ state: "registration", registrationToken });
  } catch {
    return res.status(500).json({ message: "Unable to verify the code. Try again." });
  }
};

export const completeEmailRegistration = async (req, res) => {
  const { registrationToken, email, username, password } = req.body || {};
  const normalizedUsername = typeof username === "string" ? username.trim() : "";
  const normalizedAddress = normalizeEmail(email);
  if (typeof registrationToken !== "string" || registrationToken.length < 32 || !validEmail(normalizedAddress) || !/^[a-zA-Z0-9_.-]{3,30}$/.test(normalizedUsername) || !isStrongPassword(password)) {
    return res.status(400).json({ message: "Use a 3-30 character username and a password of at least 12 characters." });
  }
  try {
    const challenge = await AuthChallenge.findOne({
      email: normalizedAddress,
      purpose: "sign-in",
      registrationTokenHash: { $exists: true },
      verifiedAt: { $ne: null },
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });
    if (!challenge || !secretsMatch(registrationToken, challenge.registrationTokenHash)) {
      return res.status(400).json({ message: "Email verification expired. Start again." });
    }
    if (await User.exists(emailLookup(challenge.email))) return res.status(409).json({ message: "An account already exists for this email. Sign in instead." });
    if (await User.exists({ username: normalizedUsername })) return res.status(409).json({ message: "That username is already in use." });
    const user = await User.create({
      username: normalizedUsername,
      email: challenge.email,
      emailVerified: true,
      normalizedEmail: challenge.email,
      password: await bcrypt.hash(password, 12),
      provider: "local",
    });
    await AuthChallenge.updateOne({ _id: challenge._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
    await startSession(req, res, user, "email-link");
    void sendAccountCreatedEmail(user.email, user.username).catch(() => {});
    return res.status(201).json({ message: "Account created", redirect: safeRedirect(req.body?.redirect) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "That username or email is already registered." });
    return res.status(500).json({ message: "Unable to create the account. Try again." });
  }
};

export const requestPasswordReset = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!validEmail(email)) return res.status(400).json({ message: "Enter a valid email address." });
  try {
    const user = await User.findOne(emailLookup(email));
    if (user) {
      const recent = await AuthChallenge.findOne({ email, purpose: "password-reset", createdAt: { $gt: new Date(Date.now() - 60_000) } });
      if (!recent) {
        const token = generateOpaqueToken();
        await AuthChallenge.deleteMany({ email, purpose: "password-reset" });
        await AuthChallenge.create({ email, purpose: "password-reset", linkTokenHash: hashSecret(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
        const baseUrl = process.env.CLIENT_URL || process.env.APP_URL;
        if (baseUrl) await sendResetEmail(email, `${baseUrl.replace(/\/$/, "")}/auth/reset#token=${encodeURIComponent(token)}`);
      }
    }
  } catch {
    // Keep reset responses identical to avoid disclosing account existence.
  }
  return res.json({ message: "If an account exists for that email, a reset link has been sent." });
};

export const completePasswordReset = async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== "string" || token.length < 32 || !isStrongPassword(password)) {
    return res.status(400).json({ message: "The reset link is invalid or expired, or the password does not meet policy." });
  }
  try {
    const candidates = await AuthChallenge.find({ purpose: "password-reset", consumedAt: null, expiresAt: { $gt: new Date() } }).limit(20);
    const challenge = candidates.find((item) => secretsMatch(token, item.linkTokenHash));
    if (!challenge) return res.status(400).json({ message: "The reset link is invalid or expired." });
    const consumed = await AuthChallenge.findOneAndUpdate({ _id: challenge._id, consumedAt: null, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { new: true });
    if (!consumed) return res.status(400).json({ message: "The reset link is invalid or expired." });
    const user = await User.findOneAndUpdate(emailLookup(challenge.email), { $set: { password: await bcrypt.hash(password, 12) } }, { new: true });
    if (!user) return res.status(400).json({ message: "The reset link is invalid or expired." });
    await Session.deleteMany({ user: user._id });
    await LoginEvent.updateMany({ user: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await AuthChallenge.deleteMany({ email: challenge.email, purpose: "password-reset", _id: { $ne: challenge._id } });
    void sendPasswordChangedEmail(user.email).catch(() => {});
    return res.json({ message: "Password changed. Sign in with your new password." });
  } catch {
    return res.status(500).json({ message: "Unable to reset password. Try again." });
  }
};

export const register = async (req, res) => {
  return res.status(410).json({ message: "Use email verification to create a FixLab account." });
};

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    const identifier = typeof username === "string" ? username.trim() : "";
    const normalizedIdentifier = normalizeEmail(identifier);
    const user = await User.findOne({ $or: [{ username: identifier }, emailLookup(normalizedIdentifier)] });
    const match = user ? await bcrypt.compare(typeof password === "string" ? password : "", user.password) : false;
    if (!user || !match) return res.status(401).json({ message: "Invalid email, username, or password." });
    await startSession(req, res, user, "password");
    return res.json({ message: "Logged in", userId: user._id });
  } catch {
    return res.status(500).json({ message: "Unable to sign in. Try again." });
  }
};

export const adminLogin = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  try {
    const { email: configuredEmail } = validateAdminConfiguration();
    if (!password || email !== configuredEmail) return res.status(401).json({ message: "Invalid email or password." });
    const user = await User.findOne(emailLookup(configuredEmail));
    const match = user?.role === "admin" && await compareAdminPassword(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid email or password." });
    await startSession(req, res, user, "password");
    return res.json({ message: "Logged in", role: "admin" });
  } catch { return res.status(401).json({ message: "Invalid email or password." }); }
};

export const googleLogin = async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const origin = req.get("origin");

    if (!clientId) {
      return res.status(503).json({ message: "Google sign-in is not configured." });
    }
    if (req.get("x-requested-with") !== "XmlHttpRequest") {
      return res.status(403).json({ message: "Google sign-in request could not be verified." });
    }
    if (typeof accessToken !== "string" || accessToken.length < 20 || accessToken.length > 8192) {
      return res.status(401).json({ message: "Google sign-in could not be verified." });
    }

    const allowedOrigins = (process.env.CLIENT_ORIGINS || "https://fixlab-repair.vercel.app")
      .split(",").map((value) => value.trim()).filter(Boolean);
    if (!origin || !allowedOrigins.includes(origin)) {
      return res.status(403).json({ message: "Google sign-in origin is not allowed." });
    }

    // Validate the access token with Google's token-info endpoint, including
    // the intended OAuth client ID and the scopes requested by FixLab.
    let tokenInfo;
    try {
      const tokenInfoResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!tokenInfoResponse.ok) {
        return res.status(401).json({ message: "Google sign-in token is invalid or expired. Please try again." });
      }
      tokenInfo = await tokenInfoResponse.json();
    } catch {
      return res.status(503).json({ message: "Google sign-in verification is temporarily unavailable." });
    }

    const grantedScopes = typeof tokenInfo.scope === "string" ? tokenInfo.scope.split(" ") : [];
    if (
      tokenInfo.aud !== clientId ||
      !(Number(tokenInfo.expires_in) > 0) ||
      !grantedScopes.includes("openid") ||
      !grantedScopes.includes("email") ||
      !grantedScopes.includes("profile")
    ) {
      return res.status(401).json({ message: "Google sign-in could not be verified." });
    }

    let profile;
    try {
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!profileResponse.ok) {
        return res.status(401).json({ message: "Google account details could not be verified." });
      }
      profile = await profileResponse.json();
    } catch {
      return res.status(503).json({ message: "Google account verification is temporarily unavailable." });
    }

    if (
      !profile ||
      typeof profile.sub !== "string" ||
      !profile.sub ||
      typeof profile.email !== "string" ||
      !profile.email_verified ||
      !validEmail(profile.email)
    ) {
      return res.status(401).json({ message: "Google account could not be verified." });
    }

    const email = normalizeEmail(profile.email);
    let user = await User.findOne({ googleSub: profile.sub });
    if (!user) {
      user = await User.findOne(emailLookup(email));
      if (user?.googleSub && user.googleSub !== profile.sub) {
        return res.status(409).json({ message: "This email is already linked to a different Google account." });
      }
      if (user && !user.googleSub) {
        user.googleSub = profile.sub;
        user.emailVerified = true;
        await user.save();
      }
    }
    if (user && !user.emailVerified) {
      user.emailVerified = true;
      await user.save();
    }
    if (!user) {
      const localPart = email.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 22) || "fixlab-user";
      let username = localPart;
      while (await User.exists({ username })) username = `${localPart}-${uuidv4().slice(0, 6)}`;
      user = await User.create({
        username,
        email,
        normalizedEmail: email,
        emailVerified: true,
        fullName: typeof profile.name === "string" ? profile.name.slice(0, 100) : "",
        password: await bcrypt.hash(generateOpaqueToken(), 12),
        provider: "google",
        googleSub: profile.sub,
        profileImage: typeof profile.picture === "string" ? profile.picture : undefined,
      });
      void sendAccountCreatedEmail(email, username).catch(() => {});
    }

    await startSession(req, res, user, "google");
    return res.json({
      message: "Logged in with Google",
      userId: user._id,
      redirect: safeRedirect(req.body?.redirect),
    });
  } catch (error) {
    console.error("[auth-google] OAuth token verification failed", {
      name: String(error?.name || "Error").slice(0, 80),
      code: String(error?.code || "").slice(0, 80),
    });
    return res.status(500).json({ message: "Google sign-in failed. Try again." });
  }
};

export const logout = async (req, res) => {
  try {
    const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    await Session.deleteOne({ sessionId: decoded.sessionId, user: decoded.id });
    await LoginEvent.updateOne({ sessionId: decoded.sessionId, user: decoded.id, revokedAt: null }, { $set: { revokedAt: new Date() } });

    res.clearCookie("token", authCookieOptions()).json({ message: "Logged out" });
  } catch (err) {
    res.status(401).json({ message: "Unable to end session" });
  }
};


export const getMe = async (req, res) => {
  try {
    res.json(await getUserWithImageUrl(req.user));
  } catch {
    res.status(500).json({ message: "Unable to load account information." });
  }
};

// Get all active sessions for user
export const getMySessions = async (req, res) => {
  try {
    const sessions = await Session.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(sessions.map((session) => buildSessionResponse(session, req.sessionId)));
  } catch (err) {
    res.status(500).json({ message: "Unable to load sessions" });
  }
};

// Get and update user profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json(await getUserWithImageUrl(user));
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to load profile", error: err.message });
  }
};


export const updateProfile = async (req, res) => {
  let stage = "profile update";
  try {
    const { username, email, fullName } = req.body;
    if (typeof email === "string" && normalizeEmail(email) !== normalizeEmail(req.user.email || "")) {
      return res.status(400).json({ message: "Email changes require a separate verification flow." });
    }

    const currentUser = await User.findById(req.user._id).select("-password");
    if (!currentUser) return res.status(404).json({ message: "User not found." });

    const updateData = { username, email: req.user.email, fullName };
    let uploadedProfileImage;
    if (req.file) {
      stage = "profile image upload";
      uploadedProfileImage = await uploadImage(req.file, "profiles");
      updateData.profileImage = uploadedProfileImage.url;
      updateData.profileImagePublicId = uploadedProfileImage.publicId;
    }

    let updatedUser;
    try {
      stage = "profile database update";
      updatedUser = await User.findByIdAndUpdate(req.user._id, updateData, { new: true, runValidators: true }).select("-password");
    } catch (error) {
      if (uploadedProfileImage?.publicId) { try { await deleteCloudinaryImage(uploadedProfileImage.publicId); } catch {} }
      throw error;
    }

    if (req.file && currentUser.profileImagePublicId && currentUser.profileImagePublicId !== uploadedProfileImage?.publicId) {
      stage = "old profile image cleanup";
      try { await deleteCloudinaryImage(currentUser.profileImagePublicId); }
      catch (error) { console.warn("Unable to remove replaced Cloudinary profile image", { code: error.code, name: error.name }); }
    }

    stage = "profile response signing";
    res.json({ message: "Profile updated", user: await getUserWithImageUrl(updatedUser) });
  } catch (err) {
    // Log only operational metadata; provider errors can contain request details.
    const errorName = String(err?.name || "Error").slice(0, 80);
    const errorCode = String(err?.Code || err?.code || "").slice(0, 80);
    const statusCode = Number(err?.$metadata?.httpStatusCode) || undefined;
    console.error("Profile update failed", { stage, errorName, errorCode, statusCode });

    const isStorageStep = stage.includes("image") || stage.includes("response signing");
    const publicMessage = isStorageStep
      ? err.code === "CLOUDINARY_CONFIG_MISSING" ? err.message : "Profile image storage failed. Please try again."
      : "Failed to update profile";
    res.status(err.code === "CLOUDINARY_CONFIG_MISSING" ? 503 : 500).json({
      message: publicMessage,
      code: isStorageStep ? "PROFILE_IMAGE_STORAGE_FAILED" : "PROFILE_UPDATE_FAILED",
    });
  }
};

export const logoutSession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return res.status(400).json({ message: "Invalid session identifier" });
    }
    if (sessionId === req.sessionId) {
      return res.status(409).json({ message: "Use log out to end the current session" });
    }

    const session = await revokeOwnedSession(Session, req.user._id, sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    await LoginEvent.updateOne({ sessionId, user: req.user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

    // Emit socket event to that session (user’s device)
    if (global.io) {
      global.io.to(sessionId).emit("force-logout", {
        sessionId,
        message: "You have been logged out from another device",
      });
    }

    res.json({ message: "Logged out from session", sessionId });
  } catch (err) {
    res.status(500).json({ message: "Unable to revoke session" });
  }
};

export const getSessionDetails = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return res.status(400).json({ message: "Invalid session identifier" });
    }

    const session = await Session.findOne({
      sessionId,
      user: req.user._id,
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    res.json(buildSessionResponse(session, req.sessionId));
  } catch (err) {
    res.status(500).json({ message: "Unable to load session details" });
  }
};

export const logoutFromAllSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ user: req.user._id }).select("sessionId");
    sessions.forEach(({ sessionId }) => {
      if (global.io) global.io.to(sessionId).emit("force-logout", { message: "This session has been revoked" });
    });
    await Session.deleteMany({ user: req.user._id });
    await LoginEvent.updateMany({ user: req.user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });

    // Clear the auth token cookie
    res.clearCookie("token", authCookieOptions());

    res.json({ message: "Logged out from all sessions" });
  } catch (err) {
    res.status(500).json({ message: "Unable to log out from all sessions" });
  }
};

export const logoutOtherSessions = async (req, res) => {
  try {
    const others = await Session.find({ user: req.user._id, sessionId: { $ne: req.sessionId } }).select("sessionId");
    const result = await revokeOtherSessions(Session, req.user._id, req.sessionId);
    await LoginEvent.updateMany({ user: req.user._id, sessionId: { $in: others.map(({ sessionId }) => sessionId) }, revokedAt: null }, { $set: { revokedAt: new Date() } });
    others.forEach(({ sessionId }) => {
      if (global.io) global.io.to(sessionId).emit("force-logout", { message: "This session has been revoked" });
    });
    res.json({ message: "Other sessions revoked", revokedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: "Unable to revoke other sessions" });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user._id;
    const [accountUser, ownedDevices] = await Promise.all([
      User.findById(userId).select("profileImagePublicId"),
      Device.find({ createdBy: userId }).select("imagePublicId image"),
    ]);
    await Promise.allSettled([
      deleteCloudinaryImage(accountUser?.profileImagePublicId),
      ...ownedDevices.map((device) => deleteCloudinaryImage(device.imagePublicId)),
    ]);
    await Promise.all([
      Session.deleteMany({ user: userId }),
      WebPushSubscription.deleteMany({ user: userId }),
      NotificationPreference.deleteOne({ user: userId }),
      SecurityNotification.deleteMany({ user: userId }),
      LoginEvent.deleteMany({ user: userId }),
      Activity.deleteMany({ user: userId }),
      Payment.deleteMany({ user: userId }),
      ServiceCollection.deleteMany({ user: userId }),
      Device.deleteMany({ createdBy: userId }),
      Collection.deleteMany({ createdBy: userId }),
    ]);
    await User.deleteOne({ _id: userId });
    res.clearCookie("token", authCookieOptions()).json({ message: "Account deleted" });
  } catch (err) {
    res.status(500).json({
      message: "Failed to delete account",
      error: err.message,
    });
  }
};

// Get all users (admin only)
export const getAllUsers = async (req, res) => {
  try {

    const users = await User.find().select("-password").sort({ createdAt: -1 });

    res.status(200).json(await Promise.all(users.map(getUserWithImageUrl)));
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users", error: err.message });
  }
};
