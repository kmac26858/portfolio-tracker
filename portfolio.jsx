import { useState, useMemo, useRef } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Plus, Trash2, ChevronDown, ChevronRight, Download, Upload, X, TrendingUp, TrendingDown, DollarSign, Users } from "lucide-react";

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
              {["Stock", "ETF"].map((t) => (
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

// ── Positions Tab ─────────────────────────────────────────────────────────────
function PositionsTab({ positions }) {
  const [expanded, setExpanded] = useState({});
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
                {["DATE", "BROKER", "OWNER", "SHARES", "COST/SHARE", "TOTAL COST"].map((h) => (
                  <div key={h} style={{ ...styles.th, fontSize: 10 }}>{h}</div>
                ))}
              </div>
              {row.lots.map((lot) => (
                <div key={lot.id} style={styles.lotRow2}>
                  <div style={styles.tdSm}>{lot.purchaseDate}</div>
                  <div style={styles.tdSm}>{lot.brokerage}</div>
                  <div style={styles.tdSm}>{lot.owner}</div>
                  <div style={styles.tdSm}>{fmt(lot.shares, 4)}</div>
                  <div style={styles.tdSm}>{fmtDollar(lot.costPerShare)}</div>
                  <div style={styles.tdSm}>{fmtDollar(lot.totalCost)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
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

  // Chart 1: by owner
  const byOwner = useMemo(() => {
    const map = {};
    positions.forEach((p) => {
      const val = p.shares * getPrice(p.ticker);
      map[p.owner] = (map[p.owner] || 0) + val;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }));
  }, [positions]);

  // Chart 2: by ticker
  const byTicker = useMemo(() =>
    Object.entries(grouped).map(([ticker, v]) => ({
      name: ticker, value: parseFloat((v.shares * getPrice(ticker)).toFixed(2))
    })).sort((a, b) => b.value - a.value),
    [grouped]
  );

  // Chart 3: stock vs ETF
  const byType = useMemo(() => {
    const map = { Stock: 0, ETF: 0 };
    positions.forEach((p) => {
      map[p.type] = (map[p.type] || 0) + p.shares * getPrice(p.ticker);
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
      {/* KPI strip */}
      <div style={styles.kpiStrip}>
        <KPI label="TOTAL VALUE" value={fmtDollar(totalValue)} icon={<DollarSign size={14} />} />
        <KPI label="TOTAL COST" value={fmtDollar(totalCost)} icon={<DollarSign size={14} />} />
        <KPI label="TOTAL GAIN/LOSS" value={fmtDollar(overallGL)}
          accent={overallGL >= 0 ? "#00ff88" : "#ff6b35"}
          icon={overallGL >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} />
        <KPI label="INVESTORS" value={users.length} icon={<Users size={14} />} />
      </div>

      {/* Charts */}
      <div style={styles.chartsGrid}>
        <ChartCard title="PORTFOLIO BY INVESTOR" data={byOwner} />
        <ChartCard title="HOLDINGS BREAKDOWN" data={byTicker} />
        <ChartCard title="STOCK vs ETF SPLIT" data={byType} />
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
  const [users, setUsers] = useState(null);
  const [positions, setPositions] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const fileInputRef = useRef();

  const handleAddPosition = (pos) => setPositions((p) => [...p, pos]);

  const handleSell = (ticker, lotShares, _sellDate) => {
    setPositions((prev) =>
      prev.map((p) => {
        const sellQty = parseFloat(lotShares[p.id] || 0);
        if (!sellQty || p.ticker !== ticker) return p;
        const newShares = Math.max(0, p.shares - sellQty);
        return { ...p, shares: newShares, totalCost: newShares * p.costPerShare };
      }).filter((p) => p.shares > 0)
    );
  };

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
        setUsers(u); setPositions(p);
      } catch { alert("Invalid portfolio file."); }
    };
    reader.readAsText(file);
  };

  if (!users) return <OnboardingModal onDone={setUsers} />;

  return (
    <div style={styles.app}>
      {/* Subtle grid background */}
      <div style={styles.gridBg} />

      {/* Header */}
      <header style={styles.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={styles.logo}>◈ PORTFOLIO</span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#334155" }}>
            {users.join(" · ")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
          <button style={styles.btnSecondary} onClick={() => fileInputRef.current.click()}>
            <Upload size={13} /> IMPORT
          </button>
          <button style={styles.btnSecondary} onClick={handleExport}>
            <Download size={13} /> EXPORT
          </button>
          {positions.length > 0 && (
            <button style={{ ...styles.btnSecondary, borderColor: "#ff6b35", color: "#ff6b35" }} onClick={() => setShowSell(true)}>
              <Trash2 size={13} /> SELL
            </button>
          )}
          <button style={styles.btnPrimary} onClick={() => setShowAdd(true)}>
            <Plus size={13} /> ADD POSITION
          </button>
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
        {activeTab === 1 && <PositionsTab positions={positions} />}
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
  chartsGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
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
    display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr",
    padding: "6px 0 8px", borderBottom: "1px solid #0f1e2e", marginBottom: 6,
  },
  lotRow: {
    display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
    borderBottom: "1px solid #0f1e2e",
  },
  lotRow2: {
    display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr",
    padding: "7px 0",
  },
  tdSm: { fontFamily: "monospace", fontSize: 12, color: "#64748b" },
};
