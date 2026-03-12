import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Plus, Trash2, ChevronDown, ChevronRight, Download, Upload, X, TrendingUp, TrendingDown, DollarSign, Users, LogOut, Lock, Pencil, FileSpreadsheet, Settings } from "lucide-react";

// prices are fetched live from /api/prices — see App component

const BROKERAGES       = ["Robinhood", "eTrade", "Fidelity", "Schwab", "Vanguard"];
const CRYPTO_EXCHANGES = ["Coinbase", "Kraken", "Binance", "Gemini", "Robinhood", "Fidelity"];
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
function PositionsTab({ positions, users, onEdit, prices }) {
  const getPrice = (ticker) => prices[ticker] ?? 0;
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
    }).sort((a, b) => b.currentValue - a.currentValue);
  }, [positions, prices]);

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
            <div style={{ ...styles.td, color: row.gainLoss >= 0 ? "#00ff88" : "#ff6b35", display: "flex", alignItems: "baseline", gap: 6 }}>
              <span>{fmtDollar(row.gainLoss)}</span>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{fmtPct(row.gainPct)}</span>
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
function DashboardTab({ positions, users, prices, snapshots }) {
  const getPrice = (ticker) => prices[ticker] ?? 0;
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

  const byTicker = useMemo(() => {
    const sorted = Object.entries(grouped)
      .map(([ticker, v]) => ({ name: ticker, value: parseFloat((v.shares * getPrice(ticker)).toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length <= 10) return sorted;
    const othersValue = sorted.slice(10).reduce((s, d) => s + d.value, 0);
    return [...sorted.slice(0, 10), { name: "Others", value: parseFloat(othersValue.toFixed(2)) }];
  }, [grouped]);

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
          subValue={fmtPct(totalCost > 0 ? (overallGL / totalCost) * 100 : 0)}
          accent={overallGL >= 0 ? "#00ff88" : "#ff6b35"}
          icon={overallGL >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} />
        <KPI label="INVESTORS" value={users.length} icon={<Users size={14} />} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <PortfolioGrowthChart snapshots={snapshots} />
      </div>
      <div style={styles.chartsGrid}>
        <ChartCard title="PORTFOLIO BY INVESTOR" data={byOwner} />
        <ChartCard title="HOLDINGS BREAKDOWN" data={byTicker} hideLegend={["Others"]} />
        <ChartCard title="STOCK vs ETF vs ESPP" data={byType} />
        <ChartCard title="LONG TERM vs SHORT TERM" data={byTerm} />
      </div>
    </div>
  );
}

function KPI({ label, value, subValue, accent = "#00c4ff", icon }) {
  return (
    <div style={styles.kpiCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#475569", marginBottom: 8 }}>
        <span style={{ color: accent }}>{icon}</span>
        <span style={styles.label}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 22, fontFamily: "monospace", color: accent, fontWeight: 700 }}>{value}</div>
        {subValue && <div style={{ fontSize: 12, fontFamily: "monospace", color: accent, opacity: 0.7 }}>{subValue}</div>}
      </div>
    </div>
  );
}

const makeTooltip = (data) => ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  const total = data.reduce((s, d) => s + d.value, 0);
  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: "8px 14px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
      <div style={{ color: "#94a3b8", marginBottom: 4 }}>{name}</div>
      <div style={{ color: "#00ff88" }}>{fmtDollar(value)}</div>
      <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{pct}% of total</div>
    </div>
  );
};

