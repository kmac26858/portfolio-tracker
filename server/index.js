// Load environment variables before any other module reads process.env
import "dotenv/config";
import { randomBytes } from "crypto";

// ── JWT secret guard ──────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  // In development, generate an ephemeral secret so the server just works.
  // WARNING: sessions will NOT survive a server restart — set JWT_SECRET in .env
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  console.warn(
    "[WARN] JWT_SECRET is not set in .env — using a temporary secret.\n" +
    "       Sessions will be lost on server restart. See .env.example."
  );
}

import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import portfolioRoutes from "./routes/portfolio.js";
import pricesRoutes from "./routes/prices.js";
import snapshotsRoutes from "./routes/snapshots.js";
import activitiesRoutes from "./routes/activities.js";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(
  cors({
    // In dev, Vite proxies /api so the browser never calls this directly.
    // In production set CLIENT_ORIGIN to the deployed frontend URL.
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/prices", pricesRoutes);
app.use("/api/snapshots", snapshotsRoutes);
app.use("/api/activities", activitiesRoutes);

// ── Global error handler — never leak stack traces to clients ─────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});
