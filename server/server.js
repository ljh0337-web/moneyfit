require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.6";
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL이 설정되지 않았어요. (Neon/Supabase 등 Postgres 연결 문자열을 환경변수로 등록해주세요.)");
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      store_name TEXT NOT NULL DEFAULT '내 가게',
      business_number TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      revenue NUMERIC NOT NULL DEFAULT 0,
      expenses JSONB NOT NULL DEFAULT '{}',
      total_expenses NUMERIC NOT NULL DEFAULT 0,
      net_profit NUMERIC NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);
  `);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const toPublicUser = (row) => ({
  id: row.id,
  email: row.email,
  storeName: row.store_name,
  businessNumber: row.business_number || "",
  address: row.address || "",
  phone: row.phone || "",
});

const toPublicRecord = (row) => ({
  id: row.id,
  date: row.date,
  revenue: Number(row.revenue),
  expenses: row.expenses,
  totalExpenses: Number(row.total_expenses),
  netProfit: Number(row.net_profit),
});

/* ── 인증 미들웨어 ── */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "로그인이 필요해요." });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).uid;
    next();
  } catch {
    return res.status(401).json({ error: "로그인이 만료됐어요. 다시 로그인해주세요." });
  }
}

/* ── 회원가입 ── */
app.post("/api/auth/register", async (req, res) => {
  const { email, password, storeName } = req.body || {};
  if (!email || !password || password.length < 4) {
    return res.status(400).json({ error: "이메일과 4자 이상 비밀번호를 입력해주세요." });
  }
  try {
    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rowCount > 0) return res.status(409).json({ error: "이미 가입된 이메일이에요." });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const passwordHash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (id, email, password_hash, store_name) VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, email, passwordHash, storeName || "내 가게"]
    );
    const token = jwt.sign({ uid: id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: toPublicUser(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: "회원가입 중 오류가 발생했어요." });
  }
});

/* ── 로그인 ── */
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
      return res.status(401).json({ error: "이메일 또는 비밀번호가 일치하지 않아요." });
    }
    const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: toPublicUser(user) });
  } catch (e) {
    res.status(500).json({ error: "로그인 중 오류가 발생했어요." });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: "사용자를 찾을 수 없어요." });
  res.json({ user: toPublicUser(rows[0]) });
});

/* ── 내 정보 수정 ── */
app.put("/api/auth/profile", auth, async (req, res) => {
  const { storeName, businessNumber, address, phone, email } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없어요." });

  if (email && email !== user.email) {
    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rowCount > 0) return res.status(409).json({ error: "이미 사용 중인 이메일이에요." });
  }

  const { rows: updatedRows } = await pool.query(
    `UPDATE users SET store_name = $1, business_number = $2, address = $3, phone = $4, email = $5 WHERE id = $6 RETURNING *`,
    [
      storeName ?? user.store_name,
      businessNumber ?? user.business_number ?? "",
      address ?? user.address ?? "",
      phone ?? user.phone ?? "",
      email || user.email,
      req.userId,
    ]
  );
  res.json({ user: toPublicUser(updatedRows[0]) });
});

/* ── 매출/지출 기록 ── */
app.get("/api/records", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records WHERE user_id = $1 ORDER BY date ASC", [req.userId]);
  res.json({ records: rows.map(toPublicRecord) });
});

app.post("/api/records", auth, async (req, res) => {
  const { date, revenue, expenses, totalExpenses, netProfit } = req.body || {};
  if (!date || typeof revenue !== "number") {
    return res.status(400).json({ error: "날짜와 매출은 필수예요." });
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const te = totalExpenses || 0;
  const net = netProfit ?? revenue - te;
  const { rows } = await pool.query(
    `INSERT INTO records (id, user_id, date, revenue, expenses, total_expenses, net_profit) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, req.userId, date, revenue, JSON.stringify(expenses || {}), te, net]
  );
  res.json({ record: toPublicRecord(rows[0]) });
});

app.delete("/api/records/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM records WHERE id = $1 AND user_id = $2", [req.params.id, req.userId]);
  res.json({ ok: true });
});

app.delete("/api/records", auth, async (req, res) => {
  await pool.query("DELETE FROM records WHERE user_id = $1", [req.userId]);
  res.json({ ok: true });
});

/* ── AI 분석 프록시 (API 키는 서버에만 존재) ──
   OPENROUTER_API_KEY가 있으면 OpenRouter(OpenAI 호환) 경유로 Claude 호출,
   없으면 ANTHROPIC_API_KEY로 Anthropic 직접 호출. */
function toOpenRouterContent(content) {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "image") {
      return { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } };
    }
    return { type: "text", text: block.text };
  });
}

async function callClaudeViaOpenRouter({ system, messages, max_tokens }) {
  const body = {
    model: OPENROUTER_MODEL,
    max_tokens: max_tokens || 800,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...messages.map((m) => ({ role: m.role, content: toOpenRouterContent(m.content) })),
    ],
  };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://moneyfit.onrender.com",
      "X-Title": "MoneyFit",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "AI 호출 실패 (OpenRouter)");
  return data?.choices?.[0]?.message?.content || "분석 결과를 가져오지 못했어요.";
}

