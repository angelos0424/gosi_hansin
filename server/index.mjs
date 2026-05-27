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
`);

let saveQueue = Promise.resolve();

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
