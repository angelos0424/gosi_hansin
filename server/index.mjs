import crypto from "node:crypto";
import http from "node:http";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const dataDir = process.env.DATA_DIR || path.join(rootDir, ".data");
const dbPath = path.join(dataDir, "progress.sqlite");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const adminId = process.env.ADMIN_ID || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

await fs.mkdir(dataDir, { recursive: true });

const SQL = await initSqlJs({
  locateFile: (file) => path.join(rootDir, "node_modules", "sql.js", "dist", file),
});

const db = existsSync(dbPath)
  ? new SQL.Database(await fs.readFile(dbPath))
  : new SQL.Database();

db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS answers (
    user_id TEXT NOT NULL,
    answer_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, answer_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_answers_answer_key
  ON answers(answer_key);

  CREATE TABLE IF NOT EXISTS objections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    answer_key TEXT NOT NULL,
    question_id TEXT NOT NULL,
    question_payload TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'progress', 'done')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_objections_status
  ON objections(status, created_at DESC);
`);

if (tableExists("answer_votes") && !tableHasForeignKeys("answer_votes")) {
  migrateAnswerVotesTable();
}

db.exec(`
  CREATE TABLE IF NOT EXISTS answer_votes (
    answer_key TEXT NOT NULL,
    answer_user_id TEXT NOT NULL,
    voter_user_id TEXT NOT NULL,
    vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (answer_key, answer_user_id, voter_user_id),
    FOREIGN KEY (voter_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (answer_user_id, answer_key) REFERENCES answers(user_id, answer_key) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_answer_votes_lookup
  ON answer_votes(answer_key, answer_user_id);
`);

let saveQueue = Promise.resolve();

function tableExists(tableName) {
  const stmt = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
  stmt.bind([tableName]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

function tableHasForeignKeys(tableName) {
  const stmt = db.prepare(`PRAGMA foreign_key_list(${tableName})`);
  let foreignKeyCount = 0;
  while (stmt.step()) {
    foreignKeyCount += 1;
  }
  stmt.free();
  return foreignKeyCount >= 3;
}

function migrateAnswerVotesTable() {
  db.exec(`
    CREATE TABLE answer_votes_next (
      answer_key TEXT NOT NULL,
      answer_user_id TEXT NOT NULL,
      voter_user_id TEXT NOT NULL,
      vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (answer_key, answer_user_id, voter_user_id),
      FOREIGN KEY (voter_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (answer_user_id, answer_key) REFERENCES answers(user_id, answer_key) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO answer_votes_next (answer_key, answer_user_id, voter_user_id, vote, updated_at)
    SELECT av.answer_key, av.answer_user_id, av.voter_user_id, av.vote, av.updated_at
    FROM answer_votes av
    JOIN users voter ON voter.id = av.voter_user_id
    JOIN answers answer ON answer.user_id = av.answer_user_id AND answer.answer_key = av.answer_key
    WHERE av.vote IN (-1, 1);

    DROP TABLE answer_votes;
    ALTER TABLE answer_votes_next RENAME TO answer_votes;
  `);
}

function enqueueSave() {
  saveQueue = saveQueue.then(async () => {
    const tempPath = `${dbPath}.tmp`;
    await fs.writeFile(tempPath, Buffer.from(db.export()));
    await fs.rename(tempPath, dbPath);
  });
  return saveQueue;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function serverErrorMessage(error) {
  if (["EACCES", "EPERM", "EROFS"].includes(error?.code)) {
    return "DATA_DIR 경로에 쓸 수 없습니다. Coolify Volume Mount의 Destination Path와 권한을 확인하세요.";
  }
  if (error?.message?.includes("readonly")) {
    return "SQLite 파일이 읽기 전용입니다. Coolify Volume Mount 권한을 확인하세요.";
  }
  return "server error";
}

function validateUserId(rawUserId) {
  const userId = decodeURIComponent(rawUserId || "").trim();
  if (!userId || userId.length > 64 || /[\u0000-\u001f/\\]/u.test(userId)) {
    return null;
  }
  return userId;
}

function safeCompare(a, b) {
  const aHash = crypto.createHash("sha256").update(String(a)).digest();
  const bHash = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

function isAdminRequest(req) {
  const authorization = req.headers.authorization || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const id = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeCompare(id, adminId) && safeCompare(password, adminPassword);
  } catch {
    return false;
  }
}

function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  return json(res, 401, { error: "admin login required" });
}

function validateObjectionStatus(status) {
  return ["new", "progress", "done"].includes(status) ? status : null;
}

function ensureUser(userId) {
  const now = Date.now();
  db.run(
    `INSERT INTO users (id, created_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    [userId, now, now],
  );
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2_000_000) {
      throw new Error("request body too large");
    }
  }
  return body ? JSON.parse(body) : {};
}

function getAnswers(userId) {
  const stmt = db.prepare("SELECT answer_key, payload FROM answers WHERE user_id = ?");
  const answers = {};
  stmt.bind([userId]);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    try {
      answers[row.answer_key] = JSON.parse(row.payload);
    } catch {
      answers[row.answer_key] = {};
    }
  }
  stmt.free();
  return answers;
}

