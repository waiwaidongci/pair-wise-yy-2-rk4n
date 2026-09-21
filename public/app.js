// 页面反馈层：渲染状态、提交操作、把服务端规则结果翻译成可读反馈
const REASON_TEXT = {
  pigeon_not_found: "档案不存在",
  loft_not_found: "目标棚不存在",
  already_in_loft: "档案已在目标棚",
  move_in_progress: "该鸽已有未完成的迁入",
  loft_disabled: "目标棚已停用",
  loft_full: "目标棚已满员",
  ventilation_mismatch: "通风等级不符",
  capacity_reduced: "容量调低，迁入冻结",
  ring_exists: "足环号已存在",
  loft_exists: "棚名已存在",
  missing_fields: "请填写完整信息",
  invalid_capacity: "容量必须是非负整数",
  invalid_status: "状态无效",
  invalid_ventilation: "通风等级无效",
  move_not_found: "迁入单不存在",
  move_not_cancellable: "当前状态不可取消",
  not_found: "资源不存在"
};
const MOVE_STATUS = {
  pending: ["待迁入", "warn"],
  completed: ["已入棚", "ok"],
  rejected: ["已拒绝", "bad"],
  frozen: ["已冻结", "bad"],
  cancelled: ["已取消", ""]
};
const HISTORY_TEXT = {
  created: "建档",
  move_requested: "迁入申请",
  move_completed: "迁入完成",
  move_rejected: "迁入被拒",
  move_frozen: "迁入冻结",
  move_cancelled: "迁入取消",
  review_flagged: "标记待复核",
  review_cleared: "复核解除"
};

let state = { pigeons: [], lofts: [], moves: [] };
let moveRequestId = crypto.randomUUID();

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

async function api(path, options) {
  const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
  const data = await res.json();
  if (!res.ok) throw new Error(REASON_TEXT[data.error] || data.error || "请求失败");
  return data;
}

function feedback(message, kind = "") {
  const box = $("#feedback");
  box.className = `feedback ${kind}`;
  box.textContent = message;
}

function resetRequestId() {
  moveRequestId = crypto.randomUUID();
  $("#reqId").textContent = moveRequestId.slice(0, 8);
}

function fillLoftSelects() {
  const pigeonLoft = $("#pigeonForm").elements.loft;
  const moveLoft = $("#moveForm").elements.toLoftId;
  const keep = [pigeonLoft.value, moveLoft.value];
  pigeonLoft.innerHTML = state.lofts.map(loft =>
    `<option value="${esc(loft.name)}">${esc(loft.name)}（在棚 ${loft.occupancy.housed}/${loft.occupancy.capacity}，${loft.ventilation} 级${loft.status !== "active" ? "，已停用" : ""}）</option>`
  ).join("");
  moveLoft.innerHTML = state.lofts.map(loft =>
    `<option value="${esc(loft.id)}">${esc(loft.name)}（余位 ${Math.max(loft.occupancy.capacity - loft.occupancy.total, 0)}，${loft.ventilation} 级${loft.status !== "active" ? "，已停用" : ""}）</option>`
  ).join("");
  if (keep[0]) pigeonLoft.value = keep[0];
  if (keep[1]) moveLoft.value = keep[1];
}

