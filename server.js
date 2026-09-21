// HTTP 层：只做路由与静态页面分发，规则判断在 lib/rules.js，档案存储在 lib/store.js。
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./lib/store.js";
import { ApiError, createService } from "./lib/service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3024);
const store = createStore(join(__dirname, "data", "pigeons.json"));
const service = createService(store);

const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"]
};

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function relation(db, ringNo) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return { pigeon, father, mother, children };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && staticFiles[url.pathname]) {
      const [file, type] = staticFiles[url.pathname];
      res.writeHead(200, { "Content-Type": type });
      return res.end(await readFile(join(__dirname, "public", file)));
    }

    if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, await service.getState());
    if (req.method === "GET" && url.pathname === "/api/pigeons") return sendJson(res, 200, await store.read(db => db.pigeons));
    if (req.method === "POST" && url.pathname === "/api/pigeons") return sendJson(res, 201, await service.createPigeon(await body(req)));
    if (req.method === "GET" && url.pathname === "/api/lofts") return sendJson(res, 200, (await service.getState()).lofts);
    if (req.method === "POST" && url.pathname === "/api/lofts") return sendJson(res, 201, await service.createLoft(await body(req)));
    if (req.method === "GET" && url.pathname === "/api/moves") return sendJson(res, 200, (await service.getState()).moves);
    if (req.method === "POST" && url.pathname === "/api/moves") return sendJson(res, 200, await service.requestMoveIn(await body(req)));

    const loftMatch = url.pathname.match(/^\/api\/lofts\/([^/]+)$/);
    if (loftMatch && req.method === "PATCH") {
      return sendJson(res, 200, await service.updateLoft(loftMatch[1], await body(req)));
    }

    const moveAction = url.pathname.match(/^\/api\/moves\/([^/]+)\/(confirm|cancel)$/);
    if (moveAction && req.method === "POST") {
      const result = moveAction[2] === "confirm" ? await service.confirmMove(moveAction[1]) : await service.cancelMove(moveAction[1]);
      return sendJson(res, 200, result);
    }

    const pigeonAction = url.pathname.match(/^\/api\/pigeons\/(.+)\/(relation|review|transfers|races|vaccines)$/);
    if (pigeonAction) {
      const ringNo = decodeURIComponent(pigeonAction[1]);
      const action = pigeonAction[2];
      if (action === "relation" && req.method === "GET") {
        const data = await store.read(db => relation(db, ringNo));
        return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
      }
      if (action === "review" && req.method === "POST") return sendJson(res, 200, await service.clearReview(ringNo));
      if (req.method === "POST") return sendJson(res, 200, await service.appendRecord(ringNo, action, await body(req)));
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof ApiError) return sendJson(res, error.status, { error: error.code });
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
