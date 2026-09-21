// 档案存储层：负责 JSON 文件的读写、旧数据迁移与串行化变更，不做规则判断。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export const seed = {
  pigeons: [
    {
      ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512",
      color: "灰", loft: "北岸A棚", needVentilation: "A", review: false,
      vaccines: [{ date: "2026-04-01", name: "新城疫" }],
      transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }],
      races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }],
      history: [{ date: "2026-04-15", type: "created", note: "档案建立，入北岸A棚（占用 1 个棚位）" }]
    },
    { ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "", color: "雨点", loft: "种鸽棚", needVentilation: "B", review: false, vaccines: [], transfers: [], races: [], history: [] },
    { ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "", color: "红轮", loft: "种鸽棚", needVentilation: "B", review: false, vaccines: [], transfers: [], races: [], history: [] }
  ],
  lofts: [
    { id: "L-001", name: "北岸A棚", capacity: 2, status: "active", ventilation: "A" },
    { id: "L-002", name: "种鸽棚", capacity: 4, status: "active", ventilation: "B" },
    { id: "L-003", name: "北岸B棚", capacity: 1, status: "disabled", ventilation: "C" }
  ],
  moves: []
};

// 旧版数据文件补齐鸽棚、迁入单与档案新字段，保证重载后状态一致
function migrate(db) {
  db.pigeons ??= [];
  db.lofts ??= structuredClone(seed.lofts);
  db.moves ??= [];
  for (const pigeon of db.pigeons) {
    pigeon.vaccines ??= [];
    pigeon.transfers ??= [];
    pigeon.races ??= [];
    pigeon.history ??= [];
    pigeon.needVentilation ??= "C";
    pigeon.review ??= false;
  }
  return db;
}

export function createStore(dbPath) {
  let db = null;
  let queue = Promise.resolve();

  async function save() {
    const tmp = `${dbPath}.tmp`;
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, dbPath);
  }

  async function load() {
    if (db) return db;
    if (existsSync(dbPath)) {
      db = migrate(JSON.parse(await readFile(dbPath, "utf8")));
    } else {
      await mkdir(dirname(dbPath), { recursive: true });
      db = migrate(structuredClone(seed));
      await save();
    }
    return db;
  }

  // 所有变更串行执行：同一时刻只有一个写事务，并发请求不会互相覆盖；
  // 事务抛错时丢弃内存中的脏数据，下次操作从磁盘重新加载
  function mutate(fn) {
    const run = queue.then(async () => {
      await load();
      try {
        const result = await fn(db);
        await save();
        return result;
      } catch (error) {
        db = null;
        throw error;
      }
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async function read(fn) {
    await load();
    return fn(db);
  }

  return { load, read, mutate };
}
