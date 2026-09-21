// 页面反馈层：容量面板、迁入复核台、待复核清单与档案血统视图。
export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站 · 鸽棚容量与迁入复核台</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2f6b4f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:15px; }
    main { display:grid; grid-template-columns:400px 1fr; gap:22px; padding:22px 28px; align-items:start; }
    aside { display:grid; gap:16px; align-content:start; }
    form,.panel,.card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button[disabled] { opacity:.45; cursor:not-allowed; } button.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
    form button[type=submit],form > button { margin-top:14px; width:100%; }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; align-content:start; } .card.over { border-color:var(--red); }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.bad { background:#f7e8e6; border-color:#e0b7b1; color:var(--red); } .pill.ok { background:#e8f2ea; border-color:#b9d8c0; color:var(--green); }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .msg { padding:10px 14px; border-radius:8px; background:#e8f2ea; border:1px solid #b9d8c0; color:var(--green); margin-bottom:14px; }
    .msg.err { background:#f7e8e6; border-color:#e0b7b1; color:var(--red); }
    .bar { height:8px; background:#e6ebf0; border-radius:999px; overflow:hidden; } .fill { height:100%; background:var(--accent); } .over .fill { background:var(--red); }
    .row { display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center; }
    .rowline { display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-bottom:1px solid var(--line); align-items:center; }
    .rowline:last-child { border-bottom:0; } .actions { display:flex; gap:8px; flex-shrink:0; } .actions button { padding:7px 10px; }
    code { background:#f0f3f6; padding:2px 6px; border-radius:4px; font-size:12px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统环号登记站</h1><div class="meta">鸽棚容量 · 迁入复核 · 档案血统</div></div><button id="reload">刷新</button></header>
  <main>
    <aside>
      <form id="createForm">
        <h2>创建鸽只档案</h2>
        <label>足环号</label><input name="ringNo" required>
        <label>鸽主</label><input name="owner" required>
        <label>父鸽足环号</label><input name="fatherRing">
        <label>母鸽足环号</label><input name="motherRing">
        <label>羽色</label><input name="color" required>
        <label>所需通风等级</label><select name="requiredVentilation"><option value="C">C（普通）</option><option value="B">B（良好）</option><option value="A">A（强制通风）</option></select>
        <label>入棚鸽棚</label><select name="loft" id="newLoft" required></select>
        <button type="submit">保存档案并入棚</button>
      </form>
      <form id="moveForm">
        <h2>申请迁入</h2>
        <label>足环号</label><input name="ringNo" list="ringList" required>
        <datalist id="ringList"></datalist>
        <label>目标鸽棚</label><select name="toLoft" id="moveLoft" required></select>
        <div class="meta" style="margin-top:10px">请求编号 <code id="reqId"></code>（重复提交只采用首次结果）</div>
        <button type="submit">提交迁入申请</button>
      </form>
      <form id="loftForm">
        <h2>新建鸽棚</h2>
        <label>棚名</label><input name="name" required>
        <label>容量</label><input name="capacity" type="number" min="0" step="1" value="10" required>
        <label>通风等级</label><select name="ventilation"><option value="C">C（普通）</option><option value="B">B（良好）</option><option value="A">A（强制通风）</option></select>
        <label>状态</label><select name="status"><option value="active">启用</option><option value="disabled">停用</option></select>
        <button type="submit">保存鸽棚</button>
      </form>
    </aside>
    <section>
      <div class="msg" id="msg" hidden></div>
      <div class="panel"><h2>鸽棚容量</h2><div class="grid" id="lofts"></div></div>
      <div class="panel section"><h2>迁入复核台</h2><div id="moveQueue"></div><h3 style="margin-top:14px">迁入记录</h3><div id="moveLog"></div></div>
      <div class="panel section"><h2>待复核档案</h2><div id="reviewList"></div></div>
      <div class="toolbar section"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>
  </main>
  <script>
    const $ = s => document.querySelector(s);
    const MOVE_STATUS = { pending:"待确认", frozen:"已冻结", completed:"已完成", cancelled:"已取消", rejected:"已拒绝" };
    const LOFT_STATUS = { active:"启用", disabled:"停用" };
    let state = { lofts: [], pigeons: [], moveIns: [] };
    let moveRequestId = newRequestId();

    function newRequestId() {
      return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "req-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }
    function showRequestId() { $("#reqId").textContent = moveRequestId.slice(0, 8); }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) { const err = new Error(data.message || data.error || "请求失败"); err.data = data; throw err; }
      return data;
    }
    function showMsg(text, isError) {
      const el = $("#msg");
      el.hidden = false;
      el.textContent = text;
      el.className = "msg" + (isError ? " err" : "");
    }
    function changeSummary(ch) {
      if (!ch) return "";
      const parts = [];
      if (ch.frozen && ch.frozen.length) parts.push("冻结迁入 " + ch.frozen.length + " 条");
      if (ch.resumed && ch.resumed.length) parts.push("恢复迁入 " + ch.resumed.length + " 条");
      if (ch.marked && ch.marked.length) parts.push("标记待复核 " + ch.marked.length + " 羽");
      if (ch.cleared && ch.cleared.length) parts.push("解除待复核 " + ch.cleared.length + " 羽");
      return parts.join("，");
    }
    function fmtTime(iso) { return iso ? iso.slice(0, 19).replace("T", " ") : ""; }

    function loftOptions(selected) {
      return state.lofts.map(l => '<option value="' + l.name + '"' + (l.name === selected ? " selected" : "") + '>' + l.name + '（' + LOFT_STATUS[l.status] + ' · 通风' + l.ventilation + ' · 余' + l.occupancy.free + '）</option>').join("");
    }
    function renderLofts() {
      $("#lofts").innerHTML = state.lofts.map(l => {
        const o = l.occupancy;
        const pct = o.capacity > 0 ? Math.min(100, Math.round(o.total / o.capacity * 100)) : (o.total > 0 ? 100 : 0);
        return '<article class="card' + (o.overAllocated ? " over" : "") + '">'
          + '<h3>' + l.name + '</h3>'
          + '<div><span class="pill' + (l.status === "active" ? " ok" : " bad") + '">' + LOFT_STATUS[l.status] + '</span> <span class="pill">通风 ' + l.ventilation + '</span>' + (o.overAllocated ? ' <span class="pill bad">超配</span>' : "") + '</div>'
          + '<div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>'
          + '<div class="meta">在棚 ' + o.housed + ' · 迁入预留 ' + o.reserved + ' · 空余 ' + o.free + ' / 容量 ' + o.capacity + '</div>'
          + '<div class="row"><input type="number" min="0" step="1" value="' + l.capacity + '" data-cap="' + l.name + '"><button data-savecap="' + l.name + '">保存容量</button></div>'
          + '<div class="row"><select data-status="' + l.name + '"><option value="active"' + (l.status === "active" ? " selected" : "") + '>启用</option><option value="disabled"' + (l.status === "disabled" ? " selected" : "") + '>停用</option></select>'
          + '<select data-vent="' + l.name + '"><option value="A"' + (l.ventilation === "A" ? " selected" : "") + '>通风 A</option><option value="B"' + (l.ventilation === "B" ? " selected" : "") + '>通风 B</option><option value="C"' + (l.ventilation === "C" ? " selected" : "") + '>通风 C</option></select></div>'
          + '</article>';
      }).join("");
      document.querySelectorAll("[data-savecap]").forEach(btn => btn.onclick = () => {
        const name = btn.dataset.savecap;
        updateLoft(name, { capacity: Number(document.querySelector('[data-cap="' + name + '"]').value) });
      });
      document.querySelectorAll("[data-status]").forEach(sel => sel.onchange = () => updateLoft(sel.dataset.status, { status: sel.value }));
      document.querySelectorAll("[data-vent]").forEach(sel => sel.onchange = () => updateLoft(sel.dataset.vent, { ventilation: sel.value }));
    }
    function renderMoveIns() {
      const active = state.moveIns.filter(m => m.status === "pending" || m.status === "frozen");
      const closed = state.moveIns.filter(m => m.status !== "pending" && m.status !== "frozen").slice().reverse();
      $("#moveQueue").innerHTML = active.length ? active.map(m =>
        '<div class="rowline"><div><b>' + m.ringNo + '</b>　' + m.fromLoft + ' → ' + m.toLoft
        + ' <span class="pill' + (m.status === "frozen" ? " bad" : "") + '">' + MOVE_STATUS[m.status] + '</span>'
        + '<div class="meta">' + fmtTime(m.createdAt) + ' · 编号 ' + m.requestId.slice(0, 8) + '</div></div>'
        + '<div class="actions"><button data-confirm="' + m.requestId + '"' + (m.status === "frozen" ? " disabled" : "") + '>确认迁入</button><button class="ghost" data-cancel="' + m.requestId + '">取消</button></div></div>'
      ).join("") : '<p class="meta">暂无待处理迁入。</p>';
      $("#moveLog").innerHTML = closed.length ? closed.map(m =>
        '<div class="rowline"><div><b>' + m.ringNo + '</b>　' + (m.fromLoft || "？") + ' → ' + m.toLoft
        + ' <span class="pill' + (m.status === "rejected" ? " bad" : "") + '">' + MOVE_STATUS[m.status] + '</span>'
        + (m.reasonText ? ' <span class="meta">（' + m.reasonText + '）</span>' : "")
        + '<div class="meta">' + fmtTime(m.updatedAt) + ' · 编号 ' + m.requestId.slice(0, 8) + '</div></div></div>'
      ).join("") : '<p class="meta">暂无记录。</p>';
      document.querySelectorAll("[data-confirm]").forEach(btn => btn.onclick = async () => {
        try {
          const r = await api("/api/move-ins/" + encodeURIComponent(btn.dataset.confirm) + "/confirm", { method: "POST" });
          showMsg("迁入已确认，" + r.pigeon.ringNo + " 已入 " + r.moveIn.toLoft + "。");
        } catch (e) { showMsg(e.message, true); }
        await load();
      });
      document.querySelectorAll("[data-cancel]").forEach(btn => btn.onclick = async () => {
        try {
          const r = await api("/api/move-ins/" + encodeURIComponent(btn.dataset.cancel) + "/cancel", { method: "POST" });
          const extra = changeSummary(r.changes);
          showMsg("迁入已取消，预留棚位已释放。" + (extra ? " " + extra + "。" : ""));
        } catch (e) { showMsg(e.message, true); }
        await load();
      });
    }
    function renderReview() {
      const review = state.pigeons.filter(p => p.reviewStatus === "pending_review");
      $("#reviewList").innerHTML = review.length ? review.map(p =>
        '<div class="rowline"><div><b>' + p.ringNo + '</b> · ' + p.loft + ' <span class="pill bad">待复核</span>'
        + '<div class="meta">所在棚已超配，档案保留在棚，请通过调高容量、取消迁入或迁出来处理。</div></div></div>'
      ).join("") : '<p class="meta">暂无待复核档案。</p>';
    }
    function renderCards() {
      $("#cards").innerHTML = state.pigeons.map(p =>
        '<article class="card"><h3>' + p.ringNo + '</h3>'
        + '<div><span class="pill">' + p.owner + '</span> <span class="pill">通风需求 ' + p.requiredVentilation + '</span>' + (p.reviewStatus === "pending_review" ? ' <span class="pill bad">待复核</span>' : "") + '</div>'
        + '<div class="meta">' + p.color + ' · ' + p.loft + '</div>'
        + '<div>父：' + (p.fatherRing || "未登记") + '</div><div>母：' + (p.motherRing || "未登记") + '</div>'
        + '<label>录入转让</label><input data-to="' + p.ringNo + '" placeholder="新归属人"><button data-transfer="' + p.ringNo + '">保存转让</button>'
        + '<label>归巢成绩</label><input data-race="' + p.ringNo + '" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="' + p.ringNo + '">保存成绩</button></article>'
      ).join("");
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer;
        const to = document.querySelector('[data-to="' + ringNo + '"]').value;
        try { await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/transfers", { method: "POST", body: JSON.stringify({ to }) }); showMsg("转让已保存。"); } catch (e) { showMsg(e.message, true); }
        await load();
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score;
        const raw = document.querySelector('[data-race="' + ringNo + '"]').value.split("/");
        try { await api("/api/pigeons/" + encodeURIComponent(ringNo) + "/races", { method: "POST", body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) }); showMsg("成绩已保存。"); } catch (e) { showMsg(e.message, true); }
        await load();
      });
    }
    function renderRelation(data) {
      const detail = $("#detail");
      if (!data) { detail.innerHTML = "<h2>血统查询</h2><p class=\\"meta\\">请输入足环号查看父母、子代、迁入履历、转让和成绩。</p>"; return; }
      const p = data.pigeon;
      detail.innerHTML = "<h2>" + p.ringNo + " 血统档案</h2>"
        + '<div class="relation"><div class="small"><b>父鸽</b><br>' + (data.father ? data.father.ringNo : p.fatherRing || "未登记") + '</div><div class="small"><b>本鸽</b><br>' + p.owner + " · " + p.color + " · " + p.loft + (p.reviewStatus === "pending_review" ? ' <span class="pill bad">待复核</span>' : "") + '</div><div class="small"><b>母鸽</b><br>' + (data.mother ? data.mother.ringNo : p.motherRing || "未登记") + "</div></div>"
        + "<div><b>子代</b> " + (data.children.map(c => c.ringNo).join("、") || "暂无") + "</div>"
        + '<div class="meta">迁入履历：' + (data.moveIns.length ? data.moveIns.map(m => (m.fromLoft || "？") + "→" + m.toLoft + "（" + MOVE_STATUS[m.status] + (m.reasonText ? "·" + m.reasonText : "") + "）").join(" / ") : "暂无") + "</div>"
        + '<div class="meta">转让：' + (p.transfers.map(t => t.from + "→" + t.to).join(" / ") || "暂无") + "</div>"
        + '<div class="meta">归巢：' + (p.races.map(r => r.event + " 第" + r.rank + "名").join(" / ") || "暂无") + "</div>";
    }
    function renderForms() {
      $("#newLoft").innerHTML = loftOptions();
      $("#moveLoft").innerHTML = loftOptions();
      $("#ringList").innerHTML = state.pigeons.map(p => '<option value="' + p.ringNo + '">' + p.loft + "</option>").join("");
    }
    function renderAll() { renderForms(); renderLofts(); renderMoveIns(); renderReview(); renderCards(); }
    async function load() {
      state = await api("/api/state");
      renderAll();
    }
    async function updateLoft(name, patch) {
      try {
        const r = await api("/api/lofts/" + encodeURIComponent(name), { method: "PATCH", body: JSON.stringify(patch) });
        const extra = changeSummary(r.changes);
        showMsg("鸽棚已更新。" + (extra ? " " + extra + "。" : ""));
      } catch (e) { showMsg(e.message, true); }
      await load();
    }

    $("#createForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.target;
      try {
        const r = await api("/api/pigeons", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        showMsg("档案已创建，" + r.ringNo + " 已占用 " + r.loft + " 一个棚位。");
        form.reset();
      } catch (e) { showMsg("入棚被拒绝：" + e.message, true); }
      await load();
    };
    $("#loftForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.target;
      try {
        const r = await api("/api/lofts", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        showMsg("鸽棚 " + r.name + " 已保存。");
        form.reset();
      } catch (e) { showMsg(e.message, true); }
      await load();
    };
    $("#moveForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.target;
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      const payload = JSON.stringify({ requestId: moveRequestId, ringNo: form.ringNo.value.trim(), toLoft: form.toLoft.value });
      let answered = false;
      try {
        const res = await fetch("/api/move-ins", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
        const data = await res.json();
        answered = true;
        if (res.ok) showMsg((data.deduplicated ? "重复请求，已采用首次结果。" : "") + "迁入申请已受理，等待确认。");
        else showMsg((data.deduplicated ? "重复请求，维持首次结果。" : "") + "迁入被拒绝：" + (data.message || data.error), true);
      } catch (e) {
        showMsg("网络异常，可原样重试（请求编号不变）。", true);
      }
      btn.disabled = false;
      if (answered) { moveRequestId = newRequestId(); showRequestId(); form.reset(); }
      await load();
    };
    $("#searchBtn").onclick = async () => {
      try { renderRelation(await api("/api/pigeons/" + encodeURIComponent($("#search").value.trim()) + "/relation")); }
      catch (e) { showMsg(e.message, true); renderRelation(null); }
    };
    $("#reload").onclick = load;
    showRequestId();
    renderRelation(null);
    load();
  </script>
</body>
</html>`;
