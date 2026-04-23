import { useState, useEffect, useCallback } from "react";

// ─── Base62 Encoding Engine ───────────────────────────────────────────────────
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(num) {
  if (num === 0) return BASE62[0];
  let result = "";
  while (num > 0) {
    result = BASE62[num % 62] + result;
    num = Math.floor(num / 62);
  }
  return result;
}

function hashUrl(url) {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) + hash + url.charCodeAt(i)) & 0x7fffffff;
  }
  return toBase62(hash).slice(0, 7);
}

// ─── Mock Geo + Device Detection ─────────────────────────────────────────────
const GEO_POOL = ["India", "USA", "UK", "Germany", "Brazil", "Japan", "Canada", "Australia", "France", "Singapore"];
const DEVICE_POOL = ["Mobile", "Desktop", "Tablet"];
const BROWSER_POOL = ["Chrome", "Safari", "Firefox", "Edge"];
const REFERER_POOL = ["Direct", "Twitter", "LinkedIn", "WhatsApp", "Reddit", "Email"];

function mockClick(urlId) {
  return {
    id: Math.random().toString(36).slice(2),
    urlId,
    timestamp: new Date(),
    geo: GEO_POOL[Math.floor(Math.random() * GEO_POOL.length)],
    device: DEVICE_POOL[Math.floor(Math.random() * DEVICE_POOL.length)],
    browser: BROWSER_POOL[Math.floor(Math.random() * BROWSER_POOL.length)],
    referer: REFERER_POOL[Math.floor(Math.random() * REFERER_POOL.length)],
  };
}

// ─── Mock Redis Cache ─────────────────────────────────────────────────────────
class MockRedis {
  constructor() { this.store = new Map(); this.ttl = new Map(); }
  set(key, val, ttlMs = 300000) {
    this.store.set(key, val);
    this.ttl.set(key, Date.now() + ttlMs);
  }
  get(key) {
    if (!this.store.has(key)) return null;
    if (Date.now() > this.ttl.get(key)) { this.store.delete(key); this.ttl.delete(key); return null; }
    return this.store.get(key);
  }
  hits = 0; misses = 0;
  cachedGet(key) {
    const v = this.get(key);
    if (v) { this.hits++; return v; }
    this.misses++;
    return null;
  }
}

const redis = new MockRedis();

// ─── Mock Rate Limiter ────────────────────────────────────────────────────────
class RateLimiter {
  constructor(maxReq = 5, windowMs = 10000) { this.max = maxReq; this.window = windowMs; this.requests = []; }
  allow() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.window);
    if (this.requests.length >= this.max) return false;
    this.requests.push(now);
    return true;
  }
  remaining() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.window);
    return Math.max(0, this.max - this.requests.length);
  }
}

const rateLimiter = new RateLimiter(5, 10000);

// ─── DB (in-memory) ───────────────────────────────────────────────────────────
const db = { urls: new Map(), clicks: [] };

