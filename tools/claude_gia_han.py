"""claude_gia_han: đọc giờ gia hạn gói Claude (claude.ai) rồi ghi vào HA — chạy trên PC1.

Nguồn: GET https://claude.ai/api/organizations/{org}/subscription_details (endpoint nội bộ của trang
Settings › Billing, không công bố) → `next_charge_at` (UTC, chính xác tới giây). Chỉ gọi được bằng
phiên đăng nhập claude.ai ⇒ mỗi tài khoản 1 hồ sơ trình duyệt Playwright riêng trên PC1, ngoài repo:
%USERPROFILE%\\.claude-gia-han\\<tk>. Cookie KHÔNG lên HA; HA chỉ nhận giờ qua input_datetime.set_datetime.

Lệnh:
  login <tk>          mở cửa sổ claude.ai, chủ tự đăng nhập đúng tài khoản; lưu org của gói
  doc [tk ...]        đọc giờ gia hạn (chỉ đọc, không ghi HA)
  ghi [tk ...]        đọc rồi ghi vào input_datetime.claude_api_<tk>_plan_renew + input_text.…_plan_status
Mã thoát: 0 ổn · 1 lỗi (phiên hết hạn, HA từ chối…) · 2 sai cách dùng.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TAI_KHOAN = ("vonupt", "vokupt")
# KHÔNG đặt trong AppData: Claude Desktop là gói MSIX, tiến trình con của nó ghi AppData\Local bị chuyển sang
# AppData\Local\Packages\Claude_*\LocalCache ⇒ Task Scheduler không thấy (gặp 2026-11-22). Home thì không bị chuyển.
GOC = Path.home() / ".claude-gia-han"
REPO = Path(__file__).resolve().parent.parent
CHROME = [
    rf"{os.environ.get('ProgramFiles', '')}\Google\Chrome\Application\chrome.exe",
    rf"{os.environ.get('ProgramFiles(x86)', '')}\Google\Chrome\Application\chrome.exe",
    rf"{os.environ.get('LOCALAPPDATA', '')}\Google\Chrome\Application\chrome.exe",
]
HELP = [
    "Run `python tools/claude_gia_han.py doc` để xem giờ gia hạn",
    "Run `python tools/claude_gia_han.py ghi` để ghi vào HA",
    "Run `python tools/claude_gia_han.py login <tk>` khi phiên hết hạn",
]


def in_ra(dong: list[str], help_: list[str] | None = None) -> None:
    print("\n".join(dong))
    h = help_ if help_ is not None else HELP
    if h:
        print(f"help[{len(h)}]:")
        for x in h:
            print(f"  {x}")


def loi(msg: str, ma: int = 1, help_: list[str] | None = None) -> None:
    in_ra([f"error: {msg}"], help_)
    sys.exit(ma)


def env() -> dict[str, str]:
    out = {}
    for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def trang_thai(tk: str) -> dict:
    p = GOC / tk / "org.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def mo(p, tk: str, headless: bool):
    # channel="chrome" (Chrome cài sẵn) ít bị Cloudflare/Google chặn hơn Chromium của Playwright
    kw = dict(user_data_dir=str(GOC / tk / "profile"), headless=headless, locale="vi-VN",
              args=["--disable-blink-features=AutomationControlled"])
    try:
        return p.chromium.launch_persistent_context(channel="chrome", **kw)
    except Exception:
        return p.chromium.launch_persistent_context(**kw)


def lay_json(page, path: str):
    return page.evaluate(
        """async (p) => { const r = await fetch(p, {credentials: 'include'});
           let b = null; try { b = await r.json(); } catch (e) {}
           return {status: r.status, body: b}; }""", path)


def vao_claude(page) -> dict:
    """Mở claude.ai rồi gọi /api/organizations; Cloudflare hiện "Just a moment" vài giây ở chế độ ẩn
    (gọi ngay thì 403 — gặp 2026-11-22) ⇒ thử lại tới ~30 s."""
    page.goto("https://claude.ai/", wait_until="domcontentloaded", timeout=45000)
    r = {"status": 0, "body": None}
    for _ in range(10):
        page.wait_for_timeout(3000)
        try:
            r = lay_json(page, "/api/organizations")
        except Exception:  # noqa: BLE001  (trang đang chuyển sau thử thách Cloudflare)
            continue
        if r["status"] == 200:
            break
    return r


def chon_org(orgs: list, tk: str) -> dict | None:
    goi = [o for o in orgs if o.get("billing_type") == "stripe_subscription"]
    khop = [o for o in goi if tk in (o.get("name") or "").lower()]
    return (khop or goi or [None])[0]


def org_hien_tai(tk: str) -> dict | None:
    """Chạy ẩn bằng hồ sơ của tk, trả org gói thuê bao (None = chưa đăng nhập / bị chặn)."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = mo(p, tk, headless=True)
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            r = vao_claude(page)
        finally:
            ctx.close()
    if r["status"] == 200 and isinstance(r["body"], list):
        return chon_org(r["body"], tk)
    print(f"  kiểm tra phiên: HTTP {r['status']}", flush=True)
    return None


