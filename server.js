// HTTP 接线层：只做路由与响应，规则判断在 src/rules.js，档案存储在 src/store.js，页面在 src/page.js。
import http from "node:http";
import { page } from "./src/page.js";
import { REASON_TEXT } from "./src/rules.js";
import * as store from "./src/store.js";

const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function fail(res, status, reason, extra = {}) {
  sendJson(res, status, { error: reason, message: REASON_TEXT[reason] || reason, ...extra });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }

    // 状态总览：棚位占用、待迁移清单、档案，一次拉齐
    if (req.method === "GET" && path === "/api/state") return sendJson(res, 200, await store.getState());
    if (req.method === "GET" && path === "/api/pigeons") return sendJson(res, 200, (await store.getState()).pigeons);
    if (req.method === "GET" && path === "/api/move-ins") return sendJson(res, 200, (await store.getState()).moveIns);

    // 档案入棚：先通过棚位准入规则才创建
    if (req.method === "POST" && path === "/api/pigeons") {
      const result = await store.createPigeon(await body(req));
      if (!result.ok) return fail(res, 409, result.reason);
      return sendJson(res, 201, result.pigeon);
    }

    if (req.method === "POST" && path === "/api/lofts") {
      const result = await store.createLoft(await body(req));
      if (!result.ok) return fail(res, 409, result.reason);
      return sendJson(res, 201, result.loft);
    }
    const loftMatch = path.match(/^\/api\/lofts\/(.+)$/);
    if (loftMatch && req.method === "PATCH") {
      const result = await store.updateLoft(decodeURIComponent(loftMatch[1]), await body(req));
      if (!result.ok) return fail(res, result.notFound ? 404 : 409, result.reason);
      return sendJson(res, 200, result);
    }

    // 迁入申请：幂等，重复/并发同一 requestId 只采用首次结果
    if (req.method === "POST" && path === "/api/move-ins") {
      const result = await store.requestMoveIn(await body(req));
      if (!result.ok) {
        return fail(res, result.notFound ? 404 : 409, result.reason, { moveIn: result.moveIn, deduplicated: !!result.deduplicated });
      }
      return sendJson(res, 201, result);
    }
    const moveAction = path.match(/^\/api\/move-ins\/(.+)\/(confirm|cancel)$/);
    if (moveAction && req.method === "POST") {
      const action = moveAction[2] === "confirm" ? store.confirmMoveIn : store.cancelMoveIn;
      const result = await action(decodeURIComponent(moveAction[1]));
      if (!result.ok) return fail(res, result.notFound ? 404 : 409, result.reason);
      return sendJson(res, 200, result);
    }

    const relationMatch = path.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (relationMatch && req.method === "GET") {
      const data = await store.getRelation(decodeURIComponent(relationMatch[1]));
      return data ? sendJson(res, 200, data) : fail(res, 404, "pigeon_not_found");
    }
    const actionMatch = path.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (actionMatch && req.method === "POST") {
      const result = await store.addPigeonRecord(decodeURIComponent(actionMatch[1]), actionMatch[2], await body(req));
      if (!result.ok) return fail(res, result.notFound ? 404 : 409, result.reason);
      return sendJson(res, 200, result.pigeon);
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
