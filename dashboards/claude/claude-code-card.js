/*
 * claude-code-card — hạn mức 2 tài khoản Claude Code (gói thuê bao) + chi phí/token API Console, một card toàn trang.
 * Dữ liệu:
 *   sensor.claude_<tk>_*      integration HACS hass_claude_usage (5 phút/lần): session_usage, week_usage,
 *                             weekly_<model>_limit_usage (tự nhận mọi model có hạn mức riêng), *_reset_time,
 *                             week_usage_pace (= % đã dùng − % thời gian tuần đã trôi), api_error
 *   sensor.claude_api_<tk>_*  packages/62_claude_api_console.yaml (Admin API, 10 phút/lần)
 *   Lịch sử: WS history/history_during_period (7 ngày tuần, 2 ngày phiên), tải lại 10 phút/lần.
 * Bảng màu: palette-axi generate --seed "#d97757" --mode dark --roles primary,acc1=295,acc2=195,ok,warn,bad (7/7 quy tắc).
 *   Màu tài khoản (acc1/acc2) chỉ để nhận diện; mức đầy dùng ok/warn/bad (<60 / <85 / ≥85 %).
 *
 * Cấu hình:
 *   type: custom:claude-code-card
 *   accounts: [{slug: vonupt, name: Vonupt}, {slug: vokupt, name: Vokupt}]
 */
