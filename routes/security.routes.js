import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { getLoginEvents } from "../controllers/security-notifications.controller.js";
const router = express.Router();
router.use(requireAuth);
router.get("/login-events", getLoginEvents);
export default router;