function parsePayload(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function getAnswerRows(answerKey, currentUserId) {
  const stmt = db.prepare(
    "SELECT user_id, payload, updated_at FROM answers WHERE answer_key = ? AND user_id != ?",
  );
  const rows = [];
  stmt.bind([answerKey, currentUserId]);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      userId: row.user_id,
      payload: parsePayload(row.payload),
      updatedAt: row.updated_at,
    });
  }
  stmt.free();
  return rows;
}

function hasWrittenAnswer(questionType, payload) {
  if (questionType === "blank") {
    return Array.isArray(payload.blankAnswers) && payload.blankAnswers.some((value) => String(value || "").trim());
  }
  return Boolean(String(payload.note || "").trim());
}

function getWrittenAnswerRows(answerKey, currentUserId, questionType) {
  const stmt = db.prepare(`
    SELECT
      a.user_id,
      a.payload,
      a.updated_at,
      COALESCE(v_sum.score, 0) AS vote_score,
      COALESCE(v_my.vote, 0) AS my_vote
    FROM answers a
    LEFT JOIN (
      SELECT answer_user_id, SUM(vote) AS score
      FROM answer_votes
      WHERE answer_key = ?
      GROUP BY answer_user_id
    ) v_sum ON a.user_id = v_sum.answer_user_id
    LEFT JOIN answer_votes v_my
      ON v_my.answer_key = ?
      AND v_my.answer_user_id = a.user_id
      AND v_my.voter_user_id = ?
    WHERE a.answer_key = ? AND a.user_id != ?
  `);
  const rows = [];
  stmt.bind([answerKey, answerKey, currentUserId, answerKey, currentUserId]);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const payload = parsePayload(row.payload);
    if (!hasWrittenAnswer(questionType, payload)) continue;
    rows.push({
      userId: row.user_id,
      payload,
      updatedAt: row.updated_at,
      voteScore: Number(row.vote_score || 0),
      myVote: Number(row.my_vote || 0),
    });
  }
  stmt.free();
  return rows.sort((a, b) => b.voteScore - a.voteScore || b.updatedAt - a.updatedAt);
}

function answerExists(userId, answerKey) {
  const stmt = db.prepare("SELECT 1 FROM answers WHERE user_id = ? AND answer_key = ?");
  stmt.bind([userId, answerKey]);
  const exists = stmt.step();
  stmt.free();
  return exists;
}

