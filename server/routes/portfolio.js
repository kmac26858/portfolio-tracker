import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// ── GET /api/portfolio ────────────────────────────────────────────────────────
router.get("/", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT investor_names, positions, crypto, cash, house FROM portfolios WHERE user_id = ?")
    .get(req.userId);

  if (!row) return res.json({ investorNames: [], positions: [], crypto: [], cash: [], house: [] });

  res.json({
    investorNames: JSON.parse(row.investor_names),
    positions:     JSON.parse(row.positions),
    crypto:        JSON.parse(row.crypto  || "[]"),
    cash:          JSON.parse(row.cash    || "[]"),
    house:         JSON.parse(row.house   || "[]"),
  });
});

// ── PUT /api/portfolio ────────────────────────────────────────────────────────
router.put("/", requireAuth, (req, res) => {
  const { investorNames, positions, crypto = [], cash = [], house = [] } = req.body;

  if (!Array.isArray(investorNames) || !Array.isArray(positions) ||
      !Array.isArray(crypto) || !Array.isArray(cash) || !Array.isArray(house)) {
    return res.status(400).json({ error: "Invalid payload shape" });
  }

  db.prepare(`
    UPDATE portfolios
    SET investor_names = ?, positions = ?, crypto = ?, cash = ?, house = ?, updated_at = unixepoch()
    WHERE user_id = ?
  `).run(
    JSON.stringify(investorNames), JSON.stringify(positions),
    JSON.stringify(crypto), JSON.stringify(cash), JSON.stringify(house),
    req.userId
  );

  res.json({ ok: true });
});

export default router;
