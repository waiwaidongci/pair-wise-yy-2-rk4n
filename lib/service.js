// 业务编排层：把规则判断（rules）落到档案存储（store），迁入请求按 requestId 幂等。
import { evaluateCapacityChange, evaluateConfirm, evaluateEntry, evaluateMoveIn, loftOccupancy, LOFT_STATUS, VENT_GRADES } from "./rules.js";

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

function pushHistory(pigeon, type, note) {
  pigeon.history.push({ date: today(), type, note });
}

export function createService(store) {
  async function getState() {
    return store.read(db => ({
      pigeons: db.pigeons,
      lofts: db.lofts.map(loft => ({ ...loft, occupancy: loftOccupancy(db, loft.id) })),
      moves: [...db.moves].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    }));
  }

  // 新建档案：入棚前必须先占用一个有效棚位，否则拒绝建档
  async function createPigeon(input) {
    return store.mutate(db => {
      const ringNo = String(input.ringNo || "").trim();
      if (!ringNo) throw new ApiError(400, "missing_fields");
      if (db.pigeons.some(pigeon => pigeon.ringNo === ringNo)) throw new ApiError(409, "ring_exists");
      const loft = db.lofts.find(item => item.name === input.loft);
      const pigeon = {
        ringNo,
        owner: String(input.owner || "").trim(),
        fatherRing: String(input.fatherRing || "").trim(),
        motherRing: String(input.motherRing || "").trim(),
        color: String(input.color || "").trim(),
        loft: loft ? loft.name : String(input.loft || "").trim(),
        needVentilation: VENT_GRADES.includes(input.needVentilation) ? input.needVentilation : "C",
        review: false,
        vaccines: [], transfers: [], races: [], history: []
      };
      const verdict = evaluateEntry(db, loft, pigeon);
      if (!verdict.ok) throw new ApiError(422, verdict.reason);
      db.pigeons.unshift(pigeon);
      pushHistory(pigeon, "created", `档案建立，入${loft.name}（占用 1 个棚位）`);
      return pigeon;
    });
  }

  // 迁入申请：同一 requestId 的重复/并发请求只采用首次结果
  async function requestMoveIn(input) {
    const requestId = String(input.requestId || "").trim();
    const ringNo = String(input.ringNo || "").trim();
    const toLoftId = String(input.toLoftId || "").trim();
    if (!requestId || !ringNo || !toLoftId) throw new ApiError(400, "missing_fields");
    return store.mutate(db => {
      const existing = db.moves.find(move => move.requestId === requestId);
      if (existing) return { move: existing, deduped: true };
      const verdict = evaluateMoveIn(db, { ringNo, toLoftId });
      const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
      const move = {
        id: `M-${String(db.moves.length + 1).padStart(4, "0")}`,
        requestId,
        ringNo,
        fromLoft: pigeon ? pigeon.loft : "",
        toLoftId,
        toLoftName: verdict.loft ? verdict.loft.name : "",
        status: verdict.ok ? "pending" : "rejected",
        reason: verdict.ok ? null : verdict.reason,
        createdAt: now(),
        updatedAt: now()
      };
      db.moves.push(move);
      if (pigeon) {
        pushHistory(
          pigeon,
          verdict.ok ? "move_requested" : "move_rejected",
          verdict.ok
            ? `申请迁入${move.toLoftName}，预留 1 个棚位，待确认`
            : `申请迁入${move.toLoftName || toLoftId}被拒：${verdict.reason}，原归属不变`
        );
      }
      return { move, deduped: false };
    });
  }

  // 确认入棚：预留位转正，档案归属变更；复核不通过则拒绝且原归属不变
  async function confirmMove(id) {
    return store.mutate(db => {
      const move = db.moves.find(item => item.id === id);
      if (!move) throw new ApiError(404, "move_not_found");
      if (move.status !== "pending") return { move, unchanged: true };
      const verdict = evaluateConfirm(db, move);
      if (!verdict.ok) {
        move.status = "rejected";
        move.reason = verdict.reason;
        move.updatedAt = now();
        if (verdict.pigeon) pushHistory(verdict.pigeon, "move_rejected", `确认迁入${move.toLoftName}被拒：${verdict.reason}，原归属不变`);
        return { move, unchanged: false };
      }
      const { pigeon, loft } = verdict;
      move.status = "completed";
      move.updatedAt = now();
      pigeon.loft = loft.name;
      if (pigeon.review) {
        pigeon.review = false;
        pushHistory(pigeon, "review_cleared", `迁入${loft.name}，待复核自动解除`);
      }
      pushHistory(pigeon, "move_completed", `自${move.fromLoft || "未登记"}迁入${loft.name}`);
      return { move, unchanged: false };
    });
  }

  async function cancelMove(id) {
    return store.mutate(db => {
      const move = db.moves.find(item => item.id === id);
      if (!move) throw new ApiError(404, "move_not_found");
      if (!["pending", "frozen"].includes(move.status)) throw new ApiError(409, "move_not_cancellable");
      move.status = "cancelled";
      move.updatedAt = now();
      const pigeon = db.pigeons.find(item => item.ringNo === move.ringNo);
      if (pigeon) pushHistory(pigeon, "move_cancelled", `迁入${move.toLoftName}取消，释放预留棚位`);
      return move;
    });
  }

  // 调整容量/状态/通风：调低容量导致超配时，冻结装不下的未完成迁入，在棚档案保留待复核
  async function updateLoft(id, patch) {
    return store.mutate(db => {
      const loft = db.lofts.find(item => item.id === id);
      if (!loft) throw new ApiError(404, "loft_not_found");
      if (patch.capacity !== undefined) {
        const capacity = Number(patch.capacity);
        if (!Number.isInteger(capacity) || capacity < 0) throw new ApiError(400, "invalid_capacity");
        loft.capacity = capacity;
      }
      if (patch.status !== undefined) {
        if (!LOFT_STATUS.includes(patch.status)) throw new ApiError(400, "invalid_status");
        loft.status = patch.status;
      }
      if (patch.ventilation !== undefined) {
        if (!VENT_GRADES.includes(patch.ventilation)) throw new ApiError(400, "invalid_ventilation");
        loft.ventilation = patch.ventilation;
      }
      const plan = evaluateCapacityChange(db, id);
      for (const move of plan.freeze) {
        move.status = "frozen";
        move.reason = "capacity_reduced";
        move.updatedAt = now();
        const pigeon = db.pigeons.find(item => item.ringNo === move.ringNo);
        if (pigeon) pushHistory(pigeon, "move_frozen", `目标棚${loft.name}超配或停用，迁入冻结`);
      }
      if (plan.overAllocated) {
        for (const pigeon of plan.reviewPigeons) {
          if (!pigeon.review) {
            pigeon.review = true;
            pushHistory(pigeon, "review_flagged", `${loft.name}容量调至 ${loft.capacity}，超配保留待复核`);
          }
        }
      }
      return { loft, frozen: plan.freeze.map(move => move.id), overAllocated: plan.overAllocated, occupancy: loftOccupancy(db, id) };
    });
  }

  async function createLoft(input) {
    return store.mutate(db => {
      const name = String(input.name || "").trim();
      const capacity = Number(input.capacity);
      if (!name || !Number.isInteger(capacity) || capacity < 0) throw new ApiError(400, "missing_fields");
      if (db.lofts.some(loft => loft.name === name)) throw new ApiError(409, "loft_exists");
      const loft = {
        id: `L-${String(db.lofts.length + 1).padStart(3, "0")}`,
        name,
        capacity,
        status: "active",
        ventilation: VENT_GRADES.includes(input.ventilation) ? input.ventilation : "C"
      };
      db.lofts.push(loft);
      return loft;
    });
  }

  async function clearReview(ringNo) {
    return store.mutate(db => {
      const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
      if (!pigeon) throw new ApiError(404, "pigeon_not_found");
      pigeon.review = false;
      pushHistory(pigeon, "review_cleared", "人工复核通过");
      return pigeon;
    });
  }

  async function appendRecord(ringNo, kind, input) {
    return store.mutate(db => {
      const pigeon = db.pigeons.find(item => item.ringNo === ringNo);
      if (!pigeon) throw new ApiError(404, "pigeon_not_found");
      if (kind === "transfers") {
        pigeon.transfers.push({ date: input.date || today(), from: pigeon.owner, to: input.to });
        pigeon.owner = input.to;
      }
      if (kind === "races") {
        pigeon.races.push({ date: input.date || today(), event: input.event, distance: Number(input.distance || 0), returnTime: input.returnTime || "", rank: Number(input.rank || 0) });
      }
      if (kind === "vaccines") pigeon.vaccines.push({ date: input.date || today(), name: input.name });
      return pigeon;
    });
  }

  return { getState, createPigeon, requestMoveIn, confirmMove, cancelMove, updateLoft, createLoft, clearReview, appendRecord };
}