function ChartCard({ title, data, hideLegend = [] }) {
  const legendContent = hideLegend.length > 0
    ? ({ payload }) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", justifyContent: "center", paddingTop: 8 }}>
          {(payload || [])
            .filter((p) => !hideLegend.includes(p.value))
            .map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>{p.value}</span>
              </div>
            ))}
        </div>
      )
    : undefined;

  return (
    <div style={styles.chartCard}>
      <div style={styles.chartTitle}>{title}</div>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={90}
            paddingAngle={2} dataKey="value" stroke="none">
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip content={makeTooltip(data)} />
          <Legend
            content={legendContent}
            formatter={legendContent ? undefined : (val) => <span style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>{val}</span>}
            iconType="circle" iconSize={8}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Portfolio Growth Chart ────────────────────────────────────────────────────
const fmtShort = (v) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const GROWTH_RANGES = [
  { label: "1W",  days: 7 },
  { label: "1M",  days: 30 },
  { label: "1Y",  days: 365 },
  { label: "ALL", days: null },
];

function PortfolioGrowthChart({ snapshots }) {
  const [range, setRange] = useState("1M");

  const allData = useMemo(() =>
    [...(snapshots || [])].sort((a, b) => a.date.localeCompare(b.date)),
    [snapshots]
  );

  const data = useMemo(() => {
    const selected = GROWTH_RANGES.find((r) => r.label === range);
    if (!selected?.days) return allData;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - selected.days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return allData.filter((s) => s.date >= cutoffStr);
  }, [allData, range]);

  const rangeGrowth = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0].value;
    const last = data[data.length - 1].value;
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [data]);

  const tickFmt = (d) => (range === "1Y" || range === "ALL") ? d.slice(0, 7) : d.slice(5);

  const placeholder = (msg) => (
    <div style={styles.chartCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={styles.chartTitle}>PORTFOLIO GROWTH</div>
        <RangeSelector range={range} setRange={setRange} />
      </div>
      <div style={{ textAlign: "center", padding: "60px 0", color: "#334155", fontFamily: "monospace", fontSize: 11 }}>{msg}</div>
    </div>
  );

  if (!snapshots) return placeholder("LOADING...");
  if (allData.length === 0) return placeholder("NO DATA YET — VISIT DAILY TO BUILD HISTORY");
  if (data.length === 0) return placeholder(`NO DATA IN THIS RANGE — TRY A LONGER PERIOD`);
  if (data.length === 1) return placeholder(`${data[0].date} · ${fmtDollar(data[0].value)} — NEED ≥ 2 DATA POINTS`);

  return (
    <div style={styles.chartCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div style={styles.chartTitle}>PORTFOLIO GROWTH</div>
          {rangeGrowth !== null && (
            <span style={{ fontFamily: "monospace", fontSize: 11, color: rangeGrowth >= 0 ? "#00ff88" : "#ff6b35" }}>
              {rangeGrowth >= 0 ? "+" : ""}{fmt(rangeGrowth, 1)}%
            </span>
          )}
        </div>
        <RangeSelector range={range} setRange={setRange} />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0f1e2e" />
          <XAxis
            dataKey="date"
            tickFormatter={tickFmt}
            interval="preserveStartEnd"
            tick={{ fontFamily: "monospace", fontSize: 9, fill: "#334155" }}
            axisLine={{ stroke: "#1e293b" }} tickLine={false}
          />
          <YAxis
            tickFormatter={fmtShort}
            tick={{ fontFamily: "monospace", fontSize: 9, fill: "#334155" }}
            axisLine={false} tickLine={false} width={54}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const { date, value } = payload[0].payload;
              const idx = data.findIndex((d) => d.date === date);
              const prev = idx > 0 ? data[idx - 1] : null;
              const chg = prev ? ((value - prev.value) / prev.value) * 100 : null;
              return (
                <div style={{ background: "#0f172a", border: "1px solid #1e293b", padding: "8px 14px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
                  <div style={{ color: "#94a3b8", marginBottom: 4 }}>{date}</div>
                  <div style={{ color: "#00ff88" }}>{fmtDollar(value)}</div>
                  {chg !== null && (
                    <div style={{ fontSize: 11, color: chg >= 0 ? "#00ff88" : "#ff6b35", marginTop: 2 }}>
                      {chg >= 0 ? "+" : ""}{fmt(chg, 1)}% prev day
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Line
            type="monotone" dataKey="value" stroke="#00ff88" strokeWidth={2}
            dot={data.length <= 30 ? { fill: "#00ff88", r: 3, strokeWidth: 0 } : false}
            activeDot={{ r: 5, fill: "#00ff88", stroke: "#060b12", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RangeSelector({ range, setRange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {GROWTH_RANGES.map(({ label }) => (
        <button
          key={label}
          onClick={() => setRange(label)}
          style={{
            padding: "3px 10px", border: "1px solid",
            borderColor: range === label ? "#00ff88" : "#1e293b",
            borderRadius: 4, background: range === label ? "#00ff8818" : "none",
            color: range === label ? "#00ff88" : "#475569",
            fontFamily: "monospace", fontSize: 10, letterSpacing: 1, cursor: "pointer",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Add Activity Modal ────────────────────────────────────────────────────────
function AddActivityModal({ users, onAdd, onClose }) {
  const [form, setForm] = useState({
    action: "BUY",
    ticker: "",
    shares: "",
    price: "",
    date: new Date().toISOString().slice(0, 10),
    brokerage: BROKERAGES[0],
    owner: users[0],
    notes: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const total = (parseFloat(form.shares) || 0) * (parseFloat(form.price) || 0);

  const handleSubmit = () => {
    if (!form.ticker || !form.shares || !form.price) return;
    onAdd({
      id: uid(),
      action: form.action,
      ticker: form.ticker.toUpperCase(),
      shares: parseFloat(form.shares),
      price: parseFloat(form.price),
      date: form.date,
      brokerage: form.brokerage,
      owner: form.owner,
      notes: form.notes,
    });
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 500 }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#ffd700" }}>LOG ACTIVITY</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>

        {/* BUY / SELL toggle */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, background: "#060b12", borderRadius: 8, padding: 3, border: "1px solid #1e293b" }}>
          {["BUY", "SELL"].map((a) => (
            <button key={a} onClick={() => set("action", a)} style={{
              flex: 1, padding: "8px 0", border: "none", cursor: "pointer",
              fontFamily: "monospace", fontSize: 12, letterSpacing: 2, borderRadius: 6, transition: "all 0.2s",
              background: form.action === a ? "#0a1628" : "transparent",
              color: form.action === a ? (a === "BUY" ? "#00ff88" : "#ff6b35") : "#334155",
              boxShadow: form.action === a ? "0 0 0 1px #1e293b" : "none",
            }}>{a}</button>
          ))}
        </div>

        <div style={styles.formGrid}>
          <FormField label="TICKER" value={form.ticker} onChange={(v) => set("ticker", v.toUpperCase())} placeholder="e.g. AAPL" />
          <FormField label="DATE" value={form.date} onChange={(v) => set("date", v)} type="date" />
          <FormField label="SHARES" value={form.shares} onChange={(v) => set("shares", v)} type="number" placeholder="0" />
          <FormField label="PRICE / SHARE" value={form.price} onChange={(v) => set("price", v)} type="number" placeholder="0.00" prefix="$" />
          <div style={styles.fieldFull}>
            <span style={styles.label}>TOTAL VALUE</span>
            <div style={{ ...styles.input, background: "#0d1117", color: "#ffd700", cursor: "default" }}>{fmtDollar(total)}</div>
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
          <div style={styles.fieldFull}>
            <span style={styles.label}>NOTES (optional)</span>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="e.g. Dividend reinvestment, earnings play..." style={styles.input} />
          </div>
        </div>

        <button
          style={{ ...styles.btnPrimary, borderColor: "#ffd700", color: "#ffd700", background: "#ffd70018" }}
          onClick={handleSubmit}
        >
          LOG {form.action} →
        </button>
      </div>
    </div>
  );
}

// ── Activity Tab ──────────────────────────────────────────────────────────────
function ActivityTab({ activities, onDelete }) {
  if (activities.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "#334155" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>◎</div>
        <div style={{ fontFamily: "monospace", fontSize: 14 }}>NO ACTIVITY — LOG ONE ABOVE</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr 1fr 1fr 1fr 1.2fr 1fr 1fr 1.5fr 0.4fr", padding: "10px 16px", marginBottom: 4 }}>
        {["DATE", "ACTION", "TICKER", "SHARES", "PRICE", "TOTAL", "BROKERAGE", "OWNER", "NOTES", ""].map((h) => (
          <div key={h} style={styles.th}>{h}</div>
        ))}
      </div>
      {activities.map((a) => {
        const isBuy = a.action === "BUY";
        const total = a.shares * a.price;
        return (
          <div key={a.id} style={{
            display: "grid", gridTemplateColumns: "1fr 0.7fr 1fr 1fr 1fr 1.2fr 1fr 1fr 1.5fr 0.4fr",
            padding: "12px 16px", background: "#0a1628", border: "1px solid #0f1e2e",
            borderRadius: 8, marginBottom: 4, alignItems: "center",
          }}>
            <div style={styles.tdSm}>{a.date}</div>
            <div>
              <span style={{
                fontFamily: "monospace", fontSize: 11, fontWeight: 700, letterSpacing: 1,
                color: isBuy ? "#00ff88" : "#ff6b35",
                background: isBuy ? "#00ff8815" : "#ff6b3515",
                border: `1px solid ${isBuy ? "#00ff8830" : "#ff6b3530"}`,
                padding: "2px 8px", borderRadius: 4,
              }}>{a.action}</span>
            </div>
            <div style={{ ...styles.tickerBadge, fontSize: 13 }}>{a.ticker}</div>
            <div style={styles.tdSm}>{fmt(a.shares, 4)}</div>
            <div style={styles.tdSm}>{fmtDollar(a.price)}</div>
            <div style={{ ...styles.tdSm, color: isBuy ? "#00ff88" : "#ff6b35" }}>{fmtDollar(total)}</div>
            <div style={styles.tdSm}>{a.brokerage || "—"}</div>
            <div style={styles.tdSm}>{a.owner || "—"}</div>
            <div style={{ ...styles.tdSm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.notes}>
              {a.notes || <span style={{ color: "#1e293b" }}>—</span>}
            </div>
            <div>
              <button onClick={() => onDelete(a.id)}
                style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }}
                title="Delete">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Stocks Tab (wrapper with POSITIONS / ACTIVITY sub-tabs) ───────────────────
function StocksTab({ stocksSubTab, onSubTab, positions, activities, users, onEdit, prices, onDeleteActivity }) {
  const activityCount = activities.length;
  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid #0f1e2e" }}>
        {[
          { key: "POSITIONS", badge: [...new Set(positions.map((p) => p.ticker))].length || null },
          { key: "ACTIVITY",  badge: activityCount || null },
        ].map(({ key, badge }) => (
          <button key={key} onClick={() => onSubTab(key)} style={{
            padding: "10px 18px", background: "none", border: "none", cursor: "pointer",
            fontFamily: "monospace", fontSize: 11, letterSpacing: 2,
            color: stocksSubTab === key ? "#e2e8f0" : "#334155",
            borderBottom: `2px solid ${stocksSubTab === key ? "#00ff88" : "transparent"}`,
            marginBottom: -1, display: "flex", alignItems: "center", gap: 8,
            transition: "color 0.2s",
          }}>
            {key}
            {badge != null && badge > 0 && (
              <span style={styles.tabBadge}>{badge}</span>
            )}
          </button>
        ))}
      </div>

      {stocksSubTab === "POSITIONS" && (
        <PositionsTab positions={positions} users={users} onEdit={onEdit} prices={prices} />
      )}
      {stocksSubTab === "ACTIVITY" && (
        <ActivityTab activities={activities} onDelete={onDeleteActivity} />
      )}
    </div>
  );
}

// ── Crypto Modal ──────────────────────────────────────────────────────────────
function CryptoModal({ users, onAdd, onClose, editItem = null }) {
  const [form, setForm] = useState({
    coin: editItem?.coin ?? "",
    ticker: editItem?.ticker ?? "",
    exchange: editItem?.exchange ?? CRYPTO_EXCHANGES[0],
    owner: editItem?.owner ?? users[0],
    amount: editItem?.amount ? String(editItem.amount) : "",
    costPerCoin: editItem?.costPerCoin ? String(editItem.costPerCoin) : "",
    purchaseDate: editItem?.purchaseDate ?? new Date().toISOString().slice(0, 10),
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const totalCost = (parseFloat(form.amount) || 0) * (parseFloat(form.costPerCoin) || 0);

  const handleSubmit = () => {
    if (!form.ticker || !form.amount || !form.costPerCoin) return;
    onAdd({
      ...(editItem || {}),
      id: editItem?.id ?? uid(),
      coin: form.coin || form.ticker.toUpperCase(),
      ticker: form.ticker.toUpperCase(),
      exchange: form.exchange,
      owner: form.owner,
      amount: parseFloat(form.amount),
      costPerCoin: parseFloat(form.costPerCoin),
      totalCost,
      purchaseDate: form.purchaseDate,
    });
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 480 }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#c084fc" }}>{editItem ? "EDIT CRYPTO" : "ADD CRYPTO"}</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>
        <div style={styles.formGrid}>
          <FormField label="TICKER (e.g. BTC)" value={form.ticker} onChange={(v) => set("ticker", v.toUpperCase())} placeholder="BTC" />
          <FormField label="COIN NAME (optional)" value={form.coin} onChange={(v) => set("coin", v)} placeholder="Bitcoin" />
          <FormField label="AMOUNT (units)" value={form.amount} onChange={(v) => set("amount", v)} type="number" placeholder="0.00" />
          <FormField label="COST / COIN" value={form.costPerCoin} onChange={(v) => set("costPerCoin", v)} type="number" placeholder="0.00" prefix="$" />
          <div style={styles.fieldFull}>
            <span style={styles.label}>TOTAL COST BASIS</span>
            <div style={{ ...styles.input, background: "#0d1117", color: "#c084fc", cursor: "default" }}>{fmtDollar(totalCost)}</div>
          </div>
          <div>
            <span style={styles.label}>EXCHANGE</span>
            <select value={form.exchange} onChange={(e) => set("exchange", e.target.value)} style={styles.select}>
              {CRYPTO_EXCHANGES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <span style={styles.label}>OWNER</span>
            <select value={form.owner} onChange={(e) => set("owner", e.target.value)} style={styles.select}>
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div style={styles.fieldFull}>
            <FormField label="PURCHASE DATE" value={form.purchaseDate} onChange={(v) => set("purchaseDate", v)} type="date" />
          </div>
        </div>
        <button style={{ ...styles.btnPrimary, borderColor: "#c084fc", color: "#c084fc", background: "#c084fc18" }} onClick={handleSubmit}>
          {editItem ? "SAVE CHANGES →" : "ADD CRYPTO →"}
        </button>
      </div>
    </div>
  );
}

// ── Cash Modal ────────────────────────────────────────────────────────────────
const CASH_TYPES = ["Savings", "Checking", "Money Market", "CD", "Treasury Bill"];

function CashModal({ users, onAdd, onClose, editItem = null }) {
  const [form, setForm] = useState({
    institution: editItem?.institution ?? "",
    accountType: editItem?.accountType ?? CASH_TYPES[0],
    owner: editItem?.owner ?? users[0],
    balance: editItem?.balance ? String(editItem.balance) : "",
    apy: editItem?.apy ? String(editItem.apy) : "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.institution || !form.balance) return;
    onAdd({
      ...(editItem || {}),
      id: editItem?.id ?? uid(),
      institution: form.institution,
      accountType: form.accountType,
      owner: form.owner,
      balance: parseFloat(form.balance),
      apy: parseFloat(form.apy) || 0,
    });
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 460 }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#34d399" }}>{editItem ? "EDIT CASH ACCOUNT" : "ADD CASH ACCOUNT"}</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.fieldFull}>
            <FormField label="INSTITUTION / BANK" value={form.institution} onChange={(v) => set("institution", v)} placeholder="e.g. Chase, Ally Bank" />
          </div>
          <div>
            <span style={styles.label}>ACCOUNT TYPE</span>
            <select value={form.accountType} onChange={(e) => set("accountType", e.target.value)} style={styles.select}>
              {CASH_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <span style={styles.label}>OWNER</span>
            <select value={form.owner} onChange={(e) => set("owner", e.target.value)} style={styles.select}>
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          <FormField label="BALANCE ($)" value={form.balance} onChange={(v) => set("balance", v)} type="number" placeholder="0.00" prefix="$" />
          <FormField label="APY (%)" value={form.apy} onChange={(v) => set("apy", v)} type="number" placeholder="0.00" />
        </div>
        <button style={{ ...styles.btnPrimary, borderColor: "#34d399", color: "#34d399", background: "#34d39918" }} onClick={handleSubmit}>
          {editItem ? "SAVE CHANGES →" : "ADD ACCOUNT →"}
        </button>
      </div>
    </div>
  );
}

// ── House Modal ───────────────────────────────────────────────────────────────
function HouseModal({ users, onAdd, onClose, editItem = null }) {
  const [form, setForm] = useState({
    name: editItem?.name ?? "",
    purchasePrice: editItem?.purchasePrice ? String(editItem.purchasePrice) : "",
    currentValue: editItem?.currentValue ? String(editItem.currentValue) : "",
    mortgageBalance: editItem?.mortgageBalance ? String(editItem.mortgageBalance) : "",
    owner: editItem?.owner ?? users[0],
    purchaseDate: editItem?.purchaseDate ?? new Date().toISOString().slice(0, 10),
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const equity = (parseFloat(form.currentValue) || 0) - (parseFloat(form.mortgageBalance) || 0);

  const handleSubmit = () => {
    if (!form.name || !form.purchasePrice) return;
    onAdd({
      ...(editItem || {}),
      id: editItem?.id ?? uid(),
      name: form.name,
      purchasePrice: parseFloat(form.purchasePrice),
      currentValue: parseFloat(form.currentValue) || parseFloat(form.purchasePrice),
      mortgageBalance: parseFloat(form.mortgageBalance) || 0,
      owner: form.owner,
      purchaseDate: form.purchaseDate,
    });
    onClose();
  };

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.modal, width: 480 }}>
        <div style={styles.modalHeader}>
          <span style={{ ...styles.modalTitle, color: "#fbbf24" }}>{editItem ? "EDIT PROPERTY" : "ADD PROPERTY"}</span>
          <button onClick={onClose} style={styles.iconBtn}><X size={16} /></button>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.fieldFull}>
            <FormField label="PROPERTY NAME / ADDRESS" value={form.name} onChange={(v) => set("name", v)} placeholder="e.g. 123 Main St, Primary Home" />
          </div>
          <FormField label="PURCHASE PRICE" value={form.purchasePrice} onChange={(v) => set("purchasePrice", v)} type="number" placeholder="0.00" prefix="$" />
          <FormField label="CURRENT VALUE (estimate)" value={form.currentValue} onChange={(v) => set("currentValue", v)} type="number" placeholder="0.00" prefix="$" />
          <FormField label="MORTGAGE BALANCE" value={form.mortgageBalance} onChange={(v) => set("mortgageBalance", v)} type="number" placeholder="0.00" prefix="$" />
          <div>
            <span style={styles.label}>NET EQUITY</span>
            <div style={{ ...styles.input, background: "#0d1117", color: equity >= 0 ? "#fbbf24" : "#ff6b35", cursor: "default" }}>{fmtDollar(equity)}</div>
          </div>
          <FormField label="PURCHASE DATE" value={form.purchaseDate} onChange={(v) => set("purchaseDate", v)} type="date" />
          <div>
            <span style={styles.label}>OWNER</span>
            <select value={form.owner} onChange={(e) => set("owner", e.target.value)} style={styles.select}>
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <button style={{ ...styles.btnPrimary, borderColor: "#fbbf24", color: "#fbbf24", background: "#fbbf2418" }} onClick={handleSubmit}>
          {editItem ? "SAVE CHANGES →" : "ADD PROPERTY →"}
        </button>
      </div>
    </div>
  );
}

// ── Crypto Tab ────────────────────────────────────────────────────────────────
function CryptoTab({ crypto, users, onEdit, onDelete, cryptoPrices }) {
  const getPrice = (ticker) => cryptoPrices[`${ticker}-USD`] ?? cryptoPrices[ticker] ?? 0;
  const [editingItem, setEditingItem] = useState(null);

  const rows = useMemo(() => {
    const map = {};
    crypto.forEach((c) => {
      if (!map[c.ticker]) map[c.ticker] = { ticker: c.ticker, coin: c.coin || c.ticker, items: [] };
      map[c.ticker].items.push(c);
    });
    return Object.values(map).map(({ ticker, coin, items }) => {
      const totalAmount = items.reduce((s, i) => s + i.amount, 0);
      const totalCost = items.reduce((s, i) => s + i.totalCost, 0);
      const lastPrice = getPrice(ticker);
      const currentValue = totalAmount * lastPrice;
      const gainLoss = currentValue - totalCost;
      const gainPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
      return { ticker, coin, items, totalAmount, totalCost, lastPrice, currentValue, gainLoss, gainPct };
    }).sort((a, b) => b.currentValue - a.currentValue);
  }, [crypto, cryptoPrices]);

  const totalValue = rows.reduce((s, r) => s + r.currentValue, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalGL = totalValue - totalCost;

  if (crypto.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "#334155" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>₿</div>
        <div style={{ fontFamily: "monospace", fontSize: 14 }}>NO CRYPTO — ADD ONE ABOVE</div>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.kpiStrip}>
        <KPI label="CRYPTO VALUE" value={fmtDollar(totalValue)} accent="#c084fc" icon={<DollarSign size={14} />} />
        <KPI label="TOTAL COST" value={fmtDollar(totalCost)} accent="#c084fc" icon={<DollarSign size={14} />} />
        <KPI label="TOTAL GAIN/LOSS" value={fmtDollar(totalGL)}
          subValue={fmtPct(totalCost > 0 ? (totalGL / totalCost) * 100 : 0)}
          accent={totalGL >= 0 ? "#00ff88" : "#ff6b35"}
          icon={totalGL >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} />
        <KPI label="ASSETS" value={rows.length} accent="#c084fc" icon={<Users size={14} />} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1.2fr 1.4fr 0.4fr", padding: "10px 16px", marginBottom: 4 }}>
        {["COIN", "PRICE", "AMOUNT", "AVG COST", "COST BASIS", "CURR VALUE", "GAIN/LOSS", ""].map((h) => (
          <div key={h} style={styles.th}>{h}</div>
        ))}
      </div>
      {rows.map((row) => (
        <div key={row.ticker} style={{ marginBottom: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1.2fr 1.2fr 1.4fr 0.4fr", padding: "14px 16px", background: "#0a1628", border: "1px solid #0f1e2e", borderRadius: 8, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...styles.tickerBadge, color: "#c084fc" }}>{row.ticker}</span>
              {row.coin !== row.ticker && <span style={{ fontSize: 11, color: "#475569" }}>{row.coin}</span>}
            </div>
            <div style={styles.td}>{row.lastPrice > 0 ? fmtDollar(row.lastPrice) : "—"}</div>
            <div style={styles.td}>{fmt(row.totalAmount, 6)}</div>
            <div style={styles.td}>{row.totalAmount > 0 ? fmtDollar(row.totalCost / row.totalAmount) : "—"}</div>
            <div style={styles.td}>{fmtDollar(row.totalCost)}</div>
            <div style={styles.td}>{row.currentValue > 0 ? fmtDollar(row.currentValue) : "—"}</div>
            <div style={{ ...styles.td, color: row.gainLoss >= 0 ? "#00ff88" : "#ff6b35", display: "flex", alignItems: "baseline", gap: 6 }}>
              {row.currentValue > 0
                ? <><span>{fmtDollar(row.gainLoss)}</span><span style={{ fontSize: 11, opacity: 0.8 }}>{fmtPct(row.gainPct)}</span></>
                : "—"}
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setEditingItem(row.items[0])}
                style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }} title="Edit">
                <Pencil size={11} />
              </button>
              <button onClick={() => onDelete(row.items[0].id)}
                style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }} title="Delete">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        </div>
      ))}
      {editingItem && (
        <CryptoModal users={users} editItem={editingItem}
          onAdd={(updated) => { onEdit(updated); setEditingItem(null); }}
          onClose={() => setEditingItem(null)} />
      )}
    </div>
  );
}

// ── Cash Tab ──────────────────────────────────────────────────────────────────
function CashTab({ cash, users, onEdit, onDelete }) {
  const [editingItem, setEditingItem] = useState(null);
  const totalBalance = cash.reduce((s, c) => s + c.balance, 0);
  const avgApy = cash.length > 0 ? cash.reduce((s, c) => s + c.apy, 0) / cash.length : 0;

  if (cash.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "#334155" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>◎</div>
        <div style={{ fontFamily: "monospace", fontSize: 14 }}>NO CASH ACCOUNTS — ADD ONE ABOVE</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ ...styles.kpiStrip, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <KPI label="TOTAL CASH" value={fmtDollar(totalBalance)} accent="#34d399" icon={<DollarSign size={14} />} />
        <KPI label="ACCOUNTS" value={cash.length} accent="#34d399" icon={<Users size={14} />} />
        <KPI label="AVG APY" value={`${fmt(avgApy, 2)}%`} accent="#34d399" icon={<TrendingUp size={14} />} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr 0.8fr 0.4fr", padding: "10px 16px", marginBottom: 4 }}>
        {["INSTITUTION", "TYPE", "OWNER", "BALANCE", "APY", ""].map((h) => (
          <div key={h} style={styles.th}>{h}</div>
        ))}
      </div>
      {cash.map((item) => (
        <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr 0.8fr 0.4fr", padding: "14px 16px", background: "#0a1628", border: "1px solid #0f1e2e", borderRadius: 8, marginBottom: 4, alignItems: "center" }}>
          <div style={{ ...styles.tickerBadge, color: "#34d399", fontSize: 13 }}>{item.institution}</div>
          <div style={styles.td}>{item.accountType}</div>
          <div style={styles.td}>{item.owner}</div>
          <div style={{ ...styles.td, color: "#34d399" }}>{fmtDollar(item.balance)}</div>
          <div style={styles.td}>{item.apy > 0 ? `${fmt(item.apy, 2)}%` : "—"}</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setEditingItem(item)}
              style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }} title="Edit">
              <Pencil size={11} />
            </button>
            <button onClick={() => onDelete(item.id)}
              style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }} title="Delete">
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      ))}
      {editingItem && (
        <CashModal users={users} editItem={editingItem}
          onAdd={(updated) => { onEdit(updated); setEditingItem(null); }}
          onClose={() => setEditingItem(null)} />
      )}
    </div>
  );
}

// ── House Tab ─────────────────────────────────────────────────────────────────
function HouseTab({ house, users, onEdit, onDelete }) {
  const [editingItem, setEditingItem] = useState(null);
  const totalValue = house.reduce((s, h) => s + h.currentValue, 0);
  const totalEquity = house.reduce((s, h) => s + (h.currentValue - h.mortgageBalance), 0);
  const totalCost = house.reduce((s, h) => s + h.purchasePrice, 0);
  const totalGL = totalValue - totalCost;

  if (house.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0", color: "#334155" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⌂</div>
        <div style={{ fontFamily: "monospace", fontSize: 14 }}>NO PROPERTIES — ADD ONE ABOVE</div>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.kpiStrip}>
        <KPI label="TOTAL VALUE" value={fmtDollar(totalValue)} accent="#fbbf24" icon={<DollarSign size={14} />} />
        <KPI label="NET EQUITY" value={fmtDollar(totalEquity)} accent="#fbbf24" icon={<DollarSign size={14} />} />
        <KPI label="APPRECIATION" value={fmtDollar(totalGL)}
          subValue={fmtPct(totalCost > 0 ? (totalGL / totalCost) * 100 : 0)}
          accent={totalGL >= 0 ? "#00ff88" : "#ff6b35"}
          icon={totalGL >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} />
        <KPI label="PROPERTIES" value={house.length} accent="#fbbf24" icon={<Users size={14} />} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr 1.2fr 1.2fr 1.2fr 0.4fr", padding: "10px 16px", marginBottom: 4 }}>
        {["PROPERTY", "OWNER", "PURCHASE PRICE", "CURR VALUE", "NET EQUITY", ""].map((h) => (
          <div key={h} style={styles.th}>{h}</div>
        ))}
      </div>
      {house.map((item) => {
        const equity = item.currentValue - item.mortgageBalance;
        const gl = item.currentValue - item.purchasePrice;
        const glPct = item.purchasePrice > 0 ? (gl / item.purchasePrice) * 100 : 0;
        return (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2.5fr 1fr 1.2fr 1.2fr 1.2fr 0.4fr", padding: "14px 16px", background: "#0a1628", border: "1px solid #0f1e2e", borderRadius: 8, marginBottom: 4, alignItems: "center" }}>
            <div>
              <div style={{ ...styles.tickerBadge, color: "#fbbf24", fontSize: 13 }}>{item.name}</div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{item.purchaseDate}</div>
            </div>
            <div style={styles.td}>{item.owner}</div>
            <div style={styles.td}>{fmtDollar(item.purchasePrice)}</div>
            <div style={{ ...styles.td, display: "flex", alignItems: "baseline", gap: 6 }}>
              <span>{fmtDollar(item.currentValue)}</span>
              <span style={{ fontSize: 11, color: gl >= 0 ? "#00ff88" : "#ff6b35", opacity: 0.8 }}>{fmtPct(glPct)}</span>
            </div>
            <div style={{ ...styles.td, color: equity >= 0 ? "#fbbf24" : "#ff6b35" }}>{fmtDollar(equity)}</div>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setEditingItem(item)}
                style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }} title="Edit">
                <Pencil size={11} />
              </button>
              <button onClick={() => onDelete(item.id)}
                style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, padding: "2px 6px", cursor: "pointer", color: "#475569", display: "flex", alignItems: "center" }} title="Delete">
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        );
      })}
      {editingItem && (
        <HouseModal users={users} editItem={editingItem}
          onAdd={(updated) => { onEdit(updated); setEditingItem(null); }}
          onClose={() => setEditingItem(null)} />
      )}
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
  const [crypto, setCrypto] = useState([]);
  const [cash, setCash] = useState([]);
  const [house, setHouse] = useState([]);
  const [prices, setPrices] = useState({});        // { AAPL: 213.49, ... }
  const [cryptoPrices, setCryptoPrices] = useState({}); // { "BTC-USD": 97000, ... }
  const [snapshots, setSnapshots] = useState(null); // null = not yet loaded; [] = loaded
  const [activities, setActivities] = useState([]);
  const [stocksSubTab, setStocksSubTab] = useState("POSITIONS");
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [showAddCrypto, setShowAddCrypto] = useState(false);
  const [showAddCash, setShowAddCash] = useState(false);
  const [showAddHouse, setShowAddHouse] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const settingsMenuRef = useRef();
  const fileInputRef = useRef();

  // ── Save portfolio to server ─────────────────────────────────────────────────
  // Uses a ref to always have the latest state without stale closures.
  const saveTimerRef = useRef(null);
  const portfolioRef = useRef({ users: [], positions: [], crypto: [], cash: [], house: [] });

  const schedulePortfolioSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const d = portfolioRef.current;
      apiFetch("/api/portfolio", {
        method: "PUT",
        body: JSON.stringify({
          investorNames: d.users,
          positions: d.positions,
          crypto: d.crypto,
          cash: d.cash,
          house: d.house,
        }),
      }).catch((err) => console.warn("[portfolio save]", err.message));
    }, 1500);
  }, []);

  // ── Keep portfolioRef in sync so the save callback always has fresh data ─────
  useEffect(() => {
    portfolioRef.current = { users: users || [], positions, crypto, cash, house };
  }, [users, positions, crypto, cash, house]);

  // ── Check existing session on mount ─────────────────────────────────────────
  useEffect(() => {
    async function checkSession() {
      try {
        const me = await apiFetch("/api/auth/me");
        setAuthUser(me);

        const [portfolio, snaps, actData] = await Promise.all([
          apiFetch("/api/portfolio"),
          apiFetch("/api/snapshots"),
          apiFetch("/api/activities"),
        ]);
        if (portfolio.investorNames?.length > 0) setUsers(portfolio.investorNames);
        setPositions(portfolio.positions || []);
        setCrypto(portfolio.crypto || []);
        setCash(portfolio.cash || []);
        setHouse(portfolio.house || []);
        setSnapshots(snaps || []);
        setActivities(actData.activities || []);
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

  // ── Fetch live stock prices whenever held tickers change ─────────────────────
  useEffect(() => {
    const tickers = [...new Set(positions.map((p) => p.ticker))];
    if (tickers.length === 0) return;
    fetch(`/api/prices?tickers=${tickers.join(",")}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setPrices((prev) => ({ ...prev, ...data })))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.map((p) => p.ticker).sort().join(",")]);

  // ── Fetch live crypto prices whenever held crypto tickers change ──────────────
  useEffect(() => {
    const tickers = [...new Set(crypto.map((c) => `${c.ticker}-USD`))];
    if (tickers.length === 0) return;
    fetch(`/api/prices?tickers=${tickers.join(",")}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setCryptoPrices((prev) => ({ ...prev, ...data })))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crypto.map((c) => c.ticker).sort().join(",")]);

  // ── Daily auto-snapshot ──────────────────────────────────────────────────────
  // Once prices are loaded, save today's portfolio value if not already snapped today.
  const hasSnappedRef = useRef(false);
  useEffect(() => {
    if (snapshots === null || positions.length === 0 || Object.keys(prices).length === 0) return;
    if (hasSnappedRef.current) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    if (snapshots.some((s) => s.date === dateStr)) return; // already snapped today

    const totalValue = parseFloat(
      positions.reduce((s, p) => s + p.shares * (prices[p.ticker] ?? 0), 0).toFixed(2)
    );
    if (totalValue === 0) return;

    hasSnappedRef.current = true;
    apiFetch("/api/snapshots", {
      method: "PUT",
      body: JSON.stringify({ date: dateStr, value: totalValue }),
    })
      .then(() => setSnapshots((prev) => [...(prev || []).filter((s) => s.date !== dateStr), { date: dateStr, value: totalValue }]))
      .catch(() => { hasSnappedRef.current = false; });
  }, [snapshots, positions, prices]);

  // ── Auth callbacks ───────────────────────────────────────────────────────────
  const handleLogin = useCallback(async (username) => {
    try {
      const portfolio = await apiFetch("/api/portfolio");
      if (portfolio.investorNames?.length > 0) setUsers(portfolio.investorNames);
      setPositions(portfolio.positions || []);
      setCrypto(portfolio.crypto || []);
      setCash(portfolio.cash || []);
      setHouse(portfolio.house || []);
      const [snaps, actData] = await Promise.all([
        apiFetch("/api/snapshots").catch(() => []),
        apiFetch("/api/activities").catch(() => ({ activities: [] })),
      ]);
      setSnapshots(snaps || []);
      setActivities(actData.activities || []);
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
    setCrypto([]);
    setCash([]);
    setHouse([]);
    setSnapshots(null);
    setActivities([]);
    setStocksSubTab("POSITIONS");
    setActiveTab(0);
    setAuthState("unauthenticated");
  }, []);

  // ── Onboarding done — investor names set for the first time ─────────────────
  const handleOnboardingDone = useCallback((names) => {
    setUsers(names);
    portfolioRef.current = { ...portfolioRef.current, users: names };
    schedulePortfolioSave();
  }, [schedulePortfolioSave]);

  // ── Position mutations ───────────────────────────────────────────────────────
  const handleAddPosition = useCallback((pos) => {
    setPositions((prev) => {
      const next = [...prev, pos];
      portfolioRef.current = { ...portfolioRef.current, positions: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleEditPosition = useCallback((updated) => {
    setPositions((prev) => {
      const next = prev.map((p) => p.id === updated.id ? updated : p);
      portfolioRef.current = { ...portfolioRef.current, positions: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleSell = useCallback((ticker, lotShares, _sellDate) => {
    setPositions((prev) => {
      const next = prev.map((p) => {
        const sellQty = parseFloat(lotShares[p.id] || 0);
        if (!sellQty || p.ticker !== ticker) return p;
        const newShares = Math.max(0, p.shares - sellQty);
        return { ...p, shares: newShares, totalCost: newShares * p.costPerShare };
      }).filter((p) => p.shares > 0);
      portfolioRef.current = { ...portfolioRef.current, positions: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  // ── CSV bulk import ──────────────────────────────────────────────────────────
  const handleCsvImport = useCallback((newPositions) => {
    setPositions((prev) => {
      const next = [...prev, ...newPositions];
      portfolioRef.current = { ...portfolioRef.current, positions: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  // ── Crypto mutations ─────────────────────────────────────────────────────────
  const handleAddCrypto = useCallback((item) => {
    setCrypto((prev) => {
      const next = [...prev, item];
      portfolioRef.current = { ...portfolioRef.current, crypto: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleEditCrypto = useCallback((updated) => {
    setCrypto((prev) => {
      const next = prev.map((c) => c.id === updated.id ? updated : c);
      portfolioRef.current = { ...portfolioRef.current, crypto: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleDeleteCrypto = useCallback((id) => {
    setCrypto((prev) => {
      const next = prev.filter((c) => c.id !== id);
      portfolioRef.current = { ...portfolioRef.current, crypto: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  // ── Cash mutations ───────────────────────────────────────────────────────────
  const handleAddCash = useCallback((item) => {
    setCash((prev) => {
      const next = [...prev, item];
      portfolioRef.current = { ...portfolioRef.current, cash: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleEditCash = useCallback((updated) => {
    setCash((prev) => {
      const next = prev.map((c) => c.id === updated.id ? updated : c);
      portfolioRef.current = { ...portfolioRef.current, cash: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleDeleteCash = useCallback((id) => {
    setCash((prev) => {
      const next = prev.filter((c) => c.id !== id);
      portfolioRef.current = { ...portfolioRef.current, cash: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  // ── House mutations ──────────────────────────────────────────────────────────
  const handleAddHouse = useCallback((item) => {
    setHouse((prev) => {
      const next = [...prev, item];
      portfolioRef.current = { ...portfolioRef.current, house: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleEditHouse = useCallback((updated) => {
    setHouse((prev) => {
      const next = prev.map((h) => h.id === updated.id ? updated : h);
      portfolioRef.current = { ...portfolioRef.current, house: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  const handleDeleteHouse = useCallback((id) => {
    setHouse((prev) => {
      const next = prev.filter((h) => h.id !== id);
      portfolioRef.current = { ...portfolioRef.current, house: next };
      schedulePortfolioSave();
      return next;
    });
  }, [schedulePortfolioSave]);

  // ── Activity mutations (immediate API calls, no debounce) ─────────────────────
  const handleAddActivity = useCallback(async (act) => {
    try {
      await apiFetch("/api/activities", { method: "POST", body: JSON.stringify(act) });
      setActivities((prev) => [act, ...prev]);
    } catch (err) {
      console.warn("[activity save]", err.message);
    }
  }, []);

  const handleDeleteActivity = useCallback(async (id) => {
    try {
      await apiFetch(`/api/activities/${id}`, { method: "DELETE" });
      setActivities((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.warn("[activity delete]", err.message);
    }
  }, []);

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

  // ── JSON import / export ─────────────────────────────────────────────────────
  const handleExport = () => {
    const data = JSON.stringify({ users, positions, crypto, cash, house }, null, 2);
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
        const { users: u, positions: p, crypto: cr = [], cash: ca = [], house: ho = [] } = JSON.parse(ev.target.result);
        setUsers(u); setPositions(p); setCrypto(cr); setCash(ca); setHouse(ho);
        portfolioRef.current = { users: u, positions: p, crypto: cr, cash: ca, house: ho };
        schedulePortfolioSave();
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

          {activeTab === 1 && stocksSubTab === "POSITIONS" && positions.length > 0 && (
            <button style={{ ...styles.btnSecondary, borderColor: "#ff6b35", color: "#ff6b35" }} onClick={() => setShowSell(true)}>
              <Trash2 size={13} /> SELL
            </button>
          )}
          {(activeTab === 0 || (activeTab === 1 && stocksSubTab === "POSITIONS")) && (
            <button style={styles.btnPrimary} onClick={() => setShowAdd(true)}>
              <Plus size={13} /> ADD POSITION
            </button>
          )}
          {activeTab === 1 && stocksSubTab === "ACTIVITY" && (
            <button style={{ ...styles.btnPrimary, borderColor: "#ffd700", color: "#ffd700", background: "#ffd70018" }} onClick={() => setShowAddActivity(true)}>
              <Plus size={13} /> LOG ACTIVITY
            </button>
          )}
          {activeTab === 2 && (
            <button style={{ ...styles.btnPrimary, borderColor: "#c084fc", color: "#c084fc", background: "#c084fc18" }} onClick={() => setShowAddCrypto(true)}>
              <Plus size={13} /> ADD CRYPTO
            </button>
          )}
          {activeTab === 3 && (
            <button style={{ ...styles.btnPrimary, borderColor: "#34d399", color: "#34d399", background: "#34d39918" }} onClick={() => setShowAddCash(true)}>
              <Plus size={13} /> ADD ACCOUNT
            </button>
          )}
          {activeTab === 4 && (
            <button style={{ ...styles.btnPrimary, borderColor: "#fbbf24", color: "#fbbf24", background: "#fbbf2418" }} onClick={() => setShowAddHouse(true)}>
              <Plus size={13} /> ADD PROPERTY
            </button>
          )}

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
                  <button style={styles.dropdownItem} onClick={() => { setShowCsvImport(true); setShowSettingsMenu(false); }}>
                    <FileSpreadsheet size={12} /> IMPORT CSV
                  </button>
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
        {[
          { label: "DASHBOARD", badge: null },
          { label: "STOCKS",    badge: [...new Set(positions.map(p => p.ticker))].length || null },
          { label: "CRYPTO",    badge: crypto.length || null },
          { label: "CASH",      badge: cash.length || null },
          { label: "HOUSE",     badge: house.length || null },
        ].map(({ label, badge }, i) => (
          <button key={label} onClick={() => setActiveTab(i)}
            style={{ ...styles.tab, ...(activeTab === i ? styles.tabActive : {}) }}>
            {label}
            {badge != null && badge > 0 && <span style={styles.tabBadge}>{badge}</span>}
          </button>
        ))}
        <div style={styles.tabLine} />
      </div>

      {/* Content */}
      <main style={styles.main}>
        {activeTab === 0 && <DashboardTab positions={positions} users={users} prices={prices} snapshots={snapshots} />}
        {activeTab === 1 && (
          <StocksTab
            stocksSubTab={stocksSubTab} onSubTab={setStocksSubTab}
            positions={positions} activities={activities} users={users}
            onEdit={handleEditPosition} prices={prices}
            onDeleteActivity={handleDeleteActivity}
          />
        )}
        {activeTab === 2 && <CryptoTab crypto={crypto} users={users} onEdit={handleEditCrypto} onDelete={handleDeleteCrypto} cryptoPrices={cryptoPrices} />}
        {activeTab === 3 && <CashTab cash={cash} users={users} onEdit={handleEditCash} onDelete={handleDeleteCash} />}
        {activeTab === 4 && <HouseTab house={house} users={users} onEdit={handleEditHouse} onDelete={handleDeleteHouse} />}
      </main>

      {/* Modals */}
      {showAdd && <AddPositionModal users={users} onAdd={handleAddPosition} onClose={() => setShowAdd(false)} />}
      {showSell && <SellPositionModal positions={positions} onSell={handleSell} onClose={() => setShowSell(false)} />}
      {showAddCrypto && <CryptoModal users={users} onAdd={handleAddCrypto} onClose={() => setShowAddCrypto(false)} />}
      {showAddCash && <CashModal users={users} onAdd={handleAddCash} onClose={() => setShowAddCash(false)} />}
      {showAddHouse && <HouseModal users={users} onAdd={handleAddHouse} onClose={() => setShowAddHouse(false)} />}
      {showAddActivity && <AddActivityModal users={users} onAdd={handleAddActivity} onClose={() => setShowAddActivity(false)} />}
      {showCsvImport && <CsvImportModal users={users} onImport={handleCsvImport} onClose={() => setShowCsvImport(false)} />}
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
