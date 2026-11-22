/*
 * claude-code-card — hạn mức 2 tài khoản Claude Code (gói thuê bao) + chi phí/token API Console, một card toàn trang.
 * Dữ liệu:
 *   sensor.claude_<tk>_*      integration HACS hass_claude_usage (5 phút/lần): session_usage, week_usage,
 *                             weekly_<model>_limit_usage (tự nhận mọi model có hạn mức riêng), *_reset_time,
 *                             week_usage_pace (= % đã dùng − % thời gian tuần đã trôi), api_error
 *   sensor.claude_api_<tk>_*  ha/62_claude_api_console.yaml (Admin API, 10 phút/lần)
 *   Số dư + hạn tín dụng: không API nào trả ⇒ credit_balance = số dư mốc − chi phí từ ngày mốc; nút sửa trên card ghi vào
 *   input_number.claude_api_<tk>_credit_base (nhập số Console đang hiện, card cộng lại phần đã trừ) và input_datetime *_credit_expiry.
 *   Lịch sử: WS history/history_during_period (7 ngày, mỗi tài khoản một biểu đồ), tải lại 10 phút/lần.
 * Bảng màu: palette-axi generate --preset neon-dark (nền navy, viền + quầng sáng neon; 7/7 quy tắc).
 *   Màu tài khoản (acc1/acc2) chỉ để nhận diện; mức đầy dùng ok/warn/bad (<60 / <85 / ≥85 %).
 *
 * Cấu hình:
 *   type: custom:claude-code-card
 *   accounts: [{slug: vonupt, name: Vonupt}, {slug: vokupt, name: Vokupt}]   # month_limit: giới hạn bậc Console, USD
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
const fmtNgay = (iso) => iso.split("-").reverse().join("/");
const conNgay = (iso) => Math.ceil((new Date(`${iso}T23:59:59`) - Date.now()) / 864e5);
// Đếm ngược tới mốc (ms): "3 ngày 7 giờ 41 phút 12 giây"; bộ đếm 1 s chỉ thay chữ các .dem, không vẽ lại card
function demNguoc(den) {
  let s = Math.floor((den - Date.now()) / 1000);
  if (s <= 0) return "đến hạn";
  const n = Math.floor(s / 86400); s %= 86400;
  const g = Math.floor(s / 3600); s %= 3600;
  const p = Math.floor(s / 60); s %= 60;
  return `${n ? `${n} ngày ` : ""}${n || g ? `${pad(g)} giờ ` : ""}${pad(p)} phút ${pad(s)} giây`;
}
// Gói tháng tự gia hạn: ngày đã nhập qua rồi thì dời từng tháng tới kỳ kế tiếp (không ghi lại helper)
function kyToi(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  for (let i = 0; i < 240; i++) {
    const c = new Date(y, m - 1 + i, d);
    const k = `${c.getFullYear()}-${pad(c.getMonth() + 1)}-${pad(c.getDate())}`;
    if (conNgay(k) > 0) return k; // ngày đã qua cho Math.ceil(-0,x) = -0, mà -0 >= 0 vẫn đúng ⇒ dùng > 0
  }
  return iso;
}
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
  /* neon-dark của palette-axi; hex = bản đã kẹp vào sRGB. acc1 = fuchsia (Vonupt), acc2 = cyan (Vokupt) */
  --bg-edge: var(--secondary-background-color, #060a14); --bg: var(--primary-background-color, #0a1122); --surface: var(--card-background-color, #0e182e); --glow: var(--light-primary-color, #142443); --border: var(--divider-color, #1e2b4a);
  --dim: var(--secondary-text-color, #a2b7d7); --fg: var(--primary-text-color, #e6edf7); --primary: var(--primary-color, #22d3ee); --acc1: #e879f9; --acc2: var(--primary-color, #22d3ee);
  --ok: var(--success-color, #22c55e); --warn: var(--warning-color, #f59e0b); --bad: var(--error-color, #ff716a);
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
h1 { margin: 0; font-size: clamp(24px, 2.6vw, 32px); font-weight: 650; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px; }
h1 .logo { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
  background: color-mix(in oklch, var(--primary) 18%, transparent); color: var(--primary); }
.phu { color: var(--dim); font-size: 14px; }
.luoi { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px; }
.the {
  background: color-mix(in oklch, var(--surface) 82%, transparent); border: 1px solid var(--border);
  border-radius: 20px; padding: 20px; display: flex; flex-direction: column; gap: 18px; min-width: 0;
  backdrop-filter: blur(8px);
}
.the[style*="--c"] { border-color: color-mix(in oklch, var(--c) 40%, var(--border));
  box-shadow: inset 0 1px 0 color-mix(in oklch, var(--c) 18%, transparent); }
.dau { display: flex; align-items: center; gap: 10px; }
.cham { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
.ten { font-size: 18px; font-weight: 600; }
.nhan { margin-left: auto; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; padding: 3px 10px; border-radius: 999px;
  color: var(--m); background: color-mix(in oklch, var(--m) 15%, transparent); border: 1px solid color-mix(in oklch, var(--m) 35%, transparent); }
.chinh { display: grid; grid-template-columns: auto 1fr; gap: 22px; align-items: center; }
@media (max-width: 460px) { .chinh { grid-template-columns: 1fr; justify-items: center; } }
.vong { position: relative; width: 148px; height: 148px; }
.vong svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
.vong .so { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.vong .so b { font-size: 38px; font-weight: 650; letter-spacing: -0.03em; line-height: 1; }
.vong .so b small { font-size: 16px; font-weight: 500; color: var(--dim); margin-left: 1px; }
.vong .so span { font-size: 13px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
.thanh { display: flex; flex-direction: column; gap: 14px; min-width: 0; width: 100%; }
.dong { display: flex; flex-direction: column; gap: 6px; }
.dong .tren { display: flex; align-items: baseline; gap: 8px; }
.dong .tren .tieu { font-weight: 500; }
.dong .tren .gt { margin-left: auto; font-weight: 650; font-size: 17px; }
.ray { position: relative; height: 8px; border-radius: 999px; background: var(--track); overflow: visible; }
.ray i { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--m); }
.ray .moc { position: absolute; top: -4px; bottom: -4px; width: 2px; border-radius: 2px; background: var(--fg); opacity: 0.7; }
.dong .duoi { font-size: 14px; color: var(--dim); display: flex; gap: 6px; flex-wrap: wrap; }
.dong .duoi b { color: var(--fg); font-weight: 600; }
.nhip { font-size: 14px; color: var(--dim); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.nhip b { color: var(--m); }
.api { border-top: 1px solid var(--border); padding-top: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 520px) { .api { grid-template-columns: repeat(2, 1fr); } }
.api .tieu { grid-column: 1 / -1; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); display: flex; gap: 6px; align-items: center; }
.o { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.o span { font-size: 14px; color: var(--dim); }
.o b { font-size: 20px; font-weight: 650; letter-spacing: -0.01em; }
.o b small { font-size: 14px; font-weight: 500; color: var(--dim); margin-left: 2px; }
.vi { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 14px 16px; border-radius: 14px;
  background: color-mix(in oklch, var(--c) 8%, transparent); border: 1px solid color-mix(in oklch, var(--c) 28%, transparent); }
.vi .o b { font-size: 27px; color: var(--c); }
.vi .ct { font-size: 14px; color: var(--dim); }
.vi .ct b { font-size: inherit; font-weight: 600; color: var(--fg); text-shadow: none; }
.vi .han b { font-size: 20px; color: var(--m, var(--fg)); text-shadow: none; }
.sua { all: unset; cursor: pointer; margin-left: 6px; color: var(--dim); font-size: 13px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); }
.sua:hover, .sua:focus-visible { color: var(--fg); border-color: var(--c); }
.thang { grid-column: 1 / -1; }
.goi { font-size: 14px; color: var(--dim); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.goi b { color: var(--fg); font-weight: 600; }
.goi .sua { margin-left: 0; }
.goi .dem { font-variant-numeric: tabular-nums; }
.uoc { grid-column: 1 / -1; font-size: 14px; color: var(--dim); }
.tang { font-size: 13px; font-weight: 600; color: var(--dim); margin-left: 4px; }
.goiy { grid-column: 1 / -1; font-size: 13px; color: var(--dim); }
.goiy code { color: var(--fg); background: var(--track); padding: 1px 5px; border-radius: 5px; }
.loi { font-size: 14px; color: var(--bad); }
.loi.canh { padding: 8px 12px; border: 1px solid var(--bad); border-radius: 10px; }
.loi.canh a { color: inherit; text-decoration: underline; }
.loi.canh a:focus-visible { outline: 2px solid var(--bad); outline-offset: 2px; border-radius: 3px; }
.bieudo { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px; }
.bd h2 { margin: 0; font-size: 16px; font-weight: 600; }
.bd .chu { display: flex; gap: 14px; font-size: 14px; color: var(--dim); flex-wrap: wrap; }
.bd .chu i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; background: var(--c); margin-right: 6px; vertical-align: middle; }
.bd svg { width: 100%; height: auto; display: block; overflow: visible; }
.bd svg text { fill: var(--dim); font-size: 12px; }
.chan { color: var(--dim); font-size: 14px; }
.chan a { color: var(--primary); }
@media (prefers-reduced-motion: no-preference) { .ray i, .vong circle.do { transition: all 0.6s cubic-bezier(.2,.8,.2,1); } }
`;

class ClaudeCodeCard extends HTMLElement {
  setConfig(c) {
    this._cfg = { accounts: [{ slug: "vonupt", name: "Vonupt" }, { slug: "vokupt", name: "Vokupt" }], ...c };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => {
        const nut = ev.target.closest?.("[data-sua]");
        if (nut) this._sua(nut.dataset.sua, nut.dataset.tk);
      });
    }
  }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: "full" }; }

  connectedCallback() {
    this._tick = setInterval(() => this._ve(true), 30000);
    this._giay = setInterval(() => {
      for (const el of this.shadowRoot?.querySelectorAll(".dem[data-den]") || []) el.textContent = demNguoc(+el.dataset.den);
    }, 1000);
  }
  disconnectedCallback() { clearInterval(this._tick); clearInterval(this._giay); this._ro?.disconnect(); }

  set hass(h) {
    this._hass = h;
    // Chỉ vẽ lại khi một sensor Claude đổi (tránh vẽ mỗi lần mọi entity trong nhà đổi)
    const khoa = Object.keys(h.states).filter((e) => /^(sensor\.claude_|input_(number|datetime|text)\.claude_api_)/.test(e))
      .map((e) => `${e}=${h.states[e].state}`).join("|");
    if (khoa !== this._khoa) { this._khoa = khoa; this._ve(); }
    if (!this._lsAt || Date.now() - this._lsAt > 600000) this._taiLichSu();
  }

  _s(e) { const st = this._hass?.states[e]; return st ? st.state : undefined; }
  _n(e) { return num(this._s(e)); }

  // Nhập số dư đang thấy trên Console hoặc hạn dùng; số mốc = số dư + phần đã trừ từ ngày mốc
  _sua(loai, tk) {
    if (loai === "so_du") {
      const v = window.prompt("Số dư tín dụng đang hiện trên Console (USD):");
      if (v === null) return;
      const so = Number(v.trim().replace(",", "."));
      if (!Number.isFinite(so) || so < 0) { window.alert("Số không hợp lệ"); return; }
      const value = Math.round((so + (this._n(`sensor.claude_api_${tk}_cost_since_base`) ?? 0) + (this._n(`sensor.claude_api_${tk}_cost_pending`) ?? 0)) * 100) / 100;
      this._hass.callService("input_number", "set_value", { value }, { entity_id: `input_number.claude_api_${tk}_credit_base` });
      return;
    }
    const goi = loai === "goi";
    const v = window.prompt(goi ? "Ngày gia hạn gói (dd/mm/yyyy, xem claude.ai › Settings › Billing). Script PC1 tự ghi giờ mỗi ngày, chỉ sửa khi PC1 tắt lâu:"
      : "Ngày hết hạn credit được tặng (dd/mm/yyyy, xem Console › Billing › Promotional credits):");
    if (v === null) return;
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!m) { window.alert("Ngày không hợp lệ, ví dụ 15/06/2027"); return; }
    this._hass.callService("input_datetime", "set_datetime", { date: `${m[3]}-${pad(m[2])}-${pad(m[1])}` },
      { entity_id: `input_datetime.claude_api_${tk}_${goi ? "plan_renew" : "credit_expiry"}` });
  }

  // Khối tín dụng: số dư, hạn dùng, còn dùng được bao lâu theo nhịp tháng này
  _tinDung(a, cost) {
    const tk = esc(a.slug), api = `sensor.claude_api_${a.slug}`;
    const du = this._n(`${api}_credit_balance`);
    const nhap = this._s(`input_datetime.claude_api_${a.slug}_credit_expiry`);
    // Credit tặng hết hạn cuối kỳ thanh toán ⇒ chưa nhập riêng thì lấy kỳ gia hạn gói
    const goi = this._kyGoi(a), tuGoi = !((nhap || "") > "2020"); // helper mới tạo tự lấy ngày hiện tại ⇒ 2000-01-01 = chưa nhập
    const hanIso = tuGoi ? goi : nhap;
    const coHan = !!hanIso;
    const con = coHan ? conNgay(hanIso) : null;
    const nhipNgay = cost ? cost / Math.max(1, new Date().getUTCDate()) : 0;
    const ngayHet = du !== null && nhipNgay > 0 ? Math.floor(du / nhipNgay) : null;
    // Credit gói không chuyển kỳ ⇒ so nhịp tiêu với hạn: phần tiêu không kịp sẽ mất
    const mat = du !== null && con !== null && con > 0 ? du - nhipNgay * con : null;
    const mHan = con === null ? "var(--dim)" : con <= 30 ? "var(--bad)" : con <= 90 ? "var(--warn)" : "var(--fg)";
    return `<div class="vi">
      <div class="o"><span>Tín dụng còn lại <button class="sua" data-sua="so_du" data-tk="${tk}">sửa</button></span>
        ${du === null ? `<div class="ct">Chưa nhập, bấm sửa rồi dán số dư trên Console</div>` : `<b>${fmtUsd(du)}<small>USD</small></b>
        <div class="ct">${con !== null && con <= 0 ? "<b>Đã qua hạn, nhập lại số dư và hạn mới</b>"
          : mat !== null && mat > 0 ? `theo nhịp ${fmtUsd(nhipNgay)} USD/ngày, <b>~${fmtUsd(mat)} USD</b> sẽ mất khi hết hạn`
          : ngayHet === null ? "chưa có chi tiêu tháng này" : `đủ dùng <b>~${ngayHet.toLocaleString("vi-VN")} ngày</b> theo nhịp ${fmtUsd(nhipNgay)} USD/ngày`}</div>`}</div>
      <div class="o han" style="--m:${mHan}"><span>Hạn credit tặng <button class="sua" data-sua="han" data-tk="${tk}">sửa</button></span>
        ${coHan ? `<b>${esc(fmtNgay(hanIso))}</b><div class="ct">${con > 0 ? `còn <b>${con.toLocaleString("vi-VN")} ngày</b>` : "<b>đã hết hạn</b>"}${tuGoi ? " · theo kỳ gói" : ""}</div>`
          : `<div class="ct">Chưa nhập. Xem Console › Billing › Promotional credits</div>`}</div>
    </div>`;
  }

  // plan_renew có giờ ("YYYY-MM-DD HH:MM:SS", script PC1 ghi từ claude.ai) ⇒ phần ngày cho kyToi/conNgay
  _kyGoi(a) {
    const iso = (this._s(`input_datetime.claude_api_${a.slug}_plan_renew`) || "").slice(0, 10);
    return iso > "2020" ? kyToi(iso) : null;
  }

  // "19:42:20" nếu helper có giờ thật (00:00:00 = chỉ nhập ngày, không hiện)
  _gioGoi(a) {
    const g = (this._s(`input_datetime.claude_api_${a.slug}_plan_renew`) || "").slice(11, 19);
    return g && g !== "00:00:00" ? g : "";
  }

  _goi(a) {
    const iso = this._kyGoi(a), con = iso ? conNgay(iso) : null, gio = this._gioGoi(a);
    return `<div class="goi"><span>Gói${a.plan ? ` <b>${esc(a.plan)}</b>` : ""}</span>
      ${iso ? `<span>gia hạn <b>${gio ? `${esc(gio.slice(0, 5))} ` : ""}${esc(fmtNgay(iso))}</b> · còn <b class="dem"${gio ? ` data-den="${new Date(`${iso}T${gio}`).getTime()}"` : ""}>${gio ? demNguoc(new Date(`${iso}T${gio}`).getTime()) : `${con.toLocaleString("vi-VN")} ngày`}</b></span>` : "<span>chưa nhập ngày gia hạn</span>"}
      <button class="sua" data-sua="goi" data-tk="${esc(a.slug)}">sửa</button></div>`;
  }

  // Trạng thái gói do script PC1 ghi (subscription_details.status); rỗng/active/trialing ⇒ không cảnh báo
  _canhBaoGoi(a) {
    const st = (this._s(`input_text.claude_api_${a.slug}_plan_status`) || "").trim();
    if (!st || st === "unknown" || st === "unavailable" || st === "active" || st === "trialing") return "";
    const iso = this._kyGoi(a), han = iso ? fmtNgay(iso) : "";
    const cau = {
      past_due: `<b>Thanh toán gói bị lỗi.</b> Stripe đang thử trừ tiền lại${han ? `, hạn chót ${esc(han)}` : ""}. Kiểm tra thẻ thanh toán`,
      unpaid: "<b>Gói chưa được thanh toán</b>, có thể bị khoá. Kiểm tra thanh toán",
      canceled: "<b>Gói đã huỷ.</b> Xem lại",
      incomplete_expired: "<b>Gói đã huỷ</b> vì thanh toán đầu không xong. Xem lại",
      paused: "<b>Gói đang tạm dừng.</b> Xem lại",
    }[st] ?? `<b>Trạng thái gói: ${esc(st)}.</b> Kiểm tra`;
    return `<div class="loi canh">${cau} ở <a href="https://claude.ai/settings/billing" target="_blank" rel="noopener">claude.ai › Billing</a>.</div>`;
  }

  _thang(a, cost) {
    if (!a.month_limit || cost === null) return "";
    const p = (cost / a.month_limit) * 100, d = new Date(), sau = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return `<div class="dong thang" style="--m:${muc(p)}">
      <div class="tren"><span class="tieu">Chi tiêu tháng này</span><span class="gt">${fmtUsd(cost)} / ${a.month_limit.toLocaleString("vi-VN")} USD</span></div>
      <div class="ray"><i style="width:${Math.min(100, p)}%"></i></div>
      <div class="duoi">đã dùng <b>${p < 1 && p > 0 ? "&lt;1" : Math.round(p)}%</b> giới hạn bậc · đặt lại ${pad(sau.getUTCDate())}/${pad(sau.getUTCMonth() + 1)}</div></div>`;
  }

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
      ${v > 0 ? `<circle class="do" cx="74" cy="74" r="${r}" fill="none" stroke="${mau}" style="color:${mau}" stroke-width="13" stroke-linecap="round"
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
    // Analytics trễ vài giờ: cộng phần ước tính từ token cho khớp Console hơn
    const choGhi = this._n(`${api}_cost_pending`) ?? 0;
    const thangGoc = this._n(`${api}_cost_month`), homGoc = this._n(`${api}_cost_today`);
    const cost = thangGoc === null ? null : thangGoc + choGhi;
    const tk7 = this._n(`${api}_tokens_7d`), tkTruoc = this._n(`${api}_tokens_prev_7d`);
    const tang = tk7 !== null && tkTruoc ? Math.round((tk7 / tkTruoc - 1) * 100) : null;
    const apiHtml = cost === null
      ? `<div class="goiy">Chưa có số API. Dán Admin key vào <code>/config/secrets.yaml</code> dòng <code>anthropic_admin_key_${esc(a.slug)}</code> rồi khởi động lại HA.</div>`
      : `${this._tinDung(a, cost)}${this._thang(a, cost)}
         <div class="o"><span>Chi hôm nay</span><b>${fmtUsd(homGoc === null ? null : homGoc + choGhi)}<small>USD</small></b></div>
         <div class="o"><span>Chi tháng này</span><b>${fmtUsd(cost)}<small>USD</small></b></div>
         <div class="o"><span>Token hôm nay</span><b>${fmtTok(this._n(`${api}_tokens_today`))}</b></div>
         <div class="o"><span>Token 7 ngày</span><b>${fmtTok(tk7)}${tang === null ? "" : `<span class="tang">${tang > 0 ? "+" : ""}${tang.toLocaleString("vi-VN")}%</span>`}</b></div>
         <div class="o"><span>Trúng cache 7 ngày</span><b>${fmtPct(this._n(`${api}_cache_hit_7d`))}<small>%</small></b></div>
         <div class="o"><span>Cache tiết kiệm tháng</span><b>~${fmtUsd(this._n(`${api}_cache_saved_month`))}<small>USD</small></b></div>
         ${choGhi > 0 ? `<div class="ct uoc">Gồm ~${fmtUsd(choGhi)} USD ước tính từ token, API chi phí chưa ghi</div>` : ""}`;
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
      ${this._goi(a)}
      ${this._canhBaoGoi(a)}
      ${loi ?`<div class="loi">Đọc API lỗi, số có thể cũ. Nếu HA báo Re-authenticate, đăng nhập lại entry Claude Usage.</div>` : ""}
      <div class="api"><div class="tieu">API · Claude Console</div>${apiHtml}</div>
      <div class="chan">Cập nhật ${phut === null ? "?" : phut} phút trước · hạn mức 5 phút/lần, API 10 phút/lần</div>
    </section>`;
  }

  // Biểu đồ đường của một tài khoản, trục 0–100 %: tuần (màu tài khoản, có nền) + phiên 5 giờ (đường mảnh)
  _duong(a, i, ngay = 7) {
    // W = bề rộng thật của biểu đồ (đo bằng ResizeObserver trong _ve) ⇒ 1 đơn vị viewBox = 1 px, chữ trục giữ đúng 12px
    const W = Math.max(280, this._bdW || 600), H = 190, L = 30, R = 8, T = 10, B = 24;
    const t1 = Date.now(), t0 = t1 - ngay * 864e5;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - v / 100) * (H - T - B);
    let g = "";
    for (const v of [0, 25, 50, 75, 100]) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="${v ? "3 4" : ""}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    for (let t = Math.ceil(t0 / 864e5) * 864e5; t <= t1; t += 864e5) {
      const d = new Date(t);
      g += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${pad(d.getDate())}/${pad(d.getMonth() + 1)}</text>`;
    }
    const mau = ACC[i % 2], chu = [];
    // Vẽ phiên trước để đường tuần nằm trên
    for (const [hau, nhan, c, tuan] of [["session_usage", "Phiên 5 giờ", "var(--fg)", false], ["week_usage", "Tuần · mọi model", mau, true]]) {
      const pts = (this._ls?.[`sensor.claude_${a.slug}_${hau}`] || []).filter((p) => p[0] >= t0);
      const cuoi = this._n(`sensor.claude_${a.slug}_${hau}`);
      if (cuoi !== null) pts.push([t1, cuoi]);
      if (!pts.length) continue;
      // bậc thang: giữ giá trị tới lần đổi kế tiếp
      let d = `M${x(Math.max(t0, pts[0][0]))},${y(pts[0][1])}`;
      for (let k = 1; k < pts.length; k++) d += `H${x(pts[k][0])}V${y(pts[k][1])}`;
      if (tuan) g += `<path d="${d}V${y(0)}H${x(Math.max(t0, pts[0][0]))}Z" fill="${c}" opacity="0.14"/>`;
      g += `<path d="${d}" fill="none" stroke="${c}" stroke-linejoin="round" ${tuan ? `stroke-width="2.4"` : `stroke-width="1.2" opacity="0.7"`}/>`;
      g += `<circle cx="${x(t1)}" cy="${y(cuoi ?? 0)}" r="4" fill="${c}" stroke="var(--bg)" stroke-width="2"/>`;
      chu.unshift(`<span style="--c:${c}"><i></i>${nhan} · ${fmtPct(cuoi)}%</span>`);
    }
    const tieu = `${a.name} · % hạn mức ${ngay} ngày`;
    return `<section class="the bd" style="--c:${mau}"><div class="dau"><span class="cham"></span><h2>${esc(tieu)}</h2></div>
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
      <div class="bieudo">${accs.map((a, i) => this._duong(a, i)).join("")}</div>
      <div class="chan">Mức đầy: xanh &lt; 60 % · vàng &lt; 85 % · đỏ ≥ 85 %. API tính ngày theo UTC (đổi ngày lúc 07:00 giờ VN), số chi phí có thể trễ vài giờ so với
        <a href="https://platform.claude.com/dashboard" target="_blank" rel="noopener">dashboard Console</a>.</div>
    </div>`;
    // Đo bề rộng biểu đồ; đổi quá 16px thì vẽ lại với viewBox mới (không lặp: vẽ lại không đổi bề rộng khung)
    const khung = this.shadowRoot.querySelector(".bd svg");
    if (khung && window.ResizeObserver) {
      this._ro ??= new ResizeObserver((ds) => {
        const w = Math.round(ds[0].contentRect.width);
        if (w && Math.abs(w - (this._bdW || 0)) > 16) { this._bdW = w; this._ve(); }
      });
      this._ro.disconnect();
      this._ro.observe(khung.parentElement);
    }
  }
}
customElements.define("claude-code-card", ClaudeCodeCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "claude-code-card", name: "Claude Code", description: "Hạn mức Claude Code + chi phí API Console" });