// Seed data
const seeds = [
  { original: "https://github.com/anthropics/anthropic-sdk-python", custom: null, created: new Date(Date.now() - 86400000 * 3) },
  { original: "https://docs.anthropic.com/en/api/getting-started", custom: "claude-docs", created: new Date(Date.now() - 86400000 * 1.5) },
];
seeds.forEach(s => {
  const code = s.custom || hashUrl(s.original);
  const entry = { id: code, original: s.original, short: code, clicks: [], created: s.created, rateHit: false };
  db.urls.set(code, entry);
  for (let i = 0; i < Math.floor(Math.random() * 18) + 5; i++) {
    const c = mockClick(code);
    c.timestamp = new Date(Date.now() - Math.random() * 86400000 * 3);
    entry.clicks.push(c);
    db.clicks.push(c);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function aggregate(arr, key) {
  return arr.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

// ─── Components ───────────────────────────────────────────────────────────────

function Sparkline({ data, color = "#00ff88" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 120, h = 32;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points={`${pts} ${w},${h} 0,${h}`} fill={color} fillOpacity="0.12" />
    </svg>
  );
}

function BarChart({ data, color = "#00ff88" }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(...entries.map(e => e[1]), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([label, val]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 72, fontSize: 11, color: "#888", textAlign: "right", flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
          <div style={{ flex: 1, background: "#111", borderRadius: 2, height: 16, overflow: "hidden" }}>
            <div style={{ width: `${(val / max) * 100}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} />
          </div>
          <div style={{ width: 28, fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono', monospace" }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function PillBadge({ label, color = "#00ff88" }) {
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 1, color, border: `1px solid ${color}33`, background: `${color}11`, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>
      {label}
    </span>
  );
}

function CacheIndicator({ hit }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: hit ? "#00ff88" : "#ff6b35", border: `1px solid ${hit ? "#00ff88" : "#ff6b35"}44`, background: hit ? "#00ff8811" : "#ff6b3511", fontFamily: "'JetBrains Mono', monospace" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: hit ? "#00ff88" : "#ff6b35", display: "inline-block" }} />
      {hit ? "CACHE HIT" : "CACHE MISS"}
    </span>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function URLShortener() {
  const [urls, setUrls] = useState(() => [...db.urls.values()]);
  const [input, setInput] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("shorten");
  const [copied, setCopied] = useState(null);
  const [cacheStatus, setCacheStatus] = useState(null);
  const [rateLimitLeft, setRateLimitLeft] = useState(5);
  const [cacheStats, setCacheStats] = useState({ hits: 0, misses: 0 });
  const [consoleLog, setConsoleLog] = useState([]);
  const [simulatingRedirect, setSimulatingRedirect] = useState(false);

  const log = useCallback((msg, type = "info") => {
    setConsoleLog(prev => [...prev.slice(-19), { msg, type, ts: new Date() }]);
  }, []);

  useEffect(() => {
    log("🚀 URL Shortener initialized", "system");
    log(`📦 In-memory DB loaded with ${db.urls.size} URLs`, "system");
    log("⚡ Redis cache online (TTL: 5min)", "system");
    log("🛡️  Rate limiter active (5 req / 10s)", "system");
  }, [log]);

  const refreshUrls = () => setUrls([...db.urls.values()]);

  function isValidUrl(url) {
    try { new URL(url); return true; } catch { return false; }
  }

  function handleShorten() {
    setError(""); setSuccess("");
    if (!rateLimiter.allow()) {
      setError("⛔ Rate limit exceeded! Wait a moment before trying again.");
      log("⛔ Rate limit triggered — request blocked", "error");
      setRateLimitLeft(0);
      return;
    }
    setRateLimitLeft(rateLimiter.remaining());

    if (!input.trim()) { setError("Please enter a URL."); return; }
    if (!isValidUrl(input)) { setError("Invalid URL. Include https://"); return; }

    const alias = customAlias.trim();
    if (alias && !/^[a-zA-Z0-9_-]{3,20}$/.test(alias)) {
      setError("Alias: 3-20 chars, letters/numbers/-/_"); return;
    }

    const code = alias || hashUrl(input + Date.now());
    if (db.urls.has(code)) { setError(`Alias "${code}" already taken.`); return; }

    const entry = { id: code, original: input, short: code, clicks: [], created: new Date(), rateHit: false };
    db.urls.set(code, entry);
    redis.set(`url:${code}`, entry.original);

    log(`✅ Shortened → snip.ly/${code}`, "success");
    log(`🔑 Base62 hash: "${code}" (7 chars)`, "info");
    log(`💾 Stored in DB with index on short_code`, "info");
    log(`⚡ Pre-warmed Redis cache for key url:${code}`, "info");

    setSuccess(`snip.ly/${code}`);
    setInput(""); setCustomAlias("");
    refreshUrls();
    setSelected(code);
    setTab("analytics");
  }

  function simulateRedirect(code) {
    setSimulatingRedirect(true);
    const cacheKey = `url:${code}`;
    const cached = redis.cachedGet(cacheKey);
    const hit = !!cached;
    setCacheStatus({ code, hit });
    setCacheStats({ hits: redis.hits, misses: redis.misses });

    const entry = db.urls.get(code);
    if (!hit && entry) redis.set(cacheKey, entry.original);

    const click = mockClick(code);
    if (entry) {
      entry.clicks.push(click);
      db.clicks.push(click);
    }

    log(`🔗 Redirect: snip.ly/${code}`, "info");
    log(`  ${hit ? "⚡ Cache HIT — 0.3ms latency" : "🐢 Cache MISS — DB query ~12ms"}`, hit ? "success" : "warn");
    log(`  📍 ${click.geo} · ${click.device} · ${click.browser}`, "info");

    setTimeout(() => { setSimulatingRedirect(false); refreshUrls(); }, 600);
  }

  function copyToClipboard(text, id) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const selectedUrl = selected ? db.urls.get(selected) : null;

  function getDailySparkline(clicks) {
    const buckets = Array(7).fill(0);
    clicks.forEach(c => {
      const daysAgo = Math.floor((Date.now() - new Date(c.timestamp)) / 86400000);
      if (daysAgo < 7) buckets[6 - daysAgo]++;
    });
    return buckets;
  }

  const totalClicks = urls.reduce((s, u) => s + u.clicks.length, 0);
  const topUrl = [...urls].sort((a, b) => b.clicks.length - a.clicks.length)[0];

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#e0e0e0", fontFamily: "'JetBrains Mono', 'Courier New', monospace", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Syne:wght@700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #111; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .btn { cursor: pointer; border: none; outline: none; font-family: 'JetBrains Mono', monospace; transition: all 0.15s; }
        .btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }
        .card { background: #0e0e0e; border: 1px solid #1e1e1e; border-radius: 8px; }
        .input { background: #111; border: 1px solid #222; border-radius: 6px; color: #e0e0e0; font-family: 'JetBrains Mono', monospace; outline: none; transition: border-color 0.2s; }
        .input:focus { border-color: #00ff88; }
        .glow { box-shadow: 0 0 20px #00ff8822; }
        .tab-active { color: #00ff88; border-bottom: 2px solid #00ff88; }
        .url-row:hover { background: #111 !important; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.25s ease forwards; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        .pulse { animation: pulse 1.2s infinite; }
        @keyframes slideIn { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
        .slide-in { animation: slideIn 0.2s ease forwards; }
      `}</style>

      {/* Header */}
      <header style={{ padding: "20px 32px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#090909" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: "linear-gradient(135deg,#00ff88,#00ccff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚡</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: -0.5, color: "#fff" }}>snip.ly</div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 2 }}>URL SHORTENER ENGINE</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#00ff88" }}>{totalClicks}</div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>TOTAL CLICKS</div>
          </div>
          <div style={{ width: 1, height: 32, background: "#1e1e1e" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#00ccff" }}>{urls.length}</div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>URLS</div>
          </div>
          <div style={{ width: 1, height: 32, background: "#1e1e1e" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#ff6b35" }}>{rateLimitLeft}</div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>RATE LEFT</div>
          </div>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, gap: 0, overflow: "hidden", height: "calc(100vh - 73px)" }}>

        {/* Left Panel */}
        <div style={{ width: 380, borderRight: "1px solid #1a1a1a", display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a" }}>
            {["shorten", "analytics", "concepts"].map(t => (
              <button key={t} className={`btn ${tab === t ? "tab-active" : ""}`}
                onClick={() => setTab(t)}
                style={{ flex: 1, padding: "12px 4px", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: tab === t ? "#00ff88" : "#555", background: "none", borderBottom: tab === t ? "2px solid #00ff88" : "2px solid transparent", textTransform: "uppercase" }}>
                {t === "shorten" ? "⚡ Shorten" : t === "analytics" ? "📊 Analytics" : "🧠 Concepts"}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>

            {tab === "shorten" && (
              <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label style={{ fontSize: 10, color: "#555", letterSpacing: 2, fontWeight: 700, display: "block", marginBottom: 8 }}>ORIGINAL URL</label>
                  <input className="input" value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleShorten()}
                    placeholder="https://example.com/very/long/url"
                    style={{ width: "100%", padding: "10px 12px", fontSize: 12 }} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "#555", letterSpacing: 2, fontWeight: 700, display: "block", marginBottom: 8 }}>CUSTOM ALIAS <span style={{ color: "#333" }}>(optional)</span></label>
                  <div style={{ display: "flex", alignItems: "center", background: "#111", border: "1px solid #222", borderRadius: 6, overflow: "hidden" }}>
                    <span style={{ padding: "10px 10px", fontSize: 11, color: "#444", borderRight: "1px solid #222" }}>snip.ly/</span>
                    <input className="input" value={customAlias} onChange={e => setCustomAlias(e.target.value)}
                      placeholder="my-alias"
                      style={{ border: "none", flex: 1, padding: "10px 10px", fontSize: 12, background: "transparent" }} />
                  </div>
                </div>

                {error && <div style={{ background: "#ff6b3511", border: "1px solid #ff6b3533", borderRadius: 6, padding: "10px 12px", fontSize: 11, color: "#ff6b35" }}>{error}</div>}

                {success && (
                  <div className="fade-in" style={{ background: "#00ff8811", border: "1px solid #00ff8833", borderRadius: 6, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#00ff8899", marginBottom: 6, letterSpacing: 1 }}>SHORT URL CREATED</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <code style={{ color: "#00ff88", fontSize: 15, fontWeight: 700 }}>snip.ly/{success.split("/").pop()}</code>
                      <button className="btn" onClick={() => copyToClipboard(`snip.ly/${success.split("/").pop()}`, "success")}
                        style={{ fontSize: 10, padding: "4px 10px", background: "#00ff8822", color: "#00ff88", border: "1px solid #00ff8844", borderRadius: 4 }}>
                        {copied === "success" ? "✓ copied" : "copy"}
                      </button>
                    </div>
                  </div>
                )}

                <button className="btn glow" onClick={handleShorten}
                  style={{ width: "100%", padding: "12px", background: "linear-gradient(135deg,#00ff88,#00cc70)", color: "#000", borderRadius: 6, fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>
                  GENERATE SHORT URL →
                </button>

                <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 16 }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 10 }}>RATE LIMITER STATUS</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {Array(5).fill(0).map((_, i) => (
                      <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < rateLimitLeft ? "#00ff88" : "#1e1e1e", transition: "background 0.3s" }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 6 }}>{rateLimitLeft}/5 requests remaining · 10s window</div>
                </div>

                <div>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 10 }}>CACHE PERFORMANCE</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, background: "#111", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#00ff88" }}>{cacheStats.hits}</div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>CACHE HITS</div>
                    </div>
                    <div style={{ flex: 1, background: "#111", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#ff6b35" }}>{cacheStats.misses}</div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>CACHE MISSES</div>
                    </div>
                    <div style={{ flex: 1, background: "#111", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#00ccff" }}>
                        {cacheStats.hits + cacheStats.misses > 0 ? Math.round((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100) : 0}%
                      </div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>HIT RATE</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === "analytics" && selectedUrl && (
              <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 6 }}>ANALYZING</div>
                  <code style={{ color: "#00ff88", fontSize: 14, fontWeight: 700 }}>snip.ly/{selectedUrl.id}</code>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 4, wordBreak: "break-all" }}>{selectedUrl.original.slice(0, 60)}{selectedUrl.original.length > 60 ? "…" : ""}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, background: "#111", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#00ff88" }}>{selectedUrl.clicks.length}</div>
                    <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>TOTAL CLICKS</div>
                  </div>
                  <div style={{ flex: 1, background: "#111", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#00ccff" }}>
                      {selectedUrl.clicks.length > 0 ? new Set(selectedUrl.clicks.map(c => c.geo)).size : 0}
                    </div>
                    <div style={{ fontSize: 9, color: "#555", letterSpacing: 1 }}>COUNTRIES</div>
                  </div>
                </div>
                <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>LAST 7 DAYS</div>
                  <Sparkline data={getDailySparkline(selectedUrl.clicks)} />
                </div>
                <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>BY GEOGRAPHY</div>
                  <BarChart data={aggregate(selectedUrl.clicks, "geo")} color="#00ccff" />
                </div>
                <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>BY DEVICE</div>
                  <BarChart data={aggregate(selectedUrl.clicks, "device")} color="#ff6b35" />
                </div>
                <div style={{ background: "#0e0e0e", border: "1px solid #1e1e1e", borderRadius: 8, padding: 14 }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 2, marginBottom: 12 }}>BY REFERER</div>
                  <BarChart data={aggregate(selectedUrl.clicks, "referer")} color="#a855f7" />
                </div>
              </div>
            )}

            {tab === "analytics" && !selectedUrl && (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#444" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 13 }}>Select a URL from the list to view analytics</div>
              </div>
            )}

            {tab === "concepts" && (
              <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { icon: "🔑", title: "Base62 Encoding", color: "#00ff88", desc: "Converts a hash integer into a compact 7-char code using [0-9A-Za-z]. Produces ~3.5 trillion unique combinations — enough for any scale." },
                  { icon: "🗄️", title: "DB Indexing", color: "#00ccff", desc: "The short_code column has a B-Tree index. Lookups are O(log n) even with billions of rows. The original URL is stored separately from click data." },
                  { icon: "⚡", title: "Redis Caching", color: "#ffdd00", desc: "Hot URLs are cached with a 5-minute TTL. Cache-aside pattern: read from Redis first, fall back to DB on miss, then warm the cache. Reduces DB load by 90%+." },
                  { icon: "🛡️", title: "Rate Limiting", color: "#ff6b35", desc: "Sliding window algorithm: 5 requests per 10-second window per IP. Prevents abuse and DDoS. Uses Redis sorted sets in production for distributed tracking." },
                  { icon: "📐", title: "System Design", color: "#a855f7", desc: "Stateless API servers + centralized DB + Redis cluster. Horizontal scaling via load balancer. Counter-based ID generation prevents hash collisions at scale." },
                  { icon: "📊", title: "Click Analytics", color: "#ec4899", desc: "Each redirect writes a click event asynchronously (non-blocking). Geo/device extracted from IP + User-Agent headers. Aggregated for dashboards." },
                ].map(c => (
                  <div key={c.title} style={{ background: "#0e0e0e", border: `1px solid ${c.color}22`, borderRadius: 8, padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>{c.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{c.title}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "#666", lineHeight: 1.7 }}>{c.desc}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center — URL List */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #1a1a1a" }}>
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#090909" }}>
            <span style={{ fontSize: 10, color: "#555", letterSpacing: 2, fontWeight: 700 }}>ALL URLs ({urls.length})</span>
            {cacheStatus && <CacheIndicator hit={cacheStatus.hit} />}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {urls.sort((a, b) => new Date(b.created) - new Date(a.created)).map(url => (
              <div key={url.id} className="url-row" onClick={() => { setSelected(url.id); setTab("analytics"); }}
                style={{ padding: "14px 20px", borderBottom: "1px solid #111", cursor: "pointer", background: selected === url.id ? "#111" : "transparent", transition: "background 0.15s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code style={{ color: "#00ff88", fontSize: 13, fontWeight: 700 }}>snip.ly/{url.id}</code>
                    {selected === url.id && <PillBadge label="selected" color="#00ff88" />}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#555" }}>{timeAgo(url.created)}</span>
                    <button className="btn" onClick={e => { e.stopPropagation(); copyToClipboard(`snip.ly/${url.id}`, url.id); }}
                      style={{ fontSize: 9, padding: "3px 8px", background: "#1a1a1a", color: "#888", border: "1px solid #2a2a2a", borderRadius: 4 }}>
                      {copied === url.id ? "✓" : "copy"}
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#444", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url.original}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#888" }}>
                      <span style={{ color: url.clicks.length > 0 ? "#00ff88" : "#444", fontWeight: 700 }}>{url.clicks.length}</span>
                      <span style={{ color: "#444" }}> clicks</span>
                    </span>
                    <Sparkline data={getDailySparkline(url.clicks)} color="#00ff8866" />
                  </div>
                  <button className="btn" onClick={e => { e.stopPropagation(); simulateRedirect(url.id); }}
                    style={{ fontSize: 9, padding: "4px 10px", background: simulatingRedirect ? "#1a1a1a" : "#00ff8822", color: simulatingRedirect ? "#555" : "#00ff88", border: "1px solid #00ff8833", borderRadius: 4, display: "flex", alignItems: "center", gap: 4 }}>
                    {simulatingRedirect ? <span className="pulse">…</span> : "→ simulate redirect"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Console */}
        <div style={{ width: 280, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a", background: "#090909" }}>
            <span style={{ fontSize: 10, color: "#555", letterSpacing: 2, fontWeight: 700 }}>SYSTEM CONSOLE</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
            {consoleLog.map((entry, i) => (
              <div key={i} className="slide-in" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 9, color: "#333", flexShrink: 0, marginTop: 2, letterSpacing: 0.5 }}>
                  {entry.ts.toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{ fontSize: 10, lineHeight: 1.6, color: entry.type === "error" ? "#ff6b35" : entry.type === "success" ? "#00ff88" : entry.type === "warn" ? "#ffdd00" : entry.type === "system" ? "#00ccff" : "#666" }}>
                  {entry.msg}
                </span>
              </div>
            ))}
          </div>

          {/* Architecture Diagram */}
          <div style={{ borderTop: "1px solid #1a1a1a", padding: 14 }}>
            <div style={{ fontSize: 9, color: "#444", letterSpacing: 2, marginBottom: 10, fontWeight: 700 }}>ARCHITECTURE</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, alignItems: "center" }}>
              {[
                { label: "CLIENT", color: "#00ccff", sub: "Browser / App" },
                { label: "↓", color: "#333", sub: null },
                { label: "RATE LIMITER", color: "#ff6b35", sub: "5 req / 10s" },
                { label: "↓", color: "#333", sub: null },
                { label: "API SERVER", color: "#00ff88", sub: "Stateless" },
                { label: "↓", color: "#333", sub: null },
                { label: "REDIS CACHE", color: "#ffdd00", sub: "TTL 5min" },
                { label: "↓  (miss)", color: "#333", sub: null },
                { label: "POSTGRES DB", color: "#a855f7", sub: "Indexed" },
              ].map((node, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  {node.sub ? (
                    <div style={{ background: `${node.color}11`, border: `1px solid ${node.color}33`, borderRadius: 4, padding: "4px 12px", minWidth: 120 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: node.color, letterSpacing: 1 }}>{node.label}</div>
                      <div style={{ fontSize: 8, color: "#444", marginTop: 1 }}>{node.sub}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: node.color, padding: "2px 0" }}>{node.label}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
