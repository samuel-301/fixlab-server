import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import Session from './models/Session.js';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDirectory, '.env') });
dotenv.config({ path: path.resolve(serverDirectory, '../.env') });

const [
  { default: connectDB },
  { default: deviceRoutes },
  { default: collectionRoutes },
  { default: serviceCollectionRoutes },
  { default: paymentRoutes },
  { default: authRoutes },
  { default: activityRoutes },
  { closeRedis, getRedisStatus },
  { getOperationalMetrics, requestMetricsMiddleware },
  { default: notificationRoutes },
  { default: securityRoutes },
] = await Promise.all([
  import('./config/db.js'),
  import('./routes/device.routes.js'),
  import('./routes/collection.routes.js'),
  import('./routes/serviceCollection.routes.js'),
  import('./routes/payment.routes.js'),
  import('./routes/auth.routes.js'),
  import('./routes/activity.routes.js'),
  import('./config/redis.js'),
  import('./utils/operationalMetrics.js'),
  import('./routes/notifications.routes.js'),
  import('./routes/security.routes.js'),
]);

const { initializeAdmin } = await import('./services/admin-initialization.js');
await connectDB();
await initializeAdmin();

const app = express();
const trustedProxy = process.env.TRUSTED_PROXY;
app.set(
  "trust proxy",
  trustedProxy
    ? /^\d+$/.test(trustedProxy)
      ? Number(trustedProxy)
      : trustedProxy.split(",").map((value) => value.trim()).filter(Boolean)
    : false,
);
const httpServer = http.createServer(app);

const clientOrigins = process.env.CLIENT_ORIGINS
  ? process.env.CLIENT_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
  : ["http://localhost:5173", "http://localhost:3000"];

const io = new Server(httpServer, {
  cors: {
    origin: clientOrigins,
    credentials: true,
  },
});

io.use(async (socket, next) => {
  try {
    const cookie = socket.handshake.headers.cookie || "";
    const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("token="))?.slice(6);
    if (!token) return next(new Error("Authentication required"));
    const decoded = jwt.verify(decodeURIComponent(token), process.env.JWT_SECRET);
    const session = await Session.findOne({ sessionId: decoded.sessionId, user: decoded.id }).select("user sessionId").lean();
    if (!session) return next(new Error("Session expired"));
    socket.data.userId = String(session.user);
    socket.data.sessionId = session.sessionId;
    next();
  } catch { next(new Error("Authentication required")); }
});
io.on("connection", (socket) => {
  socket.join(`user:${socket.data.userId}`);
  socket.join(socket.data.sessionId);
});

global.io = io;

app.use(cors({ origin: clientOrigins, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(requestMetricsMiddleware);

app.get("/health", (_req, res) => {
  const databaseAvailable = mongoose.connection.readyState === 1;
  res.status(databaseAvailable ? 200 : 503).json({
    status: databaseAvailable ? "ok" : "degraded",
    database: { available: databaseAvailable },
    redis: getRedisStatus(),
    metrics: getOperationalMetrics(),
  });
});

app.use('/uploads', express.static(path.join(path.resolve(), 'uploads')));

app.use((req, res, next) => {
  const safeUrl = req.path.replace(/\/sessions\/[^/?]+/g, "/sessions/:sessionId");
  console.log(`[${new Date().toISOString()}] ${req.method} ${safeUrl}`);
  next();
});

app.use('/api/device', deviceRoutes);
app.use('/api/collection', collectionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/service-collection', serviceCollectionRoutes);
app.use('/api/payment', paymentRoutes);
app.use("/api/activities", activityRoutes);

app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "Image exceeds the upload size limit." });
  }
  if (err?.name === "MulterError") {
    return res.status(400).json({ message: "Invalid image upload." });
  }
  if (err?.message === "Only JPEG, PNG, and WebP images are allowed.") {
    return res.status(415).json({ message: err.message });
  }
  console.error("Unhandled request error", { name: err?.name, code: err?.code });
  res.status(500).json({ message: "Request failed." });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, '0.0.0.0', () =>
  console.log(`Server running on port ${PORT}`)
);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; closing server connections`);
  io.close();
  await new Promise((resolve) => {
    if (!httpServer.listening) return resolve();
    httpServer.close(resolve);
  });
  await Promise.allSettled([mongoose.disconnect(), closeRedis()]);
};

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
