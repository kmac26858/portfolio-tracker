import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Plus, Trash2, ChevronDown, ChevronRight, Download, Upload, X, TrendingUp, TrendingDown, DollarSign, Users, LogOut, Lock, Pencil, FileSpreadsheet, Settings } from "lucide-react";

// ── Dummy last prices (replace with Yahoo Finance MCP later) ──────────────────
const DUMMY_PRICES = {
  AAPL: 213.49, MSFT: 415.32, GOOGL: 175.84, AMZN: 196.21, NVDA: 131.38,
  TSLA: 248.50, META: 562.14, BRK: 413.00, JPM: 245.17, V: 330.55,
  SPY: 537.20, QQQ: 462.80, VTI: 268.14, VOO: 493.72, IWM: 208.45,
  SCHD: 79.34, VGT: 582.90, ARKK: 48.12, GLD: 231.05, BND: 72.88,
};
const getPrice = (ticker) => DUMMY_PRICES[ticker.toUpperCase()] ?? 100.0;

const BROKERAGES = ["Robinhood", "eTrade", "Fidelity", "Schwab", "Vanguard"];
const CHART_COLORS = ["#00ff88", "#00c4ff", "#ff6b35", "#ffd700", "#c084fc", "#fb7185", "#34d399", "#f472b6"];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n, dec = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtDollar = (n) => `$${fmt(n)}`;
const fmtPct = (n) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const uid = () => Math.random().toString(36).slice(2, 9);

// A lot is long-term if it was purchased more than 1 year before today
const isLongTerm = (purchaseDate) => {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  return new Date(purchaseDate) <= cutoff;
};

// ── API fetch helper — always sends cookies, always parses JSON ───────────────
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: "include",   // send the httpOnly JWT cookie on every request
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({ error: "Network error" }));
  if (!res.ok) throw Object.assign(new Error(body.error || "Request failed"), { status: res.status });
  return body;
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCsvText(text, users) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) return [];

  // Parse a single CSV line respecting quoted fields
  const splitLine = (line) => {
    const fields = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { fields.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  };

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));

  // Flexible column lookup — tolerates different brokerage export naming
  const col = (aliases) => headers.findIndex((h) => aliases.includes(h));
  const idx = {
    ticker:       col(["ticker", "symbol", "stock", "security"]),
    shares:       col(["shares", "quantity", "qty", "numshares"]),
    costPerShare: col(["costpershare", "cost", "price", "avgcost", "averagecost", "averageprice"]),
    brokerage:    col(["brokerage", "broker", "account", "firm"]),
    owner:        col(["owner", "user", "investor", "name"]),
    type:         col(["type", "assettype", "securitytype"]),
    purchaseDate: col(["purchasedate", "date", "buydate", "acquireddate"]),
  };

  return lines.slice(1).map((line, i) => {
    const f = splitLine(line);
    const get = (key) => (idx[key] >= 0 ? (f[idx[key]] ?? "").trim() : "");

    const ticker       = get("ticker").toUpperCase();
    const sharesRaw    = get("shares");
    const costRaw      = get("costPerShare");
    const brokerage    = get("brokerage") || BROKERAGES[0];
    const ownerRaw     = get("owner");
    const owner        = users.includes(ownerRaw) ? ownerRaw : (users[0] ?? ownerRaw);
    const type         = ["Stock", "ETF", "ESPP", "RSU"].includes(get("type")) ? get("type") : "Stock";
    const purchaseDate = get("purchaseDate") || new Date().toISOString().slice(0, 10);

    const errors = [];
    if (!ticker)                             errors.push("missing ticker");
    const shares      = parseFloat(sharesRaw);
    if (isNaN(shares) || shares <= 0)        errors.push("invalid shares");
    const costPerShare = parseFloat(costRaw);
    if (isNaN(costPerShare) || costPerShare <= 0) errors.push("invalid cost/share");

    return {
      _row: i + 2, ticker, shares, costPerShare,
      totalCost: shares * costPerShare,
      brokerage, owner, type, purchaseDate,
      errors, valid: errors.length === 0,
    };
  });
}

