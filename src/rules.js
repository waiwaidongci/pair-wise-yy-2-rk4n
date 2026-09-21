// 规则判断层：棚位准入、容量占用与超配派生状态。纯函数，不触碰存储与页面。

export const VENTILATION_GRADES = ["C", "B", "A"]; // 通风等级由低到高
export const LOFT_STATUSES = ["active", "disabled"];

export const REASON_TEXT = {
  ring_required: "足环号必填",
  ring_exists: "足环号已存在",
  pigeon_not_found: "鸽只档案不存在",
  loft_required: "档案入棚前必须选择目标鸽棚",
  loft_not_found: "目标鸽棚不存在",
  loft_exists: "鸽棚已存在",
  loft_name_required: "鸽棚名称必填",
  loft_disabled: "目标鸽棚已停用",
  loft_full: "目标鸽棚已满员",
  ventilation_mismatch: "目标鸽棚通风等级不符",
  ventilation_invalid: "通风等级无效",
  status_invalid: "鸽棚状态无效",
  capacity_invalid: "容量必须是非负整数",
  already_in_loft: "该鸽已在目标鸽棚",
  move_in_pending: "该鸽存在未完成的迁入请求",
  move_in_not_found: "迁入请求不存在",
  move_in_closed: "迁入请求已完结，无法操作",
  move_in_frozen: "迁入请求已冻结，请先处理鸽棚超配",
  request_id_required: "缺少迁入请求编号"
};

export function ventilationRank(grade) {
  return VENTILATION_GRADES.indexOf(grade);
}

export function ventilationSatisfies(loftGrade, requiredGrade) {
  return ventilationRank(loftGrade) >= ventilationRank(requiredGrade);
}

// 棚位占用：在棚档案 + 未完结迁入预留（待确认/已冻结都占住棚位）
export function loftOccupancy(db, loftName) {
  const loft = db.lofts.find(item => item.name === loftName) || null;
  const capacity = loft ? loft.capacity : 0;
  const housed = db.pigeons.filter(p => p.loft === loftName).length;
  const reserved = db.moveIns.filter(m => m.toLoft === loftName && (m.status === "pending" || m.status === "frozen")).length;
  const total = housed + reserved;
  return { housed, reserved, total, capacity, free: Math.max(0, capacity - total), overAllocated: total > capacity };
}

// 棚位准入：停用、通风等级不符、满员依次拒绝
function admittance(db, loft, requiredVentilation) {
  if (!loft) return "loft_not_found";
  if (loft.status !== "active") return "loft_disabled";
  if (!ventilationSatisfies(loft.ventilation, requiredVentilation)) return "ventilation_mismatch";
  if (loftOccupancy(db, loft.name).total >= loft.capacity) return "loft_full";
  return null;
}

// 迁入规则：任一不满足即拒绝，调用方保证拒绝时不改变原归属
export function evaluateMoveIn(db, { ringNo, toLoft }) {
  const pigeon = db.pigeons.find(p => p.ringNo === ringNo);
  if (!pigeon) return { ok: false, reason: "pigeon_not_found" };
  const loft = db.lofts.find(l => l.name === toLoft);
  if (!loft) return { ok: false, reason: "loft_not_found" };
  if (pigeon.loft === toLoft) return { ok: false, reason: "already_in_loft" };
  if (db.moveIns.some(m => m.ringNo === ringNo && (m.status === "pending" || m.status === "frozen"))) {
    return { ok: false, reason: "move_in_pending" };
  }
  const reason = admittance(db, loft, pigeon.requiredVentilation || "C");
  return reason ? { ok: false, reason } : { ok: true, pigeon, loft };
}

// 新档案入棚规则：足环唯一 + 棚位准入
export function evaluateNewArchive(db, { ringNo, toLoft, requiredVentilation = "C" }) {
  if (!ringNo) return { ok: false, reason: "ring_required" };
  if (db.pigeons.some(p => p.ringNo === ringNo)) return { ok: false, reason: "ring_exists" };
  if (!toLoft) return { ok: false, reason: "loft_required" };
  const loft = db.lofts.find(l => l.name === toLoft);
  const reason = admittance(db, loft, requiredVentilation);
  return reason ? { ok: false, reason } : { ok: true, loft };
}

// 确认迁入前复核：棚位已预留不再查容量，但棚状态与通风等级仍需有效
export function evaluateConfirm(db, moveIn) {
  if (moveIn.status === "frozen") return "move_in_frozen";
  if (moveIn.status !== "pending") return "move_in_closed";
  const loft = db.lofts.find(l => l.name === moveIn.toLoft);
  if (!loft) return "loft_not_found";
  if (loft.status !== "active") return "loft_disabled";
  if (!ventilationSatisfies(loft.ventilation, moveIn.requiredVentilation)) return "ventilation_mismatch";
  return null;
}

// 容量或占用变化后重算派生状态：
// 超配棚的未完成迁入冻结、在棚档案保留但标记待复核；恢复余量时自动回正。
export function recomputeLoftStates(db) {
  const changes = { frozen: [], resumed: [], marked: [], cleared: [] };
  for (const loft of db.lofts) {
    const over = loftOccupancy(db, loft.name).overAllocated;
    for (const m of db.moveIns.filter(item => item.toLoft === loft.name)) {
      if (over && m.status === "pending") { m.status = "frozen"; m.updatedAt = new Date().toISOString(); changes.frozen.push(m.requestId); }
      if (!over && m.status === "frozen") { m.status = "pending"; m.updatedAt = new Date().toISOString(); changes.resumed.push(m.requestId); }
    }
    for (const p of db.pigeons.filter(item => item.loft === loft.name)) {
      if (over && p.reviewStatus !== "pending_review") { p.reviewStatus = "pending_review"; changes.marked.push(p.ringNo); }
      if (!over && p.reviewStatus === "pending_review") { p.reviewStatus = null; changes.cleared.push(p.ringNo); }
    }
  }
  return changes;
}
