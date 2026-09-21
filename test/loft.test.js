import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../lib/store.js";
import { createService } from "../lib/service.js";

async function makeService() {
  const dir = await mkdtemp(join(tmpdir(), "pigeon-db-"));
  const dbPath = join(dir, "db.json");
  const store = createStore(dbPath);
  return { dbPath, store, service: createService(store) };
}

const loftOf = (state, id) => state.lofts.find(loft => loft.id === id);
const pigeonOf = (state, ringNo) => state.pigeons.find(pigeon => pigeon.ringNo === ringNo);

test("迁入申请先预留棚位，确认后档案入棚、占用转正", async () => {
  const { service } = await makeService();
  const { move, deduped } = await service.requestMoveIn({ requestId: "r-1", ringNo: "CHN-2022-188", toLoftId: "L-001" });
  assert.equal(deduped, false);
  assert.equal(move.status, "pending");

  let state = await service.getState();
  assert.deepEqual(
    { housed: loftOf(state, "L-001").occupancy.housed, reserved: loftOf(state, "L-001").occupancy.reserved },
    { housed: 1, reserved: 1 }
  );
  assert.equal(pigeonOf(state, "CHN-2022-188").loft, "种鸽棚"); // 确认前原归属不变

  const done = await service.confirmMove(move.id);
  assert.equal(done.move.status, "completed");
  state = await service.getState();
  assert.equal(pigeonOf(state, "CHN-2022-188").loft, "北岸A棚");
  assert.deepEqual(
    { housed: loftOf(state, "L-001").occupancy.housed, reserved: loftOf(state, "L-001").occupancy.reserved },
    { housed: 2, reserved: 0 }
  );
});

test("目标棚满员时拒绝且不改变原归属", async () => {
  const { service } = await makeService();
  // 北岸A棚容量 2，已在棚 1；先占掉仅剩的 1 个预留位
  const first = await service.requestMoveIn({ requestId: "r-1", ringNo: "CHN-2022-188", toLoftId: "L-001" });
  assert.equal(first.move.status, "pending");
  // 再申请即满员
  const second = await service.requestMoveIn({ requestId: "r-2", ringNo: "CHN-2023-512", toLoftId: "L-001" });
  assert.equal(second.move.status, "rejected");
  assert.equal(second.move.reason, "loft_full");
  const state = await service.getState();
  assert.equal(pigeonOf(state, "CHN-2023-512").loft, "种鸽棚");
});

test("目标棚停用时拒绝且不改变原归属", async () => {
  const { service } = await makeService();
  const { move } = await service.requestMoveIn({ requestId: "r-1", ringNo: "CHN-2022-188", toLoftId: "L-003" });
  assert.equal(move.status, "rejected");
  assert.equal(move.reason, "loft_disabled");
  const state = await service.getState();
  assert.equal(pigeonOf(state, "CHN-2022-188").loft, "种鸽棚");
});

test("通风等级不符时拒绝且不改变原归属", async () => {
  const { service } = await makeService();
  // CHN-2026-001 需要 A 级通风，种鸽棚只有 B 级
  const { move } = await service.requestMoveIn({ requestId: "r-1", ringNo: "CHN-2026-001", toLoftId: "L-002" });
  assert.equal(move.status, "rejected");
  assert.equal(move.reason, "ventilation_mismatch");
  const state = await service.getState();
  assert.equal(pigeonOf(state, "CHN-2026-001").loft, "北岸A棚");
});

test("同一迁入请求重复提交只采用首次结果", async () => {
  const { service } = await makeService();
  const first = await service.requestMoveIn({ requestId: "same-key", ringNo: "CHN-2022-188", toLoftId: "L-001" });
  const second = await service.requestMoveIn({ requestId: "same-key", ringNo: "CHN-2022-188", toLoftId: "L-001" });
  assert.equal(second.deduped, true);
  assert.equal(second.move.id, first.move.id);
  assert.equal(second.move.status, first.move.status);
  const state = await service.getState();
  assert.equal(state.moves.length, 1);
  assert.equal(loftOf(state, "L-001").occupancy.reserved, 1); // 只预留了一个棚位
});

test("同一迁入请求并发提交只采用首次结果", async () => {
  const { service } = await makeService();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => service.requestMoveIn({ requestId: "race-key", ringNo: "CHN-2022-188", toLoftId: "L-001" }))
  );
  const ids = new Set(results.map(result => result.move.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter(result => result.deduped).length, 4);
  const state = await service.getState();
  assert.equal(state.moves.length, 1);
});

