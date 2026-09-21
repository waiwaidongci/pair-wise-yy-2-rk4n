// 档案存储层：JSON 持久化、变更串行化、迁入请求幂等。规则判断全部委托 rules.js。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOFT_STATUSES,
  REASON_TEXT,
  VENTILATION_GRADES,
  evaluateConfirm,
  evaluateMoveIn,
  evaluateNewArchive,
  loftOccupancy,
  recomputeLoftStates
} from "./rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "pigeons.json");

const seed = {
  lofts: [
    { name: "北岸A棚", capacity: 12, status: "active", ventilation: "A" },
    { name: "种鸽棚", capacity: 8, status: "active", ventilation: "B" },
    { name: "育种棚", capacity: 6, status: "active", ventilation: "B" },
    { name: "南坡赛棚", capacity: 4, status: "disabled", ventilation: "C" }
  ],
  pigeons: [
    { ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512", color: "灰", requiredVentilation: "A", loft: "北岸A棚", reviewStatus: null, vaccines: [{ date: "2026-04-01", name: "新城疫" }], transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }], races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }] },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", requiredVentilation: "B", loft: "种鸽棚", reviewStatus: null, vaccines: [], transfers: [], races: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", requiredVentilation: "B", loft: "种鸽棚", reviewStatus: null, vaccines: [], transfers: [], races: [] }
  ],
  moveIns: []
};

// 旧数据迁移：补齐鸽棚、迁入清单与档案新字段
function migrate(db) {
  if (!Array.isArray(db.lofts)) db.lofts = seed.lofts.map(l => ({ ...l }));
  if (!Array.isArray(db.moveIns)) db.moveIns = [];
  for (const p of db.pigeons) {
    if (!VENTILATION_GRADES.includes(p.requiredVentilation)) p.requiredVentilation = "C";
    if (!("reviewStatus" in p)) p.reviewStatus = null;
  }
  return db;
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
  }
  return migrate(JSON.parse(await readFile(dbPath, "utf8")));
}

async function saveDb(db) {
  const tmp = dbPath + ".tmp";
  await writeFile(tmp, JSON.stringify(db, null, 2));
  await rename(tmp, dbPath);
}

// 变更串行化：同一迁入请求的重复/并发在锁内只会看到并采用首次结果
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const db = await loadDb();
    const result = await fn(db);
    await saveDb(db);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function withReasonText(moveIn) {
  return { ...moveIn, reasonText: moveIn.reason ? REASON_TEXT[moveIn.reason] || moveIn.reason : null };
}

// 读取：棚位占用、待迁移清单与档案履历同源输出，重载后保持一致
export async function getState() {
  const db = await loadDb();
  return {
    lofts: db.lofts.map(l => ({ ...l, occupancy: loftOccupancy(db, l.name) })),
    pigeons: db.pigeons,
    moveIns: db.moveIns.map(withReasonText)
  };
}

export async function getRelation(ringNo) {
  const db = await loadDb();
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  if (!pigeon) return null;
  const father = db.pigeons.find(item => item.ringNo === pigeon.fatherRing) || null;
  const mother = db.pigeons.find(item => item.ringNo === pigeon.motherRing) || null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  const moveIns = db.moveIns.filter(item => item.ringNo === ringNo).map(withReasonText);
  return { pigeon, father, mother, children, moveIns };
}

export function createPigeon(input) {
  return mutate(async db => {
    const requiredVentilation = input.requiredVentilation || "C";
    if (!VENTILATION_GRADES.includes(requiredVentilation)) return { ok: false, reason: "ventilation_invalid" };
    const check = evaluateNewArchive(db, { ringNo: (input.ringNo || "").trim(), toLoft: input.loft, requiredVentilation });
    if (!check.ok) return { ok: false, reason: check.reason };
    const pigeon = {
      ringNo: input.ringNo.trim(),
      owner: input.owner || "",
      fatherRing: input.fatherRing || "",
      motherRing: input.motherRing || "",
      color: input.color || "",
      requiredVentilation,
      loft: input.loft,
      reviewStatus: null,
      vaccines: [],
      transfers: [],
      races: []
    };
    db.pigeons.unshift(pigeon);
    recomputeLoftStates(db);
    return { ok: true, pigeon };
  });
}

export function createLoft(input) {
  return mutate(async db => {
    const name = (input.name || "").trim();
    if (!name) return { ok: false, reason: "loft_name_required" };
    if (db.lofts.some(l => l.name === name)) return { ok: false, reason: "loft_exists" };
    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 0) return { ok: false, reason: "capacity_invalid" };
    if (!VENTILATION_GRADES.includes(input.ventilation)) return { ok: false, reason: "ventilation_invalid" };
    const status = input.status || "active";
    if (!LOFT_STATUSES.includes(status)) return { ok: false, reason: "status_invalid" };
    const loft = { name, capacity, ventilation: input.ventilation, status };
    db.lofts.push(loft);
    return { ok: true, loft };
  });
}