function renderLofts() {
  $("#lofts").innerHTML = state.lofts.map(loft => {
    const occ = loft.occupancy;
    const reviewing = state.pigeons.filter(pigeon => pigeon.loft === loft.name && pigeon.review).length;
    const pills = [
      loft.status === "active" ? '<span class="pill ok">启用中</span>' : '<span class="pill bad">已停用</span>',
      `<span class="pill">通风 ${loft.ventilation} 级</span>`,
      occ.overAllocated ? '<span class="pill bad">超配</span>' : "",
      reviewing ? `<span class="pill warn">待复核 ${reviewing} 羽</span>` : ""
    ].join("");
    return `<article class="card">
      <h3>${esc(loft.name)}</h3>
      <div>${pills}</div>
      <div class="meta">棚位：在棚 ${occ.housed} / 容量 ${occ.capacity}，迁入预留 ${occ.reserved}</div>
      <div class="row">
        <input type="number" min="0" step="1" value="${occ.capacity}" data-cap="${esc(loft.id)}" aria-label="调整容量">
        <button data-setcap="${esc(loft.id)}">保存容量</button>
      </div>
      <button class="ghost" data-toggle="${esc(loft.id)}" data-status="${loft.status}">${loft.status === "active" ? "停用鸽棚" : "启用鸽棚"}</button>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-setcap]").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.setcap;
    const capacity = Number(document.querySelector(`[data-cap="${id}"]`).value);
    try {
      const result = await api(`/api/lofts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ capacity }) });
      feedback(
        result.overAllocated
          ? `容量已调低：${result.loft.name} 超配（在棚 ${result.occupancy.housed} / 容量 ${result.loft.capacity}），${result.frozen.length} 条未完成迁入已冻结，在棚档案保留待复核`
          : `${result.loft.name} 容量已调整为 ${result.loft.capacity}`,
        result.overAllocated ? "warn" : "ok"
      );
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
  document.querySelectorAll("[data-toggle]").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.toggle;
    try {
      const result = await api(`/api/lofts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: btn.dataset.status === "active" ? "disabled" : "active" })
      });
      const frozenNote = result.frozen.length ? `，${result.frozen.length} 条未完成迁入已冻结` : "";
      feedback(`${result.loft.name} 已${result.loft.status === "active" ? "启用" : "停用"}${frozenNote}`, "ok");
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
}

function moveRow(move) {
  const [label, kind] = MOVE_STATUS[move.status] || [move.status, ""];
  const actions = move.status === "pending"
    ? `<button data-confirm="${esc(move.id)}">确认入棚</button><button class="ghost" data-cancel="${esc(move.id)}">取消</button>`
    : move.status === "frozen"
      ? `<button class="ghost" data-cancel="${esc(move.id)}">取消</button>`
      : "";
  return `<div class="move-row">
    <span class="pill ${kind}">${label}</span>
    <span><b>${esc(move.ringNo)}</b>　${esc(move.fromLoft || "—")} → ${esc(move.toLoftName || move.toLoftId)}</span>
    <span class="meta">${move.reason ? esc(REASON_TEXT[move.reason] || move.reason) : ""}</span>
    <span class="actions">${actions}</span>
  </div>`;
}

function renderMoves() {
  const active = state.moves.filter(move => move.status === "pending" || move.status === "frozen");
  const done = state.moves.filter(move => move.status !== "pending" && move.status !== "frozen").slice(0, 8);
  $("#moves").innerHTML =
    (active.length ? active.map(moveRow).join("") : '<p class="meta">暂无待迁移或冻结的迁入单。</p>') +
    (done.length ? '<h3 class="sub">近期结果</h3>' + done.map(moveRow).join("") : "");
  document.querySelectorAll("[data-confirm]").forEach(btn => btn.onclick = async () => {
    try {
      const { move } = await api(`/api/moves/${encodeURIComponent(btn.dataset.confirm)}/confirm`, { method: "POST" });
      feedback(
        move.status === "completed" ? `${move.ringNo} 已确认入 ${move.toLoftName}，棚位转正` : `确认被拒：${REASON_TEXT[move.reason] || move.reason}，原归属不变`,
        move.status === "completed" ? "ok" : "bad"
      );
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
  document.querySelectorAll("[data-cancel]").forEach(btn => btn.onclick = async () => {
    try {
      await api(`/api/moves/${encodeURIComponent(btn.dataset.cancel)}/cancel`, { method: "POST" });
      feedback("迁入单已取消，预留棚位已释放", "ok");
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
}

function renderCards() {
  $("#cards").innerHTML = state.pigeons.map(pigeon => `
    <article class="card">
      <h3>${esc(pigeon.ringNo)} ${pigeon.review ? '<span class="pill warn">待复核</span>' : ""}</h3>
      <div><span class="pill">${esc(pigeon.owner)}</span><span class="pill">${esc(pigeon.loft)}</span><span class="pill">需通风 ${esc(pigeon.needVentilation)} 级</span></div>
      <div class="meta">${esc(pigeon.color)} · 父：${esc(pigeon.fatherRing || "未登记")} · 母：${esc(pigeon.motherRing || "未登记")}</div>
      ${pigeon.review ? `<button data-review="${esc(pigeon.ringNo)}">复核通过</button>` : ""}
      <details>
        <summary class="meta">履历（${pigeon.history.length}）</summary>
        <ul class="history">${pigeon.history.map(item => `<li><span class="meta">${esc(item.date)}</span> ${HISTORY_TEXT[item.type] || esc(item.type)}：${esc(item.note)}</li>`).join("") || "<li class='meta'>暂无</li>"}</ul>
      </details>
      <label>录入转让</label>
      <div class="row"><input data-to="${esc(pigeon.ringNo)}" placeholder="新归属人"><button data-transfer="${esc(pigeon.ringNo)}">保存</button></div>
      <label>归巢成绩</label>
      <div class="row"><input data-race="${esc(pigeon.ringNo)}" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="${esc(pigeon.ringNo)}">保存</button></div>
    </article>`).join("");
  document.querySelectorAll("[data-review]").forEach(btn => btn.onclick = async () => {
    try {
      await api(`/api/pigeons/${encodeURIComponent(btn.dataset.review)}/review`, { method: "POST" });
      feedback(`${btn.dataset.review} 复核通过，待复核标记已解除`, "ok");
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
  document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
    const ringNo = btn.dataset.transfer;
    const to = document.querySelector(`[data-to="${CSS.escape(ringNo)}"]`).value;
    try {
      await api(`/api/pigeons/${encodeURIComponent(ringNo)}/transfers`, { method: "POST", body: JSON.stringify({ to }) });
      feedback(`${ringNo} 转让已记录`, "ok");
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
  document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
    const ringNo = btn.dataset.score;
    const raw = document.querySelector(`[data-race="${CSS.escape(ringNo)}"]`).value.split("/");
    try {
      await api(`/api/pigeons/${encodeURIComponent(ringNo)}/races`, {
        method: "POST",
        body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) })
      });
      feedback(`${ringNo} 归巢成绩已记录`, "ok");
      await refresh();
    } catch (error) { feedback(error.message, "bad"); }
  });
}

function renderRelation(data) {
  const detail = $("#detail");
  if (!data) {
    detail.innerHTML = '<h2>血统查询</h2><p class="meta">输入足环号查看父母、子代、转让、成绩与履历。</p>';
    return;
  }
  const pigeon = data.pigeon;
  detail.innerHTML = `<h2>${esc(pigeon.ringNo)} 血统档案 ${pigeon.review ? '<span class="pill warn">待复核</span>' : ""}</h2>
    <div class="relation">
      <div class="small"><b>父鸽</b><br>${esc(data.father?.ringNo || pigeon.fatherRing || "未登记")}</div>
      <div class="small"><b>本鸽</b><br>${esc(pigeon.owner)} · ${esc(pigeon.color)} · ${esc(pigeon.loft)}</div>
      <div class="small"><b>母鸽</b><br>${esc(data.mother?.ringNo || pigeon.motherRing || "未登记")}</div>
    </div>
    <div><b>子代</b> ${esc(data.children.map(child => child.ringNo).join("、") || "暂无")}</div>
    <div class="meta">转让：${esc(pigeon.transfers.map(item => `${item.from}→${item.to}`).join(" / ") || "暂无")}</div>
    <div class="meta">归巢：${esc(pigeon.races.map(item => `${item.event} 第${item.rank}名`).join(" / ") || "暂无")}</div>
    <div class="meta">履历：${esc(pigeon.history.map(item => `${item.date} ${item.note}`).join("；") || "暂无")}</div>`;
}

async function refresh() {
  state = await api("/api/state");
  fillLoftSelects();
  renderLofts();
  renderMoves();
  renderCards();
}

$("#pigeonForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  try {
    const pigeon = await api("/api/pigeons", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    feedback(`档案已建立：${pigeon.ringNo} 入 ${pigeon.loft}，占用 1 个棚位`, "ok");
    form.reset();
    await refresh();
  } catch (error) { feedback(error.message, "bad"); }
};

$("#moveForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const ringNo = form.elements.ringNo.value.trim();
  const toLoftId = form.elements.toLoftId.value;
  try {
    const { move, deduped } = await api("/api/moves", { method: "POST", body: JSON.stringify({ requestId: moveRequestId, ringNo, toLoftId }) });
    if (deduped) {
      feedback(`重复/并发请求：已采用首次结果（${move.id}，${MOVE_STATUS[move.status][0]}）`, "warn");
    } else if (move.status === "pending") {
      feedback(`迁入申请 ${move.id} 已受理：${move.ringNo} → ${move.toLoftName}，已预留 1 个棚位，待确认入棚`, "ok");
    } else {
      feedback(`迁入申请被拒：${REASON_TEXT[move.reason] || move.reason}，原归属不变`, "bad");
    }
    resetRequestId();
    await refresh();
  } catch (error) { feedback(error.message, "bad"); }
};
$("#moveForm").elements.ringNo.addEventListener("input", resetRequestId);
$("#moveForm").elements.toLoftId.addEventListener("change", resetRequestId);

$("#loftForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  data.capacity = Number(data.capacity);
  try {
    const loft = await api("/api/lofts", { method: "POST", body: JSON.stringify(data) });
    feedback(`鸽棚 ${loft.name} 已建立（容量 ${loft.capacity}，${loft.ventilation} 级）`, "ok");
    form.reset();
    await refresh();
  } catch (error) { feedback(error.message, "bad"); }
};

$("#searchBtn").onclick = async () => {
  try {
    renderRelation(await api(`/api/pigeons/${encodeURIComponent($("#search").value)}/relation`));
  } catch (error) { feedback(error.message, "bad"); }
};
$("#reload").onclick = refresh;

resetRequestId();
renderRelation(null);
refresh();