const ACC = ["var(--acc1)", "var(--acc2)"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const muc = (p) => (p === null ? "var(--dim)" : p >= 85 ? "var(--bad)" : p >= 60 ? "var(--warn)" : "var(--ok)");
const fmtPct = (p) => (p === null ? "—" : `${Math.round(p)}`);
const fmtUsd = (v) => (v === null ? "—" : v.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtTok = (v) => {
  if (v === null) return "—";
  if (v >= 1e6) return `${(v / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tr`;
  if (v >= 1e3) return `${(v / 1e3).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} k`;
  return v.toLocaleString("vi-VN");
};
const pad = (n) => String(n).padStart(2, "0");
// Mốc reset → {con: "4 ngày 22 giờ", luc: "20:00 T4 05/11"}; null khi chưa có cửa sổ
const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
function dem(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || isNaN(t)) return null;
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const con = s === 0 ? "đã reset" : d ? `${d} ngày ${h} giờ` : h ? `${h} giờ ${m} phút` : `${m} phút`;
  return { con, luc: `${pad(t.getHours())}:${pad(t.getMinutes())} ${THU[t.getDay()]} ${pad(t.getDate())}/${pad(t.getMonth() + 1)}` };
}

const CSS = `
:host {
  color-scheme: dark;
  /* hex = bản đã kẹp vào sRGB (oklch làm tròn 3 số lệch nhẹ ra ngoài gamut) */
  --bg-edge: #110705; --bg: #1e0c06; --surface: #2b150d; --glow: #3a190f; --border: #4e2f24;
  --dim: #d4ada0; --fg: #f2e5e1; --primary: #ff9573; --acc1: #bba4ff; --acc2: #00c4c5;
  --ok: #11cb60; --warn: #eea200; --bad: #ff938b;
  --track: color-mix(in oklch, var(--border) 70%, transparent);
  display: block;
}
* { box-sizing: border-box; }
.trang {
  min-height: 100%; color: var(--fg); font: 400 14px/1.5 var(--ha-font-family-body, system-ui, sans-serif);
  background: radial-gradient(120% 140% at 0% 0%, var(--glow) 0%, var(--bg) 55%, var(--bg-edge) 100%);
  padding: clamp(16px, 3vw, 32px); display: flex; flex-direction: column; gap: 20px;
  font-variant-numeric: tabular-nums;
}
header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h1 { margin: 0; font-size: clamp(1.5rem, 2.6vw, 2rem); font-weight: 650; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
h1 .logo { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
  background: color-mix(in oklch, var(--primary) 18%, transparent); color: var(--primary); }
.phu { color: var(--dim); font-size: 0.85rem; }
.luoi { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px; }
.the {
  background: color-mix(in oklch, var(--surface) 82%, transparent); border: 1px solid var(--border);
  border-radius: 20px; padding: 20px; display: flex; flex-direction: column; gap: 18px; min-width: 0;
  backdrop-filter: blur(8px);
}
.dau { display: flex; align-items: center; gap: 10px; }
.cham { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 4px color-mix(in oklch, var(--c) 22%, transparent); }
.ten { font-size: 1.15rem; font-weight: 600; }
.nhan { margin-left: auto; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; padding: 3px 10px; border-radius: 999px;
  color: var(--m); background: color-mix(in oklch, var(--m) 15%, transparent); border: 1px solid color-mix(in oklch, var(--m) 35%, transparent); }
.chinh { display: grid; grid-template-columns: auto 1fr; gap: 22px; align-items: center; }
@media (max-width: 460px) { .chinh { grid-template-columns: 1fr; justify-items: center; } }
.vong { position: relative; width: 148px; height: 148px; }
.vong svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.vong .so { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.vong .so b { font-size: 2.4rem; font-weight: 650; letter-spacing: -0.03em; line-height: 1; }
.vong .so b small { font-size: 1rem; font-weight: 500; color: var(--dim); margin-left: 1px; }
.vong .so span { font-size: 0.75rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
.thanh { display: flex; flex-direction: column; gap: 14px; min-width: 0; width: 100%; }
.dong { display: flex; flex-direction: column; gap: 6px; }
.dong .tren { display: flex; align-items: baseline; gap: 8px; }
.dong .tren .tieu { font-weight: 500; }
.dong .tren .gt { margin-left: auto; font-weight: 650; font-size: 1.05rem; }
.ray { position: relative; height: 8px; border-radius: 999px; background: var(--track); overflow: visible; }
.ray i { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--m); }
.ray .moc { position: absolute; top: -4px; bottom: -4px; width: 2px; border-radius: 2px; background: var(--fg); opacity: 0.7; }
.dong .duoi { font-size: 0.78rem; color: var(--dim); display: flex; gap: 6px; flex-wrap: wrap; }
.dong .duoi b { color: var(--fg); font-weight: 600; }
.nhip { font-size: 0.85rem; color: var(--dim); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.nhip b { color: var(--m); }
.api { border-top: 1px solid var(--border); padding-top: 16px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 520px) { .api { grid-template-columns: repeat(2, 1fr); } }
.api .tieu { grid-column: 1 / -1; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); display: flex; gap: 6px; align-items: center; }
.o { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.o span { font-size: 0.75rem; color: var(--dim); }
.o b { font-size: 1.25rem; font-weight: 650; letter-spacing: -0.01em; }
.o b small { font-size: 0.75rem; font-weight: 500; color: var(--dim); margin-left: 2px; }
.goiy { grid-column: 1 / -1; font-size: 0.82rem; color: var(--dim); }
.goiy code { color: var(--fg); background: var(--track); padding: 1px 5px; border-radius: 5px; }
.loi { font-size: 0.85rem; color: var(--bad); }
.bieudo { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px; }
.bd h2 { margin: 0; font-size: 1rem; font-weight: 600; }
.bd .chu { display: flex; gap: 14px; font-size: 0.8rem; color: var(--dim); flex-wrap: wrap; }
.bd .chu i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; background: var(--c); margin-right: 6px; vertical-align: middle; }
.bd svg { width: 100%; height: auto; display: block; overflow: visible; }
.bd svg text { fill: var(--dim); font-size: 10px; }
.chan { color: var(--dim); font-size: 0.78rem; }
.chan a { color: var(--primary); }
@media (prefers-reduced-motion: no-preference) { .ray i, .vong circle.do { transition: all 0.6s cubic-bezier(.2,.8,.2,1); } }
`;

class ClaudeCodeCard extends HTMLElement {
  setConfig(c) {
    this._cfg = { accounts: [{ slug: "vonupt", name: "Vonupt" }, { slug: "vokupt", name: "Vokupt" }], ...c };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: "full" }; }

  connectedCallback() {
    this._tick = setInterval(() => this._ve(true), 30000);
  }
  disconnectedCallback() { clearInterval(this._tick); }

  set hass(h) {
    this._hass = h;
    // Chỉ vẽ lại khi một sensor Claude đổi (tránh vẽ mỗi lần mọi entity trong nhà đổi)
    const khoa = Object.keys(h.states).filter((e) => e.startsWith("sensor.claude_"))
      .map((e) => `${e}=${h.states[e].state}`).join("|");
    if (khoa !== this._khoa) { this._khoa = khoa; this._ve(); }
    if (!this._lsAt || Date.now() - this._lsAt > 600000) this._taiLichSu();
  }

  _s(e) { const st = this._hass?.states[e]; return st ? st.state : undefined; }
  _n(e) { return num(this._s(e)); }

  async _taiLichSu() {
    this._lsAt = Date.now();
    const ids = this._cfg.accounts.flatMap((a) => [`sensor.claude_${a.slug}_week_usage`, `sensor.claude_${a.slug}_session_usage`]);
    try {
      const r = await this._hass.callWS({
        type: "history/history_during_period", start_time: new Date(Date.now() - 7 * 864e5).toISOString(),
        end_time: new Date().toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true,
      });
      this._ls = {};
      for (const [e, arr] of Object.entries(r)) {
        this._ls[e] = arr.map((x) => [(x.lu ?? x.lc ?? 0) * 1000, num(x.s)]).filter((p) => p[1] !== null);
      }
      this._ve();
    } catch (err) { this._lsLoi = String(err?.message || err); }
  }

  // Vòng tròn % tuần, có vạch "tiêu đều" ở mức thời gian tuần đã trôi
  _vong(p, troi, mau) {
    const r = 62, C = 2 * Math.PI * r, v = p === null ? 0 : Math.min(100, p);
    const vach = troi === null ? "" : (() => {
      const a = (Math.min(100, Math.max(0, troi)) / 100) * 2 * Math.PI;
      const x1 = 74 + (r - 11) * Math.cos(a), y1 = 74 + (r - 11) * Math.sin(a);
      const x2 = 74 + (r + 11) * Math.cos(a), y2 = 74 + (r + 11) * Math.sin(a);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--fg)" stroke-width="2.5" stroke-linecap="round" opacity="0.75"/>`;
    })();
    return `<div class="vong"><svg viewBox="0 0 148 148" aria-hidden="true">
      <circle cx="74" cy="74" r="${r}" fill="none" stroke="var(--track)" stroke-width="13"/>
      ${v > 0 ? `<circle class="do" cx="74" cy="74" r="${r}" fill="none" stroke="${mau}" stroke-width="13" stroke-linecap="round"
        stroke-dasharray="${(v / 100) * C} ${C}"/>` : ""}${vach}</svg>
      <div class="so"><b>${fmtPct(p)}<small>%</small></b><span>Tuần</span></div></div>`;
  }

  _dong(tieu, p, reset, troi) {
    const d = dem(reset);
    const duoi = reset === undefined ? "" : d ? `reset sau <b>${esc(d.con)}</b> · ${esc(d.luc)}` : "chưa mở · chưa dùng từ lần reset trước";
    return `<div class="dong" style="--m:${muc(p)}">
      <div class="tren"><span class="tieu">${esc(tieu)}</span><span class="gt">${fmtPct(p)}%</span></div>
      <div class="ray"><i style="width:${p === null ? 0 : Math.min(100, p)}%"></i>${troi === undefined || troi === null ? "" : `<span class="moc" style="left:calc(${Math.min(100, Math.max(0, troi))}% - 1px)" title="Mức tiêu đều"></span>`}</div>
      ${duoi ? `<div class="duoi">${duoi}</div>` : ""}</div>`;
  }

  _taiKhoan(a, i) {
    const s = `sensor.claude_${a.slug}`, api = `sensor.claude_api_${a.slug}`;
    const tuan = this._n(`${s}_week_usage`), pace = this._n(`${s}_week_usage_pace`);
    const troi = tuan !== null && pace !== null ? tuan - pace : null;
    const loi = this._s(`${s}_api_error`) === "1";
    const m = loi ? "var(--bad)" : pace === null ? "var(--dim)" : pace > 15 ? "var(--warn)" : "var(--ok)";
    const nhan = loi ? "Lỗi đọc API" : pace === null ? "Chưa có số" : pace > 15 ? "Tiêu nhanh" : pace < -15 ? "Còn dư nhiều" : "Đúng nhịp";
    // Mọi hạn mức tuần riêng theo model (Fable, Opus…) — integration tự tạo khi API có
    const models = Object.keys(this._hass.states)
      .filter((e) => e.startsWith(`${s}_weekly_`) && e.endsWith("_limit_usage") && !e.includes("_all_models_"))
      .map((e) => [e.slice(`${s}_weekly_`.length, -"_limit_usage".length), this._n(e), this._hass.states[e].attributes?.resets_at])
      .filter(([, v]) => v !== null);
    const cost = this._n(`${api}_cost_month`);
    const apiHtml = cost === null
      ? `<div class="goiy">Chưa có số API. Dán Admin key vào <code>/config/secrets.yaml</code> dòng <code>anthropic_admin_key_${esc(a.slug)}</code> rồi khởi động lại HA.</div>`
      : `<div class="o"><span>Hôm nay</span><b>${fmtUsd(this._n(`${api}_cost_today`))}<small>USD</small></b></div>
         <div class="o"><span>Tháng này</span><b>${fmtUsd(cost)}<small>USD</small></b></div>
         <div class="o"><span>Token hôm nay</span><b>${fmtTok(this._n(`${api}_tokens_today`))}</b></div>
         <div class="o"><span>Token 7 ngày</span><b>${fmtTok(this._n(`${api}_tokens_7d`))}</b></div>`;
    const doc = this._hass.states[`${s}_week_usage`];
    const phut = doc ? Math.floor((Date.now() - new Date(doc.last_reported || doc.last_updated)) / 60000) : null;
    return `<section class="the" style="--c:${ACC[i % 2]}">
      <div class="dau"><span class="cham"></span><span class="ten">${esc(a.name)}</span>
        <span class="nhan" style="--m:${m}">${nhan}</span></div>
      <div class="chinh">
        ${this._vong(tuan, troi, muc(tuan))}
        <div class="thanh">
          ${this._dong("Phiên 5 giờ", this._n(`${s}_session_usage`), this._s(`${s}_session_reset_time`) ?? null)}
          ${this._dong("Tuần · mọi model", tuan, this._s(`${s}_weekly_reset_time`) ?? null, troi)}
          ${models.map(([k, v, r]) => this._dong(`Tuần · ${k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}`, v, undefined, undefined)).join("")}
        </div>
      </div>
      ${pace === null ? "" : `<div class="nhip" style="--m:${m}">Nhịp tuần <b>${pace > 0 ? "+" : ""}${Math.round(pace)} điểm</b>
        so với tiêu đều · vạch trắng là mức nên dùng tới lúc này</div>`}
      ${loi ? `<div class="loi">Đọc API lỗi, số có thể cũ. Nếu HA báo Re-authenticate, đăng nhập lại entry Claude Usage.</div>` : ""}
      <div class="api"><div class="tieu">API · Claude Console</div>${apiHtml}</div>
      <div class="chan">Cập nhật ${phut === null ? "?" : phut} phút trước · hạn mức 5 phút/lần, API 10 phút/lần</div>
    </section>`;
  }

  // Biểu đồ đường: mỗi tài khoản một màu, trục 0–100 %
  _duong(tieu, ngay, hau) {
    const W = 600, H = 190, L = 30, R = 8, T = 10, B = 24;
    const t1 = Date.now(), t0 = t1 - ngay * 864e5;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - v / 100) * (H - T - B);
    let g = "";
    for (const v of [0, 25, 50, 75, 100]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="${v ? "3 4" : ""}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    const buoc = ngay > 2 ? 864e5 : 6 * 36e5;
    for (let t = Math.ceil(t0 / buoc) * buoc; t <= t1; t += buoc) {
      const d = new Date(t);
      g += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${ngay > 2 ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : `${pad(d.getHours())}h`}</text>`;
    }
    const chu = [];
    this._cfg.accounts.forEach((a, i) => {
      const pts = (this._ls?.[`sensor.claude_${a.slug}_${hau}`] || []).filter((p) => p[0] >= t0);
      const cuoi = this._n(`sensor.claude_${a.slug}_${hau}`);
      if (cuoi !== null) pts.push([t1, cuoi]);
      if (!pts.length) return;
      // bậc thang: giữ giá trị tới lần đổi kế tiếp
      let d = `M${x(Math.max(t0, pts[0][0]))},${y(pts[0][1])}`;
      for (let k = 1; k < pts.length; k++) d += `H${x(pts[k][0])}V${y(pts[k][1])}`;
      const den = `${d}V${y(0)}H${x(Math.max(t0, pts[0][0]))}Z`;
      g += `<path d="${den}" fill="${ACC[i % 2]}" opacity="0.10"/><path d="${d}" fill="none" stroke="${ACC[i % 2]}" stroke-width="2.2" stroke-linejoin="round"/>`;
      g += `<circle cx="${x(t1)}" cy="${y(cuoi ?? 0)}" r="4" fill="${ACC[i % 2]}" stroke="var(--bg)" stroke-width="2"/>`;
      chu.push(`<span style="--c:${ACC[i % 2]}"><i></i>${esc(a.name)} · ${fmtPct(cuoi)}%</span>`);
    });
    return `<section class="the bd"><div class="dau"><h2>${esc(tieu)}</h2></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tieu)}">${g}</svg><div class="chu">${chu.join("")}</div></section>`;
  }

  _ve(chiDem = false) {
    if (!this._hass || !this.shadowRoot) return;
    if (chiDem && !this._daVe) return;
    this._daVe = true;
    const accs = this._cfg.accounts;
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="trang">
      <header><div><h1><span class="logo"><ha-icon icon="mdi:creation"></ha-icon></span>Claude Code</h1>
        <div class="phu">Hạn mức gói thuê bao và chi phí API của ${accs.length} tài khoản</div></div>
        <div class="phu">${new Date().toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", weekday: "short", day: "2-digit", month: "2-digit" })}</div></header>
      <div class="luoi">${accs.map((a, i) => this._taiKhoan(a, i)).join("")}</div>
      <div class="bieudo">${this._duong("% hạn mức tuần · 7 ngày", 7, "week_usage")}${this._duong("% phiên 5 giờ · 2 ngày", 2, "session_usage")}</div>
      <div class="chan">Mức đầy: xanh &lt; 60 % · vàng &lt; 85 % · đỏ ≥ 85 %. API tính ngày theo UTC (đổi ngày lúc 07:00 giờ VN), giống
        <a href="https://platform.claude.com/dashboard" target="_blank" rel="noopener">dashboard Console</a>.</div>
    </div>`;
  }
}
customElements.define("claude-code-card", ClaudeCodeCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "claude-code-card", name: "Claude Code", description: "Hạn mức Claude Code + chi phí API Console" });
