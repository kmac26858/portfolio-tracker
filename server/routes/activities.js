import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ── GET /api/activities ───────────────────────────────────────────────────────
router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT id, action, ticker, shares, price, date, brokerage, owner, notes
              FROM activities WHERE user_id = ?
              ORDER BY date DESC, created_at DESC`)
    .all(req.userId);
  res.json({ activities: rows });
});

// ── POST /api/activities ──────────────────────────────────────────────────────
router.post("/", requireAuth, (req, res) => {
  const { id, action, ticker, shares, price, date, brokerage = "", owner = "", notes = "" } = req.body;

  if (!id || typeof id !== "string") return res.status(400).json({ error: "id required" });
  if (!["BUY", "SELL"].includes(action))  return res.status(400).json({ error: "action must be BUY or SELL" });
  if (!ticker || typeof ticker !== "string") return res.status(400).json({ error: "ticker required" });
  if (typeof shares !== "number" || shares <= 0) return res.status(400).json({ error: "shares must be > 0" });
  if (typeof price  !== "number" || price  <= 0) return res.status(400).json({ error: "price must be > 0" });
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });

  db.prepare(`
    INSERT INTO activities (id, user_id, action, ticker, shares, price, date, brokerage, owner, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.userId, action, ticker.toUpperCase(), shares, price, date, brokerage, owner, notes);

  res.json({ ok: true, id });
});

// ── DELETE /api/activities/:id ────────────────────────────────────────────────
router.delete("/:id", requireAuth, (req, res) => {
  const result = db
    .prepare("DELETE FROM activities WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

export default router;