async function handleAnswerSummary(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "method not allowed" });
  }

  const { answerKey, userId, questionType, options = [], limit = 10 } = await readJsonBody(req);
  const currentUserId = validateUserId(userId);
  if (!answerKey || !currentUserId || !questionType) {
    return json(res, 400, { error: "answerKey, userId, and questionType are required" });
  }

  const rows = getAnswerRows(answerKey, currentUserId);

  if (questionType === "choice" || questionType === "ox") {
    const expectedOptions = questionType === "ox" ? ["O", "X"] : options;
    const counts = new Map(expectedOptions.map((option) => [option, 0]));
    let total = 0;

    for (const row of rows) {
      const choice = row.payload.choice;
      if (!choice || !counts.has(choice)) continue;
      counts.set(choice, counts.get(choice) + 1);
      total += 1;
    }

    return json(res, 200, {
      mode: "aggregate",
      total,
      choices: [...counts.entries()].map(([value, count]) => ({
        value,
        count,
        percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
      })),
    });
  }

  const writtenRows = getWrittenAnswerRows(answerKey, currentUserId, questionType);

  return json(res, 200, {
    mode: "list",
    total: writtenRows.length,
    answers: writtenRows.slice(0, Math.max(1, Math.min(Number(limit) || 10, 30))),
  });
}

async function handleAnswerVote(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "method not allowed" });
  }

  const { answerKey, answerUserId, userId, vote } = await readJsonBody(req);
  const voterUserId = validateUserId(userId);
  const targetUserId = validateUserId(answerUserId);
  const nextVote = Number(vote);

  if (!answerKey || !voterUserId || !targetUserId || ![-1, 0, 1].includes(nextVote)) {
    return json(res, 400, { error: "answerKey, answerUserId, userId, and vote are required" });
  }
  if (voterUserId === targetUserId) {
    return json(res, 400, { error: "cannot vote on your own answer" });
  }
  if (nextVote !== 0 && !answerExists(targetUserId, answerKey)) {
    return json(res, 404, { error: "target answer not found" });
  }

  ensureUser(voterUserId);
  if (nextVote === 0) {
    db.run(
      "DELETE FROM answer_votes WHERE answer_key = ? AND answer_user_id = ? AND voter_user_id = ?",
      [answerKey, targetUserId, voterUserId],
    );
  } else {
    db.run(
      `INSERT INTO answer_votes (answer_key, answer_user_id, voter_user_id, vote, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(answer_key, answer_user_id, voter_user_id)
       DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`,
      [answerKey, targetUserId, voterUserId, nextVote, Date.now()],
    );
  }

  await enqueueSave();
  return json(res, 200, { ok: true });
}

async function handleObjections(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "method not allowed" });
  }

  const { userId: rawUserId, answerKey, questionId, question, message } = await readJsonBody(req);
  const userId = validateUserId(rawUserId);
  const trimmedMessage = String(message || "").trim();
  const safeQuestion = question && typeof question === "object" && !Array.isArray(question) ? question : null;

  if (!userId || !answerKey || !questionId || !safeQuestion || !trimmedMessage) {
    return json(res, 400, { error: "userId, answerKey, questionId, question, and message are required" });
  }
  if (trimmedMessage.length > 4000) {
    return json(res, 400, { error: "message is too long" });
  }

  ensureUser(userId);
  const now = Date.now();
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO objections (id, user_id, answer_key, question_id, question_payload, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    [id, userId, String(answerKey), String(questionId), JSON.stringify(safeQuestion), trimmedMessage, now, now],
  );
  await enqueueSave();
  return json(res, 201, { ok: true, objection: { id, status: "new", createdAt: now } });
}

async function handleAdminLogin(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "method not allowed" });
  }

  const { id, password } = await readJsonBody(req);
  if (safeCompare(id, adminId) && safeCompare(password, adminPassword)) {
    return json(res, 200, { ok: true });
  }
  return json(res, 401, { error: "invalid admin credentials" });
}

function objectionExists(objectionId) {
  const stmt = db.prepare("SELECT 1 FROM objections WHERE id = ?");
  try {
    stmt.bind([objectionId]);
    return stmt.step();
  } finally {
    stmt.free();
  }
}