// ── CSV Import Modal ──────────────────────────────────────────────────────────
function CsvImportModal({ users, onImport, onClose }) {
  const [rows, setRows] = useState(null);
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setRows(parseCsvText(ev.target.result, users));
    reader.readAsText(file);
  };

  const valid   = rows?.filter((r) => r.valid)   ?? [];
  const invalid = rows?.filter((r) => !r.valid)  ?? [];

  const handleConfirm = () => {
    onImport(valid.map((r) => ({ ...r, id: uid() })));
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 680, maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#00c4ff" }}>BULK CSV IMPORT</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>

        {!rows ? (
          /* ── step 1: instructions + file picker ── */
          <div>
            <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              Select a <strong style={{ color: "#94a3b8" }}>.csv</strong> file with your positions.
              Column headers are flexible — the importer recognises common brokerage names.
            </p>
            <div style={{ background: "#060b12", border: "1px solid #1e293b", borderRadius: 6, padding: "10px 14px", fontFamily: "monospace", fontSize: 11, color: "#94a3b8", marginBottom: 16, lineHeight: 1.8 }}>
              <span style={{ color: "#475569" }}># Required columns</span>{"\n"}
              Ticker · Shares · Cost Per Share{"\n"}
              <span style={{ color: "#475569" }}># Optional columns (smart defaults applied if missing)</span>{"\n"}
              Brokerage · Owner · Type · Purchase Date
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ ...styles.btnSecondary, flex: 1 }} onClick={() => fileRef.current.click()}>
                <Upload size={13} /> CHOOSE FILE
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
          </div>
        ) : (
          /* ── step 2: preview ── */
          <>
            <div style={{ display: "flex", gap: 16, marginBottom: 12, alignItems: "center" }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "#00ff88" }}>✓ {valid.length} valid</span>
              {invalid.length > 0 && (
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#ff6b35" }}>✗ {invalid.length} with errors</span>
              )}
              <button style={{ ...styles.btnSecondary, marginLeft: "auto", padding: "4px 10px", fontSize: 10 }}
                onClick={() => { setRows(null); fileRef.current.value = ""; fileRef.current.click(); }}>
                CHANGE FILE
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />
            </div>

            {/* column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 0.8fr 0.9fr 0.8fr 0.6fr", padding: "4px 8px", marginBottom: 4 }}>
              {["TICKER", "SHARES", "COST/SH", "BROKERAGE", "OWNER", "TYPE"].map((h) => (
                <div key={h} style={{ ...styles.th, fontSize: 9 }}>{h}</div>
              ))}
            </div>

            <div style={{ overflowY: "auto", flex: 1, marginBottom: 14 }}>
              {rows.map((row, i) => (
                <div key={i} style={{
                  borderRadius: 5, marginBottom: 3, padding: "6px 8px",
                  background: row.valid ? "#0a1628" : "#ff6b3510",
                  border: `1px solid ${row.valid ? "#1e293b" : "#ff6b3540"}`,
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 0.8fr 0.9fr 0.8fr 0.6fr", fontFamily: "monospace", fontSize: 11 }}>
                    <div style={{ color: row.valid ? "#e2e8f0" : "#ff6b35", fontWeight: 700 }}>{row.ticker || "—"}</div>
                    <div style={{ color: "#94a3b8" }}>{isNaN(row.shares) ? "—" : row.shares}</div>
                    <div style={{ color: "#94a3b8" }}>{isNaN(row.costPerShare) ? "—" : fmtDollar(row.costPerShare)}</div>
                    <div style={{ color: "#94a3b8" }}>{row.brokerage}</div>
                    <div style={{ color: "#94a3b8" }}>{row.owner}</div>
                    <div style={{ color: "#94a3b8" }}>{row.type}</div>
                  </div>
                  {!row.valid && (
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: "#ff6b35", marginTop: 3 }}>
                      Row {row._row}: {row.errors.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <button
              style={{ ...styles.btnPrimary, borderColor: "#00c4ff", color: "#00c4ff", background: "#00c4ff18" }}
              onClick={handleConfirm}
              disabled={valid.length === 0}
            >
              <FileSpreadsheet size={13} />
              IMPORT {valid.length} POSITION{valid.length !== 1 ? "S" : ""} →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Login / Register Screen ───────────────────────────────────────────────────
function LoginScreen({ onLogin, onRegister }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);

    if (!username.trim() || !password) {
      return setError("Username and password are required.");
    }

    if (mode === "register") {
      if (username.trim().length < 3) return setError("Username must be at least 3 characters.");
      if (password.length < 8) return setError("Password must be at least 8 characters.");
      if (password !== confirmPwd) return setError("Passwords do not match.");
    }

    setLoading(true);
    try {
      const data = await apiFetch(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (mode === "register") {
        onRegister(data.username); // new user → show onboarding
      } else {
        onLogin(data.username);   // existing user → load portfolio
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => { if (e.key === "Enter") handleSubmit(); };

  return (
    <div style={styles.app}>
      <div style={styles.gridBg} />
      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ ...styles.modal, width: 380 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ ...styles.logo, fontSize: 22, display: "block", marginBottom: 6 }}>◈ PORTFOLIO</div>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "#334155", letterSpacing: 2 }}>
              SECURE ACCESS
            </div>
          </div>

          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 0, marginBottom: 24, background: "#060b12", borderRadius: 8, padding: 3, border: "1px solid #1e293b" }}>
            {["login", "register"].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(null); }}
                style={{
                  flex: 1, padding: "8px 0", border: "none", cursor: "pointer",
                  fontFamily: "monospace", fontSize: 11, letterSpacing: 2,
                  borderRadius: 6, transition: "all 0.2s",
                  background: mode === m ? "#0a1628" : "transparent",
                  color: mode === m ? "#00ff88" : "#334155",
                  boxShadow: mode === m ? "0 0 0 1px #1e293b" : "none",
                }}>
                {m === "login" ? "SIGN IN" : "REGISTER"}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <span style={styles.label}>USERNAME</span>
            <input
              value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={handleKey}
              placeholder="your_username" autoComplete="username"
              style={styles.input}
            />
          </div>
          <div style={{ marginBottom: mode === "register" ? 14 : 0 }}>
            <span style={styles.label}>PASSWORD</span>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={handleKey}
              placeholder={mode === "register" ? "min. 8 characters" : "••••••••"} autoComplete={mode === "register" ? "new-password" : "current-password"}
              style={styles.input}
            />
          </div>
          {mode === "register" && (
            <div>
              <span style={styles.label}>CONFIRM PASSWORD</span>
              <input
                type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} onKeyDown={handleKey}
                placeholder="••••••••" autoComplete="new-password"
                style={styles.input}
              />
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "#ff6b3515", border: "1px solid #ff6b3540", borderRadius: 6, fontFamily: "monospace", fontSize: 12, color: "#ff6b35" }}>
              {error}
            </div>
          )}

          <button style={{ ...styles.btnPrimary, marginTop: 20 }} onClick={handleSubmit} disabled={loading}>
            <Lock size={13} />
            {loading ? "AUTHENTICATING..." : mode === "login" ? "SIGN IN →" : "CREATE ACCOUNT →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Onboarding Modal ──────────────────────────────────────────────────────────
function OnboardingModal({ onDone }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(["User 1", "User 2"]);

  const handleCount = (v) => {
    const n = Math.max(1, Math.min(6, Number(v)));
    setCount(n);
    setNames((prev) => {
      const arr = [...prev];
      while (arr.length < n) arr.push(`User ${arr.length + 1}`);
      return arr.slice(0, n);
    });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>PORTFOLIO SETUP</span>
          <span style={{ color: "#00ff88", fontFamily: "monospace", fontSize: 12 }}>v1.0</span>
        </div>
        <p style={styles.modalSub}>How many investors are tracked in this portfolio?</p>
        <input
          type="number" min={1} max={6} value={count}
          onChange={(e) => handleCount(e.target.value)}
          style={styles.input}
        />
        <div style={{ marginTop: 20 }}>
          {names.map((n, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={styles.label}>USER {i + 1}</span>
              <input
                value={n}
                onChange={(e) => setNames((prev) => prev.map((x, j) => j === i ? e.target.value : x))}
                style={{ ...styles.input, flex: 1, marginBottom: 0 }}
              />
            </div>
          ))}
        </div>
        <button style={styles.btnPrimary} onClick={() => onDone(names.filter(Boolean))}>
          INITIALIZE PORTFOLIO →
        </button>
      </div>
    </div>
  );
}

// ── Add Position Modal ────────────────────────────────────────────────────────
function AddPositionModal({ users, onAdd, onClose }) {
  const [form, setForm] = useState({
    ticker: "", shares: "", costPerShare: "", brokerage: BROKERAGES[0],
    owner: users[0], type: "Stock", purchaseDate: new Date().toISOString().slice(0, 10),
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const totalCost = (parseFloat(form.shares) || 0) * (parseFloat(form.costPerShare) || 0);

  const handleSubmit = () => {
    if (!form.ticker || !form.shares || !form.costPerShare) return;
    onAdd({
      id: uid(), ticker: form.ticker.toUpperCase(),
      shares: parseFloat(form.shares), costPerShare: parseFloat(form.costPerShare),
      totalCost, brokerage: form.brokerage, owner: form.owner,
      type: form.type, purchaseDate: form.purchaseDate,
    });
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 480 }}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>ADD POSITION</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>
        <div style={styles.formGrid}>
          <FormField label="TICKER" value={form.ticker} onChange={(v) => set("ticker", v.toUpperCase())} placeholder="e.g. AAPL" />
          <FormField label="SHARES" value={form.shares} onChange={(v) => set("shares", v)} type="number" placeholder="0" />
          <FormField label="COST / SHARE" value={form.costPerShare} onChange={(v) => set("costPerShare", v)} type="number" placeholder="0.00" prefix="$" />
          <div style={styles.fieldFull}>
            <span style={styles.label}>TOTAL COST BASIS</span>
            <div style={{ ...styles.input, background: "#0d1117", color: "#00ff88", cursor: "default" }}>
              {fmtDollar(totalCost)}
            </div>
          </div>
          <div>
            <span style={styles.label}>BROKERAGE</span>
            <select value={form.brokerage} onChange={(e) => set("brokerage", e.target.value)} style={styles.select}>
              {BROKERAGES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <span style={styles.label}>OWNER</span>
            <select value={form.owner} onChange={(e) => set("owner", e.target.value)} style={styles.select}>
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <span style={styles.label}>TYPE</span>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {["Stock", "ETF", "ESPP", "RSU"].map((t) => (
                <button key={t} onClick={() => set("type", t)}
                  style={{ ...styles.pill, ...(form.type === t ? styles.pillActive : {}) }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <FormField label="PURCHASE DATE" value={form.purchaseDate} onChange={(v) => set("purchaseDate", v)} type="date" />
        </div>
        <button style={styles.btnPrimary} onClick={handleSubmit}>CONFIRM POSITION →</button>
      </div>
    </div>
  );
}

// ── Sell Position Modal ───────────────────────────────────────────────────────
function SellPositionModal({ positions, onSell, onClose }) {
  const tickers = [...new Set(positions.map((p) => p.ticker))];
  const [ticker, setTicker] = useState(tickers[0] || "");
  const [sellDate, setSellDate] = useState(new Date().toISOString().slice(0, 10));
  const lots = positions.filter((p) => p.ticker === ticker);
  const [lotShares, setLotShares] = useState({});

  const handleSell = () => {
    onSell(ticker, lotShares, sellDate);
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 500 }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#ff6b35" }}>SELL POSITION</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 16 }}>
          <span style={styles.label}>TICKER</span>
          <select value={ticker} onChange={(e) => setTicker(e.target.value)} style={styles.select}>
            {tickers.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <span style={styles.label}>SELL DATE</span>
          <input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} style={styles.input} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <span style={styles.label}>LOTS — ENTER SHARES TO SELL (leave blank to skip)</span>
          {lots.map((lot) => (
            <div key={lot.id} style={styles.lotRow}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#e2e8f0", fontSize: 13 }}>{lot.purchaseDate} · {lot.brokerage} · {lot.owner}</div>
                <div style={{ color: "#64748b", fontSize: 12 }}>Held: {lot.shares} shares @ {fmtDollar(lot.costPerShare)}</div>
              </div>
              <input
                type="number" placeholder="0" min={0} max={lot.shares}
                value={lotShares[lot.id] || ""}
                onChange={(e) => setLotShares((s) => ({ ...s, [lot.id]: e.target.value }))}
                style={{ ...styles.input, width: 80, marginBottom: 0, textAlign: "right" }}
              />
            </div>
          ))}
        </div>
        <button style={{ ...styles.btnPrimary, background: "#ff6b3522", borderColor: "#ff6b35", color: "#ff6b35" }} onClick={handleSell}>
          CONFIRM SELL →
        </button>
      </div>
    </div>
  );
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function FormField({ label, value, onChange, type = "text", placeholder = "", prefix }) {
  return (
    <div>
      <span style={styles.label}>{label}</span>
      <div style={{ position: "relative" }}>
        {prefix && <span style={styles.inputPrefix}>{prefix}</span>}
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...styles.input, ...(prefix ? { paddingLeft: 24 } : {}) }} />
      </div>
    </div>
  );
}

// ── Edit Position Modal ───────────────────────────────────────────────────────
function EditPositionModal({ lot, users, onSave, onClose }) {
  const [form, setForm] = useState({
    ticker: lot.ticker,
    shares: String(lot.shares),
    costPerShare: String(lot.costPerShare),
    brokerage: lot.brokerage,
    owner: lot.owner,
    type: lot.type,
    purchaseDate: lot.purchaseDate,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const totalCost = (parseFloat(form.shares) || 0) * (parseFloat(form.costPerShare) || 0);

  const handleSubmit = () => {
    if (!form.ticker || !form.shares || !form.costPerShare) return;
    onSave({
      ...lot,
      ticker: form.ticker.toUpperCase(),
      shares: parseFloat(form.shares),
      costPerShare: parseFloat(form.costPerShare),
      totalCost,
      brokerage: form.brokerage,
      owner: form.owner,
      type: form.type,
      purchaseDate: form.purchaseDate,
    });
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 480 }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#00c4ff" }}>EDIT POSITION</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>
        <div style={styles.formGrid}>
          <FormField label="TICKER" value={form.ticker} onChange={(v) => set("ticker", v.toUpperCase())} placeholder="e.g. AAPL" />
          <FormField label="SHARES" value={form.shares} onChange={(v) => set("shares", v)} type="number" placeholder="0" />
          <FormField label="COST / SHARE" value={form.costPerShare} onChange={(v) => set("costPerShare", v)} type="number" placeholder="0.00" prefix="$" />
          <div style={styles.fieldFull}>
            <span style={styles.label}>TOTAL COST BASIS</span>
            <div style={{ ...styles.input, background: "#0d1117", color: "#00ff88", cursor: "default" }}>
              {fmtDollar(totalCost)}
            </div>
          </div>
          <div>
            <span style={styles.label}>BROKERAGE</span>
            <select value={form.brokerage} onChange={(e) => set("brokerage", e.target.value)} style={styles.select}>
              {BROKERAGES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <span style={styles.label}>OWNER</span>
            <select value={form.owner} onChange={(e) => set("owner", e.target.value)} style={styles.select}>
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <span style={styles.label}>TYPE</span>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {["Stock", "ETF", "ESPP", "RSU"].map((t) => (
                <button key={t} onClick={() => set("type", t)}
                  style={{ ...styles.pill, ...(form.type === t ? styles.pillActive : {}) }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <FormField label="PURCHASE DATE" value={form.purchaseDate} onChange={(v) => set("purchaseDate", v)} type="date" />
        </div>
        <button style={{ ...styles.btnPrimary, borderColor: "#00c4ff", color: "#00c4ff", background: "#00c4ff18" }} onClick={handleSubmit}>
          SAVE CHANGES →
        </button>
      </div>
    </div>
  );
}

// ── Positions Tab ─────────────────────────────────────────────────────────────
function PositionsTab({ positions, users, onEdit }) {
  const [expanded, setExpanded] = useState({});
  const [editingLot, setEditingLot] = useState(null);
  const toggle = (t) => setExpanded((e) => ({ ...e, [t]: !e[t] }));

  const grouped = useMemo(() => {
    const map = {};
    positions.forEach((p) => {
      if (!map[p.ticker]) map[p.ticker] = [];
      map[p.ticker].push(p);
    });
    return Object.entries(map).map(([ticker, lots]) => {
      const totalShares = lots.reduce((s, l) => s + l.shares, 0);
      const totalCost = lots.reduce((s, l) => s + l.totalCost, 0);
      const avgCost = totalCost / totalShares;
      const lastPrice = getPrice(ticker);
      const currentValue = totalShares * lastPrice;
      const gainLoss = currentValue - totalCost;
      const gainPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
      return { ticker, lots, totalShares, totalCost, avgCost, lastPrice, currentValue, gainLoss, gainPct };
    });
  }, [positions]);

  if (grouped.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "#334155" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>◎</div>
        <div style={{ fontFamily: "monospace", fontSize: 14 }}>NO POSITIONS — ADD ONE ABOVE</div>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.tableHeader}>
        {["TICKER", "LAST PRICE", "SHARES", "AVG COST", "COST BASIS", "CURR VALUE", "GAIN/LOSS"].map((h) => (
          <div key={h} style={styles.th}>{h}</div>
        ))}
      </div>
      {grouped.map((row) => (
        <div key={row.ticker} style={styles.tickerGroup}>
          <div style={styles.tableRow} onClick={() => toggle(row.ticker)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "#475569", fontSize: 11 }}>
                {expanded[row.ticker] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span style={styles.tickerBadge}>{row.ticker}</span>
              <span style={{ fontSize: 10, color: "#475569", background: "#1e293b", padding: "2px 6px", borderRadius: 3 }}>
                {row.lots[0]?.type}
              </span>
            </div>
            <div style={styles.td}>{fmtDollar(row.lastPrice)}</div>
            <div style={styles.td}>{fmt(row.totalShares, 4)}</div>
            <div style={styles.td}>{fmtDollar(row.avgCost)}</div>
            <div style={styles.td}>{fmtDollar(row.totalCost)}</div>
            <div style={styles.td}>{fmtDollar(row.currentValue)}</div>
            <div style={{ ...styles.td, color: row.gainLoss >= 0 ? "#00ff88" : "#ff6b35" }}>
              {fmtDollar(row.gainLoss)}
              <span style={{ fontSize: 11, marginLeft: 4 }}>{fmtPct(row.gainPct)}</span>
            </div>
          </div>
          {expanded[row.ticker] && (
            <div style={styles.lotContainer}>
              <div style={styles.lotHeader}>
                {["DATE", "BROKER", "OWNER", "SHARES", "COST/SHARE", "TOTAL COST", "TERM", ""].map((h) => (
                  <div key={h} style={{ ...styles.th, fontSize: 10 }}>{h}</div>
                ))}
              </div>
              {row.lots.map((lot) => {
                const lt = isLongTerm(lot.purchaseDate);
                return (
                  <div key={lot.id} style={styles.lotRow2}>
                    <div style={styles.tdSm}>{lot.purchaseDate}</div>
                    <div style={styles.tdSm}>{lot.brokerage}</div>
                    <div style={styles.tdSm}>{lot.owner}</div>
                    <div style={styles.tdSm}>{fmt(lot.shares, 4)}</div>
                    <div style={styles.tdSm}>{fmtDollar(lot.costPerShare)}</div>
                    <div style={styles.tdSm}>{fmtDollar(lot.totalCost)}</div>
                    <div style={{ ...styles.tdSm, color: lt ? "#00ff88" : "#ffd700", fontWeight: 600 }}>
                      {lt ? "LONG" : "SHORT"}
                    </div>
                    <div style={styles.tdSm}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingLot(lot); }}
                        style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }}
                        title="Edit position"
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {editingLot && (
        <EditPositionModal
          lot={editingLot}
          users={users}
          onSave={(updated) => { onEdit(updated); setEditingLot(null); }}
          onClose={() => setEditingLot(null)}
        />
      )}
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────
function DashboardTab({ positions, users }) {
  const grouped = useMemo(() => {
    const map = {};
    positions.forEach((p) => {
      if (!map[p.ticker]) map[p.ticker] = { shares: 0, cost: 0 };
      map[p.ticker].shares += p.shares;
      map[p.ticker].cost += p.totalCost;
    });
    return map;
  }, [positions]);

  const totalValue = useMemo(() =>
    Object.entries(grouped).reduce((s, [t, v]) => s + v.shares * getPrice(t), 0),
    [grouped]
  );

  const totalCost = useMemo(() =>
    positions.reduce((s, p) => s + p.totalCost, 0),
    [positions]
  );

  const byOwner = useMemo(() => {
    const map = {};
    positions.forEach((p) => {
      const val = p.shares * getPrice(p.ticker);
      map[p.owner] = (map[p.owner] || 0) + val;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));
  }, [positions]);

  const byTicker = useMemo(() =>
    Object.entries(grouped).map(([ticker, v]) => ({
      name: ticker, value: parseFloat((v.shares * getPrice(ticker)).toFixed(2))
    })).sort((a, b) => b.value - a.value),
    [grouped]
  );

  const byType = useMemo(() => {
    const map = {};
    positions.forEach((p) => {
      map[p.type] = (map[p.type] || 0) + p.shares * getPrice(p.ticker);
    });
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));
  }, [positions]);

  const byTerm = useMemo(() => {
    const map = { "Long Term": 0, "Short Term": 0 };
    positions.forEach((p) => {
      const key = isLongTerm(p.purchaseDate) ? "Long Term" : "Short Term";
      map[key] += p.shares * getPrice(p.ticker);
    });
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));
  }, [positions]);

  if (positions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "#334155" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
        <div style={{ fontFamily: "monospace", fontSize: 14 }}>ADD POSITIONS TO SEE CHARTS</div>
      </div>
    );
  }

  const overallGL = totalValue - totalCost;

  return (
    <div>
      <div style={styles.kpiStrip}>
        <KPI label="TOTAL VALUE" value={fmtDollar(totalValue)} icon={<DollarSign size={14} />} />
        <KPI label="TOTAL COST" value={fmtDollar(totalCost)} icon={<DollarSign size={14} />} />
        <KPI label="TOTAL GAIN/LOSS" value={fmtDollar(overallGL)}
          accent={overallGL >= 0 ? "#00ff88" : "#ff6b35"}
          icon={overallGL >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} />
        <KPI label="INVESTORS" value={users.length} icon={<Users size={14} />} />
      </div>
      <div style={styles.chartsGrid}>
        <ChartCard title="PORTFOLIO BY INVESTOR" data={byOwner} />
        <ChartCard title="HOLDINGS BREAKDOWN" data={byTicker} />
        <ChartCard title="STOCK vs ETF vs ESPP" data={byType} />
        <ChartCard title="LONG TERM vs SHORT TERM" data={byTerm} />
      </div>
    </div>
  );
}

function KPI({ label, value, accent = "#00c4ff", icon }) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#475569", marginBottom: 8 }}>
        <span style={{ color: accent }}>{icon}</span>
        <span style={styles.label}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontFamily: "monospace", color: accent, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: "8px 14px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
      <div style={{ color: "#94a3b8" }}>{name}</div>
      <div style={{ color: "#00ff88" }}>{fmtDollar(value)}</div>
    </div>
  );
};

function ChartCard({ title, data }) {
  return (
    <div style={styles.chartCard}>
      <div style={styles.chartTitle}>{title}</div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
            paddingAngle={2} dataKey="value" stroke="none">
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(val) => <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>{val}</span>}
            iconType="circle" iconSize={8}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  // Auth state: "loading" | "unauthenticated" | "authenticated"
  const [authState, setAuthState] = useState("loading");
  const [authUser, setAuthUser] = useState(null); // { username: string }

  // Portfolio state
  const [users, setUsers] = useState(null);        // null = onboarding not done yet
  const [positions, setPositions] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const settingsMenuRef = useRef();
  const fileInputRef = useRef();

  // ── Save portfolio to server ─────────────────────────────────────────────────
  // Debounced: fires 1.5 s after the last change so rapid mutations batch together.
  const saveTimerRef = useRef(null);
  const schedulePortfolioSave = useCallback((investorNames, nextPositions) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      apiFetch("/api/portfolio", {
        method: "PUT",
        body: JSON.stringify({ investorNames, positions: nextPositions }),
      }).catch((err) => console.warn("[portfolio save]", err.message));
    }, 1500);
  }, []);

  // ── Check existing session on mount ─────────────────────────────────────────
  useEffect(() => {
    async function checkSession() {
      try {
        const me = await apiFetch("/api/auth/me");
        setAuthUser(me);

        const portfolio = await apiFetch("/api/portfolio");
        if (portfolio.investorNames?.length > 0) setUsers(portfolio.investorNames);
        setPositions(portfolio.positions || []);
        setAuthState("authenticated");
      } catch {
        setAuthState("unauthenticated");
      }
    }
    checkSession();
  }, []);

  // Close the settings dropdown when clicking outside it
  useEffect(() => {
    const handler = (e) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Auth callbacks ───────────────────────────────────────────────────────────
  const handleLogin = useCallback(async (username) => {
    // Existing user — load their saved portfolio
    try {
      const portfolio = await apiFetch("/api/portfolio");
      if (portfolio.investorNames?.length > 0) setUsers(portfolio.investorNames);
      setPositions(portfolio.positions || []);
    } catch {
      /* portfolio stays empty; user can add positions */
    }
    setAuthUser({ username });
    setAuthState("authenticated");
  }, []);

  const handleRegister = useCallback((username) => {
    // New user — send them through onboarding to set up investor names
    setAuthUser({ username });
    setUsers(null); // null triggers the OnboardingModal
    setPositions([]);
    setAuthState("authenticated");
  }, []);

  const handleLogout = useCallback(async () => {
    clearTimeout(saveTimerRef.current);
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAuthUser(null);
    setUsers(null);
    setPositions([]);
    setActiveTab(0);
    setAuthState("unauthenticated");
  }, []);

  // ── Onboarding done — investor names set for the first time ─────────────────
  const handleOnboardingDone = useCallback((names) => {
    setUsers(names);
    schedulePortfolioSave(names, []);
  }, [schedulePortfolioSave]);

  // ── Position mutations ───────────────────────────────────────────────────────
  const handleAddPosition = useCallback((pos) => {
    setPositions((prev) => {
      const next = [...prev, pos];
      schedulePortfolioSave(users, next);
      return next;
    });
  }, [users, schedulePortfolioSave]);

  const handleEditPosition = useCallback((updated) => {
    setPositions((prev) => {
      const next = prev.map((p) => p.id === updated.id ? updated : p);
      schedulePortfolioSave(users, next);
      return next;
    });
  }, [users, schedulePortfolioSave]);

  const handleSell = useCallback((ticker, lotShares, _sellDate) => {
    setPositions((prev) => {
      const next = prev.map((p) => {
        const sellQty = parseFloat(lotShares[p.id] || 0);
        if (!sellQty || p.ticker !== ticker) return p;
        const newShares = Math.max(0, p.shares - sellQty);
        return { ...p, shares: newShares, totalCost: newShares * p.costPerShare };
      }).filter((p) => p.shares > 0);
      schedulePortfolioSave(users, next);
      return next;
    });
  }, [users, schedulePortfolioSave]);

  // ── CSV bulk import ──────────────────────────────────────────────────────────
  const handleCsvImport = useCallback((newPositions) => {
    setPositions((prev) => {
      const next = [...prev, ...newPositions];
      schedulePortfolioSave(users, next);
      return next;
    });
  }, [users, schedulePortfolioSave]);

  const handleDownloadTemplate = () => {
    const ownerList = users.join(" / ");
    const rows = [
      "# Portfolio Import Template",
      `# Owner options : ${ownerList}`,
      `# Type options  : Stock / ETF / ESPP`,
      `# Brokerage     : ${BROKERAGES.join(" / ")}`,
      "# Lines starting with # are ignored",
      "Ticker,Shares,Cost Per Share,Brokerage,Owner,Type,Purchase Date",
      `AAPL,10,150.00,Fidelity,${users[0]},Stock,2024-01-15`,
      `SPY,5,420.00,Schwab,${users[0]},ETF,2023-06-01`,
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "portfolio_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── JSON import / export (unchanged) ────────────────────────────────────────
  const handleExport = () => {
    const data = JSON.stringify({ users, positions }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "portfolio.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { users: u, positions: p } = JSON.parse(ev.target.result);
        setUsers(u);
        setPositions(p);
        schedulePortfolioSave(u, p);
      } catch { alert("Invalid portfolio file."); }
    };
    reader.readAsText(file);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (authState === "loading") {
    return (
      <div style={{ ...styles.app, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={styles.gridBg} />
        <div style={{ fontFamily: "monospace", color: "#334155", fontSize: 13, letterSpacing: 3 }}>
          LOADING...
        </div>
      </div>
    );
  }

  if (authState === "unauthenticated") {
    return <LoginScreen onLogin={handleLogin} onRegister={handleRegister} />;
  }

  // First-time user: show onboarding before the main UI
  if (!users) {
    return <OnboardingModal onDone={handleOnboardingDone} />;
  }

  return (
    <div style={styles.app}>
      <div style={styles.gridBg} />

      {/* Header */}
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{ ...styles.logo, cursor: "pointer" }} onClick={() => setActiveTab(0)}>◈ PORTFOLIO</span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#334155" }}>
            {users.join(" · ")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />

          {positions.length > 0 && (
            <button style={{ ...styles.btnSecondary, borderColor: "#ff6b35", color: "#ff6b35" }} onClick={() => setShowSell(true)}>
              <Trash2 size={13} /> SELL
            </button>
          )}
          <button style={styles.btnPrimary} onClick={() => setShowAdd(true)}>
            <Plus size={13} /> ADD POSITION
          </button>

          {/* ── User area: username · gear · logout ── */}
          <div style={styles.divider} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#475569" }}>
              {authUser?.username}
            </span>

            {/* Gear settings dropdown */}
            <div ref={settingsMenuRef} style={{ position: "relative" }}>
              <button
                title="Settings"
                onClick={() => setShowSettingsMenu((v) => !v)}
                style={{ ...styles.btnSecondary, borderColor: showSettingsMenu ? "#475569" : "#334155", color: showSettingsMenu ? "#94a3b8" : "#64748b", padding: "8px 10px" }}
              >
                <Settings size={13} />
              </button>

              {showSettingsMenu && (
                <div style={styles.settingsDropdown}>
                  <button style={styles.dropdownItem} onClick={() => { fileInputRef.current.click(); setShowSettingsMenu(false); }}>
                    <Upload size={12} /> IMPORT JSON
                  </button>
                  <button style={styles.dropdownItem} onClick={() => { handleExport(); setShowSettingsMenu(false); }}>
                    <Download size={12} /> EXPORT JSON
                  </button>
                </div>
              )}
            </div>

            <button
              title="Sign out"
              onClick={handleLogout}
              style={{ ...styles.btnSecondary, borderColor: "#334155", color: "#64748b", padding: "8px 10px" }}
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div style={styles.tabBar}>
        {["DASHBOARD", "POSITIONS"].map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            style={{ ...styles.tab, ...(activeTab === i ? styles.tabActive : {}) }}>
            {tab}
            {i === 1 && positions.length > 0 && (
              <span style={styles.tabBadge}>{[...new Set(positions.map(p => p.ticker))].length}</span>
            )}
          </button>
        ))}
        <div style={styles.tabLine} />
      </div>

      {/* Content */}
      <main style={styles.main}>
        {activeTab === 0 && <DashboardTab positions={positions} users={users} />}
        {activeTab === 1 && <PositionsTab positions={positions} users={users} onEdit={handleEditPosition} />}
      </main>

      {/* Modals */}
      {showAdd && <AddPositionModal users={users} onAdd={handleAddPosition} onClose={() => setShowAdd(false)} />}
      {showSell && <SellPositionModal positions={positions} onSell={handleSell} onClose={() => setShowSell(false)} />}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
  app: {
    minHeight: "100vh", background: "#060b12", color: "#e2e8f0",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif", position: "relative",
    overflowX: "hidden",
  },
  gridBg: {
    position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
    backgroundImage: "linear-gradient(rgba(0,255,136,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.03) 1px, transparent 1px)",
    backgroundSize: "40px 40px",
  },
  header: {
    position: "relative", zIndex: 10, display: "flex", alignItems: "center",
    justifyContent: "space-between", padding: "16px 28px",
    borderBottom: "1px solid #0f1e2e", background: "rgba(6,11,18,0.95)",
    backdropFilter: "blur(10px)",
  },
  logo: {
    fontFamily: "monospace", fontSize: 18, fontWeight: 700, letterSpacing: 3,
    color: "#00ff88",
  },
  divider: {
    width: 1, height: 24, background: "#1e293b", margin: "0 4px",
  },
  settingsDropdown: {
    position: "absolute", top: "calc(100% + 6px)", right: 0,
    background: "#0a1628", border: "1px solid #1e293b", borderRadius: 8,
    padding: "4px", zIndex: 200, minWidth: 160,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  dropdownItem: {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "8px 12px", background: "none", border: "none", borderRadius: 6,
    color: "#64748b", fontFamily: "monospace", fontSize: 11, letterSpacing: 1,
    cursor: "pointer", textAlign: "left",
  },
  tabBar: {
    position: "relative", zIndex: 10, display: "flex", alignItems: "center",
    gap: 0, padding: "0 28px", borderBottom: "1px solid #0f1e2e",
    background: "rgba(6,11,18,0.9)",
  },
  tab: {
    padding: "14px 20px", background: "none", border: "none", cursor: "pointer",
    fontFamily: "monospace", fontSize: 12, letterSpacing: 2, color: "#334155",
    display: "flex", alignItems: "center", gap: 8, position: "relative",
    transition: "color 0.2s",
  },
  tabActive: {
    color: "#00ff88",
    boxShadow: "inset 0 -2px 0 #00ff88",
  },
  tabLine: { flex: 1 },
  tabBadge: {
    background: "#00ff8822", color: "#00ff88", fontSize: 10, padding: "1px 6px",
    borderRadius: 10, fontFamily: "monospace",
  },
  main: { position: "relative", zIndex: 10, padding: "28px" },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 100,
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  modal: {
    background: "#0a1628", border: "1px solid #1e293b", borderRadius: 12,
    padding: 28, width: 400, boxShadow: "0 0 60px rgba(0,255,136,0.05)",
  },
  modalHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontFamily: "monospace", fontSize: 14, letterSpacing: 3, color: "#00ff88" },
  modalSub: { color: "#64748b", fontSize: 14, marginBottom: 16 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: 20 },
  fieldFull: { gridColumn: "1 / -1" },
  label: { display: "block", fontFamily: "monospace", fontSize: 10, letterSpacing: 2, color: "#475569", marginBottom: 4 },
  input: {
    width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6,
    padding: "8px 10px", color: "#e2e8f0", fontSize: 13, fontFamily: "monospace",
    outline: "none", boxSizing: "border-box", marginBottom: 0,
    transition: "border-color 0.2s",
  },
  inputPrefix: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#475569", fontSize: 13, fontFamily: "monospace" },
  select: {
    width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6,
    padding: "8px 10px", color: "#e2e8f0", fontSize: 13, fontFamily: "monospace",
    outline: "none", cursor: "pointer", marginTop: 4,
  },
  pill: {
    padding: "6px 14px", borderRadius: 20, border: "1px solid #1e293b",
    background: "none", color: "#475569", fontFamily: "monospace", fontSize: 11,
    cursor: "pointer", letterSpacing: 1,
  },
  pillActive: { borderColor: "#00ff88", color: "#00ff88", background: "#00ff8811" },
  btnPrimary: {
    display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
    width: "100%", padding: "11px 20px", background: "#00ff8818",
    border: "1px solid #00ff88", borderRadius: 8, color: "#00ff88",
    fontFamily: "monospace", fontSize: 12, letterSpacing: 2, cursor: "pointer",
    marginTop: 8, transition: "background 0.2s",
  },
  btnSecondary: {
    display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
    background: "none", border: "1px solid #1e293b", borderRadius: 8,
    color: "#64748b", fontFamily: "monospace", fontSize: 11, letterSpacing: 1,
    cursor: "pointer", transition: "border-color 0.2s, color 0.2s",
  },
  iconBtn: {
    background: "none", border: "none", color: "#475569", cursor: "pointer", padding: 4,
  },
  kpiStrip: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 },
  kpiCard: {
    background: "#0a1628", border: "1px solid #0f1e2e", borderRadius: 10,
    padding: "18px 20px",
  },
  chartsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 },
  chartCard: {
    background: "#0a1628", border: "1px solid #0f1e2e", borderRadius: 10,
    padding: "20px 16px",
  },
  chartTitle: { fontFamily: "monospace", fontSize: 11, letterSpacing: 2, color: "#475569", marginBottom: 12 },
  tableHeader: {
    display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1.2fr 1.4fr",
    padding: "10px 16px", marginBottom: 4,
  },
  th: { fontFamily: "monospace", fontSize: 10, letterSpacing: 1.5, color: "#334155" },
  tickerGroup: { marginBottom: 4 },
  tableRow: {
    display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1.2fr 1.4fr",
    padding: "14px 16px", background: "#0a1628", border: "1px solid #0f1e2e",
    borderRadius: 8, alignItems: "center", cursor: "pointer",
    transition: "border-color 0.2s",
  },
  td: { fontFamily: "monospace", fontSize: 13, color: "#94a3b8" },
  tickerBadge: {
    fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#e2e8f0",
    letterSpacing: 1,
  },
  lotContainer: {
    background: "#060b12", border: "1px solid #0f1e2e", borderTop: "none",
    borderRadius: "0 0 8px 8px", padding: "8px 16px 12px",
    marginTop: -4,
  },
  lotHeader: {
    display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr 0.7fr 0.4fr",
    padding: "6px 0 8px", borderBottom: "1px solid #0f1e2e", marginBottom: 6,
  },
  lotRow: {
    display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
    borderBottom: "1px solid #0f1e2e",
  },
  lotRow2: {
    display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr 0.7fr 0.4fr",
    padding: "7px 0", alignItems: "center",
  },
  tdSm: { fontFamily: "monospace", fontSize: 12, color: "#64748b" },
};
