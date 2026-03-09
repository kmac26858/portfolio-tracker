import { Router } from "express";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const router = Router();

// ── In-memory price cache ─────────────────────────────────────────────────────
// Keyed by ticker → { price, fetchedAt }
// Prevents hammering Yahoo Finance on every page load / hot reload.
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCached(ticker) {
  const entry = cache.get(ticker);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(ticker);
    return null;
  }
  return entry.price;
}

// ── GET /api/prices?tickers=AAPL,MSFT,SPY ────────────────────────────────────
// No auth required — prices are public data.
// Returns { AAPL: 213.49, MSFT: 415.32, ... } for tickers that resolved.
router.get("/", async (req, res, next) => {
  try {
    const tickers = (req.query.tickers || "")
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 50); // safety cap

    if (tickers.length === 0) return res.json({});

    // Only fetch tickers not already in the cache
    const stale = tickers.filter((t) => getCached(t) === null);

    if (stale.length > 0) {
      const results = await Promise.allSettled(
        stale.map((t) =>
          yf.quote(t, { fields: ["regularMarketPrice"] }, { validateResult: false })
        )
      );

      results.forEach((result, i) => {
        if (result.status === "fulfilled" && result.value?.regularMarketPrice != null) {
          cache.set(stale[i], {
            price: result.value.regularMarketPrice,
            fetchedAt: Date.now(),
          });
        }
      });
    }

    // Build response from cache (only tickers that resolved)
    const prices = {};
    tickers.forEach((t) => {
      const p = getCached(t);
      if (p !== null) prices[t] = p;
    });

    res.json(prices);
  } catch (err) {
    next(err);
  }
});

export default router;
