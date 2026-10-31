import express from "express";
import {
  register,
  login,
  adminLogin,
  logout,
  getMe,
  googleLogin,
  getMySessions,
  getProfile,
  updateProfile,
  getSessionDetails,
  logoutSession,
  logoutFromAllSessions,
  logoutOtherSessions,
  getAllUsers,
  deleteAccount,
  startEmailChallenge,
  getEmailSignInMethods,
  verifyEmailLink,
  verifyEmailChallenge,
  completeEmailRegistration,
  requestPasswordReset,
  completePasswordReset,
} from "../controllers/auth.controller.js";
import { isAdmin, requireAuth } from "../middleware/authMiddleware.js";
import uploadP from "../middleware/profileUpload.js";
import { requireSameOrigin } from "../middleware/requireSameOrigin.js";
import { authenticationLimiter, emailChallengeLimiter, sessionMutationLimiter } from "../middleware/sessionRateLimiter.js";
import { invalidateUserCache } from "../middleware/responseCache.js";
import { getSecurityNotificationSettings, updateSecurityNotificationSettings, getCurrentPushSubscription, registerPushSubscription, removePushSubscription } from "../controllers/security-notifications.controller.js";
const router = express.Router();

router.post("/register", requireSameOrigin, authenticationLimiter, register);
router.post("/login", requireSameOrigin, authenticationLimiter, login);
router.post("/admin/login", requireSameOrigin, authenticationLimiter, adminLogin);
router.post("/login/google", requireSameOrigin, authenticationLimiter, googleLogin);
router.post("/email/start", requireSameOrigin, emailChallengeLimiter, startEmailChallenge);
router.post("/email/methods", requireSameOrigin, emailChallengeLimiter, getEmailSignInMethods);
router.post("/email/verify", requireSameOrigin, authenticationLimiter, verifyEmailChallenge);
router.post("/email/verify-link", requireSameOrigin, authenticationLimiter, verifyEmailLink);
router.post("/email/register", requireSameOrigin, authenticationLimiter, completeEmailRegistration);
router.post("/password/forgot", requireSameOrigin, emailChallengeLimiter, requestPasswordReset);
router.post("/password/reset", requireSameOrigin, authenticationLimiter, completePasswordReset);
router.post("/logout", requireSameOrigin, logout);
router.get("/me", requireAuth, getMe);
router.get("/profile", requireAuth, getProfile);
router.put("/edit-profile", requireSameOrigin, requireAuth, invalidateUserCache, uploadP.single('profile'), updateProfile);
router.delete("/account", requireSameOrigin, requireAuth, invalidateUserCache, deleteAccount);
router.get("/sessions", requireAuth, getMySessions);
router.get("/sessions/:sessionId", requireAuth, getSessionDetails);
router.delete("/sessions/:sessionId", requireSameOrigin, requireAuth, sessionMutationLimiter, logoutSession);
router.delete("/sessions-others", requireSameOrigin, requireAuth, sessionMutationLimiter, logoutOtherSessions);
router.delete("/sessions-all", requireSameOrigin, requireAuth, sessionMutationLimiter, logoutFromAllSessions);
router.get("/security-notifications", requireAuth, getSecurityNotificationSettings);
router.patch("/security-notifications", requireSameOrigin, requireAuth, updateSecurityNotificationSettings);
router.get("/security-notifications/subscriptions/current", requireAuth, getCurrentPushSubscription);
router.post("/security-notifications/subscriptions", requireSameOrigin, requireAuth, registerPushSubscription);
router.delete("/security-notifications/subscriptions/:id", requireSameOrigin, requireAuth, removePushSubscription);
router.get("/admin/users", requireAuth, isAdmin, getAllUsers);

export default router;