async function callClaudeViaAnthropic({ system, messages, max_tokens }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: max_tokens || 800,
      ...(system ? { system } : {}),
      messages,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || "AI 호출 실패 (Anthropic)");
  return data?.content?.[0]?.text || "분석 결과를 가져오지 못했어요.";
}

async function callClaude(args) {
  if (OPENROUTER_API_KEY) return callClaudeViaOpenRouter(args);
  if (ANTHROPIC_API_KEY) return callClaudeViaAnthropic(args);
  throw new Error("서버에 AI 키가 설정되지 않았어요. OPENROUTER_API_KEY 또는 ANTHROPIC_API_KEY를 등록해주세요.");
}

const fmtW = (n) => Math.round(n || 0).toLocaleString("ko-KR") + "원";
const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "0%");

app.post("/api/ai/briefing", auth, async (req, res) => {
  const { month, revenue, expenses, net, catTotals } = req.body || {};
  const margin = revenue > 0 ? ((net / revenue) * 100).toFixed(1) : 0;
  const prompt = `자영업자 전문 경영 컨설턴트로서 소상공인 매장 ${month} 데이터를 동업자 톤으로 분석해주세요.
매출:${fmtW(revenue)} 지출:${fmtW(expenses)} 순이익:${fmtW(net)}(${margin}%)
재료비:${fmtW(catTotals?.["재료비"])}(${pct(catTotals?.["재료비"], revenue)}) 인건비:${fmtW(catTotals?.["인건비"])}
임대료:${fmtW(catTotals?.["임대료"])} 배달수수료:${fmtW(catTotals?.["배달앱수수료"])}(${pct(catTotals?.["배달앱수수료"], revenue)})
①이번달 평가(한줄) ②돈이 새는 곳(금액포함) ③당장 실천할 개선 1가지
4~5문장, 친근하게, 숫자는 금액으로.`;
  try {
    const text = await callClaude({ messages: [{ role: "user", content: prompt }], max_tokens: 1000 });
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/ai/chat", auth, async (req, res) => {
  const { history, ctx } = req.body || {};
  const { month, revenue, expenses, net, catTotals } = ctx || {};
  const margin = revenue > 0 ? ((net / revenue) * 100).toFixed(1) : 0;
  const sys = `너는 자영업자 사장님의 AI 경영 동업자야. 친구도 비서도 아닌, 같이 고민하는 동업자 톤으로 대답해.
숫자는 항상 금액(원) 먼저, %는 보조로만 써. 2~4문장으로 짧고 구체적으로 답해.
[${month} 데이터] 매출:${fmtW(revenue)} 지출:${fmtW(expenses)} 순이익:${fmtW(net)}(${margin}%)
재료비:${fmtW(catTotals?.["재료비"] || 0)} 인건비:${fmtW(catTotals?.["인건비"] || 0)} 임대료:${fmtW(catTotals?.["임대료"] || 0)} 배달앱수수료:${fmtW(catTotals?.["배달앱수수료"] || 0)}`;
  try {
    const messages = (history || []).map((h) => ({ role: h.role, content: h.text }));
    const text = await callClaude({ system: sys, messages, max_tokens: 600 });
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ── 영수증 촬영 자동 인식 (Claude Vision) ── */
app.post("/api/ai/receipt", auth, async (req, res) => {
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "이미지가 없어요." });

  const prompt = `이 영수증/거래명세서 이미지를 분석해주세요.
다음 JSON 형식으로만 답해주세요 (다른 설명 없이 JSON만):
{
  "date": "YYYY-MM-DD",
  "storeName": "거래처명 또는 매장명",
  "amount": 숫자(부가세 포함 총액),
  "vatAmount": 숫자(부가세, 없으면 0),
  "type": "revenue 또는 expense (이 매장이 손님에게 받은 매출 영수증이면 revenue, 재료/물품 구매·지출 영수증이면 expense)",
  "category": "재료비/인건비/임대료/공과금/배달앱수수료/기타 중 하나 (expense일 때만, revenue면 null)",
  "note": "사장님에게 한 줄로 알려줄 참고사항 (예: 단가 변동, 특이사항). 없으면 빈 문자열"
}
날짜를 읽을 수 없으면 오늘 날짜를 비워두고 date를 null로 주세요.`;

  try {
    const text = await callClaude({
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens: 500,
    });
    const match = text.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(match ? match[0] : text);
    } catch {
      return res.status(502).json({ error: "영수증을 읽지 못했어요. 다시 찍어주세요." });
    }
    res.json({ data: parsed });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ── 정적 파일: 앱(PWA) + 랜딩페이지 ── */
app.use("/app", express.static(path.join(__dirname, "..", "web")));
app.use("/", express.static(path.join(__dirname, "..", "landing"), { dotfiles: "allow" }));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`머니핏 서버 실행 중 → http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("DB 초기화 실패:", e.message);
    process.exit(1);
  });