// 调整鸽棚：调低容量可能使棚超配，由 recomputeLoftStates 冻结未完成迁入并标记在棚档案待复核
export function updateLoft(name, patch) {
  return mutate(async db => {
    const loft = db.lofts.find(l => l.name === name);
    if (!loft) return { ok: false, reason: "loft_not_found", notFound: true };
    if (patch.capacity !== undefined) {
      const capacity = Number(patch.capacity);
      if (!Number.isInteger(capacity) || capacity < 0) return { ok: false, reason: "capacity_invalid" };
      loft.capacity = capacity;
    }
    if (patch.status !== undefined) {
      if (!LOFT_STATUSES.includes(patch.status)) return { ok: false, reason: "status_invalid" };
      loft.status = patch.status;
    }
    if (patch.ventilation !== undefined) {
      if (!VENTILATION_GRADES.includes(patch.ventilation)) return { ok: false, reason: "ventilation_invalid" };
      loft.ventilation = patch.ventilation;
    }
    const changes = recomputeLoftStates(db);
    return { ok: true, loft, changes };
  });
}

// 迁入申请：同一 requestId 只采用首次结果（含拒绝结果），重复/并发直接回放
export function requestMoveIn({ requestId, ringNo, toLoft }) {
  return mutate(async db => {
    if (!requestId) return { ok: false, reason: "request_id_required" };
    const existing = db.moveIns.find(m => m.requestId === requestId);
    if (existing) {
      return { ok: existing.status !== "rejected", deduplicated: true, moveIn: withReasonText(existing), reason: existing.reason || undefined };
    }
    const check = evaluateMoveIn(db, { ringNo, toLoft });
    if (check.reason === "pigeon_not_found") return { ok: false, reason: check.reason, notFound: true };
    const now = new Date().toISOString();
    if (!check.ok) {
      // 拒绝也留痕：不改变原归属，仅记录首次判断结果
      const pigeon = db.pigeons.find(p => p.ringNo === ringNo);
      const rejected = { requestId, ringNo, fromLoft: pigeon ? pigeon.loft : null, toLoft, requiredVentilation: pigeon ? pigeon.requiredVentilation : null, status: "rejected", reason: check.reason, createdAt: now, updatedAt: now, completedAt: null };
      db.moveIns.push(rejected);
      return { ok: false, reason: check.reason, moveIn: withReasonText(rejected) };
    }
    const moveIn = { requestId, ringNo, fromLoft: check.pigeon.loft, toLoft, requiredVentilation: check.pigeon.requiredVentilation || "C", status: "pending", reason: null, createdAt: now, updatedAt: now, completedAt: null };
    db.moveIns.push(moveIn);
    recomputeLoftStates(db);
    return { ok: true, moveIn: withReasonText(moveIn) };
  });
}

// 确认迁入：此时才把档案划入目标棚
export function confirmMoveIn(requestId) {
  return mutate(async db => {
    const moveIn = db.moveIns.find(m => m.requestId === requestId);
    if (!moveIn) return { ok: false, reason: "move_in_not_found", notFound: true };
    const reason = evaluateConfirm(db, moveIn);
    if (reason) return { ok: false, reason };
    const pigeon = db.pigeons.find(p => p.ringNo === moveIn.ringNo);
    if (!pigeon) return { ok: false, reason: "pigeon_not_found", notFound: true };
    const now = new Date().toISOString();
    moveIn.status = "completed";
    moveIn.completedAt = now;
    moveIn.updatedAt = now;
    pigeon.loft = moveIn.toLoft;
    const changes = recomputeLoftStates(db);
    return { ok: true, moveIn: withReasonText(moveIn), pigeon, changes };
  });
}

// 取消迁入：释放预留棚位，可能解除超配
export function cancelMoveIn(requestId) {
  return mutate(async db => {
    const moveIn = db.moveIns.find(m => m.requestId === requestId);
    if (!moveIn) return { ok: false, reason: "move_in_not_found", notFound: true };
    if (moveIn.status !== "pending" && moveIn.status !== "frozen") return { ok: false, reason: "move_in_closed" };
    moveIn.status = "cancelled";
    moveIn.updatedAt = new Date().toISOString();
    const changes = recomputeLoftStates(db);
    return { ok: true, moveIn: withReasonText(moveIn), changes };
  });
}

// 既有履历记录：转让、归巢成绩、疫苗
export function addPigeonRecord(ringNo, kind, input) {
  return mutate(async db => {
    const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
    if (!pigeon) return { ok: false, reason: "pigeon_not_found", notFound: true };
    const today = new Date().toISOString().slice(0, 10);
    if (kind === "transfers") {
      pigeon.transfers.push({ date: input.date || today, from: pigeon.owner, to: input.to });
      pigeon.owner = input.to;
    }
    if (kind === "races") pigeon.races.push({ date: input.date || today, event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
    if (kind === "vaccines") pigeon.vaccines.push({ date: input.date || today, name: input.name });
    return { ok: true, pigeon };
  });
}