def cmd_login(tk: str) -> None:
    (GOC / tk).mkdir(parents=True, exist_ok=True)
    org = org_hien_tai(tk) if (GOC / tk / "profile").exists() else None
    if org is None:
        # Đăng nhập bằng Chrome THƯỜNG (không Playwright): Google chặn đăng nhập trong trình duyệt bị điều khiển
        # tự động ("trình duyệt không an toàn") — gặp 2026-11-22. Chrome chạy với hồ sơ riêng; chủ đóng cửa sổ là xong.
        chrome = next((c for c in CHROME if Path(c).exists()), None)
        if not chrome:
            loi("không thấy chrome.exe")
        print(f"Đã mở Chrome cho '{tk}'. Đăng nhập đúng tài khoản {tk} trên claude.ai rồi ĐÓNG cửa sổ Chrome đó.",
              flush=True)
        subprocess.run([chrome, f"--user-data-dir={GOC / tk / 'profile'}", "--no-first-run",
                        "--no-default-browser-check", "--new-window", "https://claude.ai/login"], check=False)
        org = org_hien_tai(tk)
    if org is None:
        loi("chưa đăng nhập xong hoặc tài khoản không có gói thuê bao (stripe_subscription)")
    if tk not in (org.get("name") or "").lower():
        loi(f"tổ chức của gói không mang tên '{tk}' — có thể đăng nhập nhầm tài khoản; chạy lại login {tk}")
    khac = [t for t in TAI_KHOAN if t != tk and trang_thai(t).get("org") == org["uuid"]]
    if khac:
        loi(f"org này đã gắn cho '{khac[0]}' — đăng nhập nhầm tài khoản")
    (GOC / tk / "org.json").write_text(json.dumps({"org": org["uuid"], "luc": datetime.now().isoformat(timespec="seconds")}),
                                       encoding="utf-8")
    in_ra([f"login: ok · tk {tk} · plan {org.get('rate_limit_tier')}"],
          [f"Run `python tools/claude_gia_han.py doc {tk}` để thử đọc"])


def doc_mot(p, tk: str) -> dict:
    st = trang_thai(tk)
    if not st.get("org"):
        return {"tk": tk, "loi": "chưa login"}
    ctx = mo(p, tk, headless=True)
    try:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        r = vao_claude(page)
        if r["status"] != 200 or not isinstance(r["body"], list):
            return {"tk": tk, "loi": f"phiên hết hạn hoặc bị chặn (HTTP {r['status']})"}
        org = chon_org(r["body"], tk)
        if not org or org["uuid"] != st["org"]:
            return {"tk": tk, "loi": "org gói khác lúc login — chạy lại login"}
        d = lay_json(page, f"/api/organizations/{st['org']}/subscription_details")
        if d["status"] != 200 or not isinstance(d["body"], dict):
            return {"tk": tk, "loi": f"subscription_details HTTP {d['status']}"}
        b = d["body"]
        return {"tk": tk, "next_charge_at": b.get("next_charge_at"), "plan_ending_at": b.get("plan_ending_at"),
                "status": b.get("status"), "interval": b.get("billing_interval")}
    finally:
        ctx.close()


def gio_vn(iso: str | None) -> str:
    if not iso:
        return "-"
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%d/%m/%Y %H:%M:%S")


