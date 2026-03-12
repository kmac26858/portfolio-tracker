import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ── GET /api/snapshots ────────────────────────────────────────────────────────
router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT date, value FROM snapshots WHERE user_id = ? ORDER BY date ASC")
    .all(req.userId);
  res.json(rows);
});

// ── PUT /api/snapshots ────────────────────────────────────────────────────────
// Upserts a single { date, value } snapshot for the authenticated user.
router.put("/", requireAuth, (req, res) => {
  const { date, value } = req.body;

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (typeof value !== "number" || !isFinite(value) || value < 0) {
    return res.status(400).json({ error: "value must be a non-negative number" });
  }

  db.prepare(`
    INSERT INTO snapshots (user_id, date, value) VALUES (?, ?, ?)
    ON CONFLICT (user_id, date) DO UPDATE SET value = excluded.value
  `).run(req.userId, date, value);

  res.json({ ok: true });
});

export default router;
