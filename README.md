# 赛鸽血统环号登记站 · 鸽棚容量与迁入复核台

运行：

```bash
npm start
```

访问 `http://localhost:3024`。测试：`npm test`。

## 功能

- **档案入棚先占位**：新建档案必须落入一个有效棚位（棚存在、启用中、有余位、通风等级达标），否则拒绝建档。
- **迁入复核台**：迁入申请先预留棚位（待迁入），确认后档案归属才变更；目标棚满员、停用或通风等级不符时拒绝，且不改变原归属。
- **容量调低连锁处理**：调低容量导致超配（在棚数 > 容量）时，装不下的未完成迁入按申请先后冻结，已在棚档案保留并标记「待复核」，可人工复核解除。
- **幂等迁入**：同一迁入请求（同一 `requestId`）重复或并发提交，只采用首次结果，后续请求原样返回首次结果。
- **重载同步**：棚位占用、待迁移清单和单鸽履历全部持久化在 `data/pigeons.json`，重启或刷新后一致。

## 分层

- `lib/rules.js` — 规则判断：纯函数（棚位占用、入棚校验、容量变更连锁判定）。
- `lib/store.js` — 档案存储：JSON 文件读写、旧数据迁移、串行化写事务（并发不互相覆盖，失败自动回滚内存态）。
- `lib/service.js` — 业务编排：把规则落到存储，迁入请求按 `requestId` 幂等。
- `server.js` — HTTP 路由与静态分发。
- `public/` — 页面反馈：鸽棚看板、待迁移清单、档案卡片与操作反馈。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/state` | 鸽棚（含占用）、档案、迁入单全量状态 |
| POST | `/api/pigeons` | 建档并入棚（校验有效棚位） |
| GET | `/api/pigeons/:ringNo/relation` | 血统查询 |
| POST | `/api/pigeons/:ringNo/review` | 复核通过，解除待复核 |
| POST | `/api/pigeons/:ringNo/transfers|races|vaccines` | 转让 / 成绩 / 免疫记录 |
| GET/POST | `/api/lofts` | 鸽棚列表 / 新建 |
| PATCH | `/api/lofts/:id` | 调整容量、状态、通风等级（触发冻结/待复核） |
| GET/POST | `/api/moves` | 迁入单列表 / 提交迁入申请（`requestId` 幂等） |
| POST | `/api/moves/:id/confirm|cancel` | 确认入棚 / 取消迁入 |