test("并发抢占同一空位时只有一单受理", async () => {
  const { service } = await makeService();
  // 北岸A棚容量 2、在棚 1，只剩 1 个空位
  const [a, b] = await Promise.all([
    service.requestMoveIn({ requestId: "key-a", ringNo: "CHN-2022-188", toLoftId: "L-001" }),
    service.requestMoveIn({ requestId: "key-b", ringNo: "CHN-2023-512", toLoftId: "L-001" })
  ]);
  const statuses = [a.move.status, b.move.status].sort();
  assert.deepEqual(statuses, ["pending", "rejected"]);
  const rejected = [a, b].find(result => result.move.status === "rejected");
  assert.equal(rejected.move.reason, "loft_full");
  const state = await service.getState();
  assert.equal(loftOf(state, "L-001").occupancy.total, 2);
});

test("调低容量：装不下的未完成迁入冻结，超配棚在棚档案保留待复核，重载后同步", async () => {
  const { dbPath, service } = await makeService();
  // 种鸽棚再进 1 羽，在棚达到 3 羽
  await service.createPigeon({ ringNo: "CHN-2026-777", owner: "西棚", color: "灰", loft: "种鸽棚", needVentilation: "C" });
  // 777 申请迁入北岸A棚（在棚 1/2），预留成功
  const pending = await service.requestMoveIn({ requestId: "r-pending", ringNo: "CHN-2026-777", toLoftId: "L-001" });
  assert.equal(pending.move.status, "pending");
  // 北岸A棚容量调到 1：在棚 1 不超配，但预留位装不下 → 迁入冻结
  const shrinkA = await service.updateLoft("L-001", { capacity: 1 });
  assert.equal(shrinkA.overAllocated, false);
  assert.deepEqual(shrinkA.frozen, [pending.move.id]);
  // 种鸽棚容量调到 1：在棚 3 > 1 超配 → 在棚档案保留待复核
  const shrinkB = await service.updateLoft("L-002", { capacity: 1 });
  assert.equal(shrinkB.overAllocated, true);
  let state = await service.getState();
  for (const ringNo of ["CHN-2022-188", "CHN-2023-512", "CHN-2026-777"]) {
    assert.equal(pigeonOf(state, ringNo).review, true);
    assert.equal(pigeonOf(state, ringNo).loft, "种鸽棚"); // 在棚档案保留
  }
  // 重载（模拟重启）后：棚位占用、待迁移清单、单鸽履历保持同步
  const reloaded = createService(createStore(dbPath));
  state = await reloaded.getState();
  assert.equal(loftOf(state, "L-002").occupancy.overAllocated, true);
  assert.equal(pigeonOf(state, "CHN-2022-188").review, true);
  const frozen = state.moves.find(item => item.id === pending.move.id);
  assert.equal(frozen.status, "frozen");
  assert.equal(frozen.reason, "capacity_reduced");
  const pigeon777 = pigeonOf(state, "CHN-2026-777");
  assert.ok(pigeon777.history.some(item => item.type === "move_frozen"));
  assert.ok(pigeon777.history.some(item => item.type === "review_flagged"));
});

test("超配棚的在棚档案可人工复核解除", async () => {
  const { service } = await makeService();
  await service.updateLoft("L-002", { capacity: 1 });
  let state = await service.getState();
  assert.equal(pigeonOf(state, "CHN-2022-188").review, true);
  await service.clearReview("CHN-2022-188");
  state = await service.getState();
  assert.equal(pigeonOf(state, "CHN-2022-188").review, false);
  assert.ok(pigeonOf(state, "CHN-2022-188").history.some(item => item.type === "review_cleared"));
});

test("新建档案入棚前必须占用有效棚位", async () => {
  const { service } = await makeService();
  await assert.rejects(
    service.createPigeon({ ringNo: "CHN-2026-900", owner: "东棚", color: "灰", loft: "北岸B棚" }),
    error => error.code === "loft_disabled"
  );
  await assert.rejects(
    service.createPigeon({ ringNo: "CHN-2026-900", owner: "东棚", color: "灰", loft: "不存在的棚" }),
    error => error.code === "loft_not_found"
  );
  const pigeon = await service.createPigeon({ ringNo: "CHN-2026-900", owner: "东棚", color: "灰", loft: "种鸽棚", needVentilation: "B" });
  assert.equal(pigeon.loft, "种鸽棚");
  const state = await service.getState();
  assert.equal(loftOf(state, "L-002").occupancy.housed, 3);
});
