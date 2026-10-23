import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { requireSameOrigin } from "../middleware/requireSameOrigin.js";
import { getSecurityNotifications, getUnreadSecurityNotificationCount, markSecurityNotificationRead } from "../controllers/security-notifications.controller.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getSecurityNotifications);
router.get("/unread-count", getUnreadSecurityNotificationCount);
router.patch("/:id/read", requireSameOrigin, markSecurityNotificationRead);
export default router;
