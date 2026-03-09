import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import db from "../db.js";

const router = Router();

const BCRYPT_ROUNDS = 12; // ~250ms on a modern CPU — strong but not sluggish
const TOKEN_TTL = "8h";

/** Options for the httpOnly session cookie. */
function cookieOpts() {
  return {
    httpOnly: true,           // JS cannot read this cookie — XSS safe
    sameSite: "strict",       // no CSRF from cross-site requests
    secure: process.env.NODE_ENV === "production", // HTTPS only in prod
    maxAge: 8 * 60 * 60 * 1000, // 8 hours in ms
    path: "/",
  };
}

function issueToken(userId) {
  return jwt.sign(
    { sub: userId },          // only store opaque id — no sensitive data in JWT
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post("/register", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const clean = username.trim();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let userId;
    try {
      const result = db
        .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
        .run(clean, hash);
      userId = result.lastInsertRowid;
    } catch (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(409).json({ error: "Username already taken" });
      }
      throw err; // unexpected — let global handler deal with it
    }

    // Provision an empty portfolio row for this user
    db.prepare("INSERT INTO portfolios (user_id) VALUES (?)").run(userId);

    res.cookie("portfolio_token", issueToken(userId), cookieOpts());
    res.status(201).json({ username: clean, isNewUser: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = db
      .prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .get(username.trim());

    // Constant-time comparison even when user does not exist
    const dummyHash = "$2b$12$invalidhashpadding000000000000000000000000000000000000";
    const match = await bcrypt.compare(password, user?.password_hash ?? dummyHash);

    if (!user || !match) {
      // Generic message — never reveal whether username exists
      return res.status(401).json({ error: "Invalid username or password" });
    }

    res.cookie("portfolio_token", issueToken(user.id), cookieOpts());
    res.json({ username: username.trim(), isNewUser: false });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/logout", (_req, res) => {
  res.clearCookie("portfolio_token", { path: "/" });
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────── session check on page load ──────────────────────
router.get("/me", (req, res) => {
  const header = req.headers.cookie || "";
  const entry = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("portfolio_token="));
  const token = entry ? decodeURIComponent(entry.slice("portfolio_token=".length)) : null;

  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(payload.sub);

    if (!user) {
      res.clearCookie("portfolio_token", { path: "/" });
      return res.status(401).json({ error: "User no longer exists" });
    }

    res.json({ username: user.username });
  } catch {
    res.clearCookie("portfolio_token", { path: "/" });
    return res.status(401).json({ error: "Session expired" });
  }
});

export default router;
