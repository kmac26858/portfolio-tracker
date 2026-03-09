import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ── GET /api/portfolio ────────────────────────────────────────────────────────
router.get("/", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT investor_names, positions FROM portfolios WHERE user_id = ?")
    .get(req.userId);

  if (!row) {
    // Shouldn't happen (row is created on register), but handle gracefully
    return res.json({ investorNames: [], positions: [] });
  }

  res.json({
    investorNames: JSON.parse(row.investor_names),
    positions: JSON.parse(row.positions),
  });
});

// ── PUT /api/portfolio ────────────────────────────────────────────────────────
router.put("/", requireAuth, (req, res) => {
  const { investorNames, positions } = req.body;

  if (!Array.isArray(investorNames) || !Array.isArray(positions)) {
    return res.status(400).json({ error: "Invalid payload shape" });
  }

  db.prepare(`
    UPDATE portfolios
    SET investor_names = ?, positions = ?, updated_at = unixepoch()
    WHERE user_id = ?
  `).run(JSON.stringify(investorNames), JSON.stringify(positions), req.userId);

  res.json({ ok: true });
});

export default router;