def goi_ha(dich_vu: str, data: dict) -> int:
    e = env()
    req = urllib.request.Request(
        f"{e['HA_URL'].rstrip('/')}/api/services/{dich_vu.replace('.', '/')}", data=json.dumps(data).encode(),
        headers={"Authorization": f"Bearer {e['HA_TOKEN']}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status


def ghi_ha(tk: str, iso: str | None, status: str | None) -> str:
    """Ghi trạng thái gói (luôn, để card cảnh báo) và giờ gia hạn (khi có)."""
    goi_ha("input_text.set_value", {"entity_id": f"input_text.claude_api_{tk}_plan_status", "value": status or ""})
    if iso:
        ts = int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
        goi_ha("input_datetime.set_datetime", {"entity_id": f"input_datetime.claude_api_{tk}_plan_renew", "timestamp": ts})
    return "ok"


def cmd_doc(tks: list[str], ghi: bool) -> None:
    from playwright.sync_api import sync_playwright

    tks = tks or [t for t in TAI_KHOAN if trang_thai(t).get("org")]
    if not tks:
        loi("chưa tài khoản nào login", 1, ["Run `python tools/claude_gia_han.py login vonupt` (và vokupt)"])
    kq = []
    with sync_playwright() as p:
        for tk in tks:
            try:
                kq.append(doc_mot(p, tk))
            except Exception as ex:  # noqa: BLE001
                kq.append({"tk": tk, "loi": type(ex).__name__})
    co_loi = False
    dong = [f"accounts[{len(kq)}]{{tk,renew_local,status,interval,ha}}:"]
    for r in kq:
        if "loi" in r:
            co_loi = True
            dong.append(f"  {r['tk']},-,error,-,\"{r['loi']}\"")
            continue
        ha = "-"
        if ghi:
            try:
                ha = ghi_ha(r["tk"], r["next_charge_at"], r["status"])
            except Exception as ex:  # noqa: BLE001
                co_loi, ha = True, f"\"lỗi ghi HA: {ex}\""
        if r["next_charge_at"] is None:
            co_loi = True
            ha = f"\"không gia hạn (plan_ending_at {gio_vn(r['plan_ending_at'])}) — chỉ ghi trạng thái\""
        dong.append(f"  {r['tk']},{gio_vn(r['next_charge_at'])},{r['status']},{r['interval']},{ha}")
    ok = sum(1 for r in kq if "loi" not in r)
    dong.insert(0, f"renew: {ok}/{len(kq)} đọc được · {'đã ghi HA' if ghi else 'chỉ đọc'}")
    in_ra(dong, [h for h in HELP if (ghi and "doc" in h) or (not ghi and "ghi" in h) or (co_loi and "login" in h)])
    sys.exit(1 if co_loi else 0)


def main() -> None:
    a = sys.argv[1:]
    if "--log" in a:  # lịch Task Scheduler chạy pythonw (không console) ⇒ ghi kết quả ra file
        i = a.index("--log")
        if i + 1 >= len(a):
            loi("--log cần đường dẫn file", 2)
        f = open(a[i + 1], "w", encoding="utf-8")  # noqa: SIM115  (mở suốt đời tiến trình)
        sys.stdout = sys.stderr = f
        print(f"# {datetime.now().isoformat(timespec='seconds')}", flush=True)
        a = a[:i] + a[i + 2:]
    if not a or a[0] in ("-h", "--help", "help"):
        in_ra([__doc__.strip()])
        sys.exit(0)
    lenh, tks = a[0], [t.lower() for t in a[1:]]
    sai = [t for t in tks if t not in TAI_KHOAN]
    if sai:
        loi(f"tài khoản không biết: {', '.join(sai)} (chỉ có {', '.join(TAI_KHOAN)})", 2)
    if lenh == "login":
        if len(tks) != 1:
            loi("login cần đúng 1 tài khoản", 2)
        cmd_login(tks[0])
    elif lenh in ("doc", "ghi"):
        cmd_doc(tks, lenh == "ghi")
    else:
        loi(f"lệnh không biết: {lenh}", 2)


if __name__ == "__main__":
    if sys.stdout is not None:  # pythonw: stdout = None
        sys.stdout.reconfigure(encoding="utf-8")
    main()
