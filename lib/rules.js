// 规则判断层：纯函数，只依赖传入的数据快照，不触碰存储与页面。

export const VENT_RANK = { A: 3, B: 2, C: 1 };
export const VENT_GRADES = ["A", "B", "C"];
export const LOFT_STATUS = ["active", "disabled"];

export const REASON_TEXT = {
  pigeon_not_found: "档案不存在",
  loft_not_found: "目标棚不存在",
  already_in_loft: "档案已在目标棚",
  move_in_progress: "该鸽已有未完成的迁入",
  loft_disabled: "目标棚已停用",
  loft_full: "目标棚已满员",
  ventilation_mismatch: "通风等级不符",
  capacity_reduced: "容量调低，迁入冻结"
};

// 棚通风等级不低于档案所需等级才算符合
export function ventilationOk(loft, pigeon) {
  return (VENT_RANK[loft.ventilation] || 0) >= (VENT_RANK[pigeon.needVentilation || "C"] || 0);
}

// 棚位占用 = 已在棚档案 + 待迁入预留
export function loftOccupancy(db, loftId) {
  const loft = db.lofts.find(item => item.id === loftId);
  if (!loft) return null;
  const housed = db.pigeons.filter(pigeon => pigeon.loft === loft.name).length;
  const reserved = db.moves.filter(move => move.toLoftId === loftId && move.status === "pending").length;
  return {
    housed,
    reserved,
    total: housed + reserved,
    capacity: loft.capacity,
    overAllocated: housed > loft.capacity
  };
}

// 入棚（新建档案直接入棚 / 迁入申请）共用的棚位校验
export function evaluateEntry(db, loft, pigeon) {
  if (!loft) return { ok: false, reason: "loft_not_found" };
  if (loft.status !== "active") return { ok: false, reason: "loft_disabled", loft };
  const occupancy = loftOccupancy(db, loft.id);
  if (occupancy.total >= loft.capacity) return { ok: false, reason: "loft_full", loft };
  if (!ventilationOk(loft, pigeon)) return { ok: false, reason: "ventilation_mismatch", loft };
  return { ok: true, loft };
}

// 迁入申请判定：任何一条不满足都拒绝，调用方保证拒绝时不改变原归属
export function evaluateMoveIn(db, { ringNo, toLoftId }) {
  const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
  const loft = db.lofts.find(item => item.id === toLoftId);
  if (!pigeon) return { ok: false, reason: "pigeon_not_found", loft };
  if (!loft) return { ok: false, reason: "loft_not_found", pigeon };
  if (pigeon.loft === loft.name) return { ok: false, reason: "already_in_loft", pigeon, loft };
  if (db.moves.some(move => move.ringNo === ringNo && move.status === "pending")) {
    return { ok: false, reason: "move_in_progress", pigeon, loft };
  }
  const entry = evaluateEntry(db, loft, pigeon);
  if (!entry.ok) return { ...entry, pigeon };
  return { ok: true, pigeon, loft };
}

// 确认入棚时复核：该迁入单自身已持有预留位，只校验在棚数与棚状态
export function evaluateConfirm(db, move) {
  const pigeon = db.pigeons.find(item => item.ringNo === move.ringNo);
  const loft = db.lofts.find(item => item.id === move.toLoftId);
  if (!pigeon) return { ok: false, reason: "pigeon_not_found", loft };
  if (!loft) return { ok: false, reason: "loft_not_found", pigeon };
  if (loft.status !== "active") return { ok: false, reason: "loft_disabled", pigeon, loft };
  const occupancy = loftOccupancy(db, loft.id);
  if (occupancy.housed >= loft.capacity) return { ok: false, reason: "loft_full", pigeon, loft };
  if (!ventilationOk(loft, pigeon)) return { ok: false, reason: "ventilation_mismatch", pigeon, loft };
  return { ok: true, pigeon, loft };
}

// 容量/状态变更后的连锁判定：
// 装不下的未完成迁入按申请先后冻结；在棚数超过新容量（超配）时，在棚档案保留但转待复核
export function evaluateCapacityChange(db, loftId) {
  const loft = db.lofts.find(item => item.id === loftId);
  if (!loft) return { ok: false, reason: "loft_not_found" };
  const occupancy = loftOccupancy(db, loftId);
  const overAllocated = occupancy.housed > loft.capacity;
  let remaining = loft.capacity - occupancy.housed;
  const pendings = db.moves
    .filter(move => move.toLoftId === loftId && move.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const keep = [];
  const freeze = [];
  for (const move of pendings) {
    if (loft.status === "active" && remaining > 0) {
      keep.push(move);
      remaining -= 1;
    } else {
      freeze.push(move);
    }
  }
  const reviewPigeons = overAllocated ? db.pigeons.filter(pigeon => pigeon.loft === loft.name) : [];
  return { ok: true, loft, overAllocated, keep, freeze, reviewPigeons };
}