function getObjectionRows() {
  const stmt = db.prepare(`
    SELECT id, user_id, answer_key, question_id, question_payload, message, status, created_at, updated_at
    FROM objections
    ORDER BY created_at DESC
  `);
  const rows = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    rows.push({
      id: row.id,
      userId: row.user_id,
      answerKey: row.answer_key,
      questionId: row.question_id,
      question: parsePayload(row.question_payload),
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  stmt.free();
  return rows;
}

async function handleAdminObjections(req, res, objectionId = "") {
  if (!requireAdmin(req, res)) return undefined;

  if (req.method === "GET" && !objectionId) {
    return json(res, 200, { objections: getObjectionRows() });
  }

  if (req.method === "PATCH" && objectionId) {
    const { status } = await readJsonBody(req);
    const nextStatus = validateObjectionStatus(status);
    if (!nextStatus) {
      return json(res, 400, { error: "status must be new, progress, or done" });
    }
    if (!objectionExists(objectionId)) {
      return json(res, 404, { error: "objection not found" });
    }

    db.run("UPDATE objections SET status = ?, updated_at = ? WHERE id = ?", [nextStatus, Date.now(), objectionId]);
    await enqueueSave();
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "method not allowed" });
}

async function handleProgress(req, res, userId) {
  if (req.method === "GET") {
    ensureUser(userId);
    await enqueueSave();
    return json(res, 200, { userId, answers: getAnswers(userId) });
  }

  if (req.method === "PUT") {
    const { answers } = await readJsonBody(req);
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return json(res, 400, { error: "answers object is required" });
    }

    ensureUser(userId);
    const now = Date.now();
    const stmt = db.prepare(
      `INSERT INTO answers (user_id, answer_key, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, answer_key)
       DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    );
    for (const [key, answer] of Object.entries(answers)) {
      if (!key || typeof answer !== "object" || Array.isArray(answer)) continue;
      stmt.run([userId, key, JSON.stringify(answer), now]);
    }
    stmt.free();
    await enqueueSave();
    return json(res, 200, { ok: true, answers: getAnswers(userId) });
  }

  if (req.method === "PATCH") {
    const { key, answer } = await readJsonBody(req);
    if (!key || !answer || typeof answer !== "object" || Array.isArray(answer)) {
      return json(res, 400, { error: "key and answer object are required" });
    }

    ensureUser(userId);
    db.run(
      `INSERT INTO answers (user_id, answer_key, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, answer_key)
       DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      [userId, key, JSON.stringify(answer), Date.now()],
    );
    await enqueueSave();
    return json(res, 200, { ok: true });
  }

  if (req.method === "DELETE") {
    ensureUser(userId);
    db.run("DELETE FROM answers WHERE user_id = ?", [userId]);
    await enqueueSave();
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "method not allowed" });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(distDir, `.${requestedPath}`);

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const targetPath = existsSync(filePath) ? filePath : path.join(distDir, "index.html");
  const ext = path.extname(targetPath).toLowerCase();
  const content = await fs.readFile(targetPath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
  });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const match = url.pathname.match(/^\/api\/progress\/([^/]+)$/);
    if (match) {
      const userId = validateUserId(match[1]);
      if (!userId) {
        return json(res, 400, { error: "invalid user id" });
      }
      return await handleProgress(req, res, userId);
    }

    if (url.pathname === "/api/answers/summary") {
      return await handleAnswerSummary(req, res);
    }

    if (url.pathname === "/api/answers/vote") {
      return await handleAnswerVote(req, res);
    }

    if (url.pathname === "/api/objections") {
      return await handleObjections(req, res);
    }

    if (url.pathname === "/api/admin/login") {
      return await handleAdminLogin(req, res);
    }

    const adminObjectionMatch = url.pathname.match(/^\/api\/admin\/objections(?:\/([^/]+))?$/);
    if (adminObjectionMatch) {
      return await handleAdminObjections(req, res, adminObjectionMatch[1] || "");
    }

    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { error: "not found" });
    }

    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: serverErrorMessage(error), code: error?.code || "SERVER_ERROR" });
  }
});

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
  console.log(`Progress database: ${dbPath}`);
});
