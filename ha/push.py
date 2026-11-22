"""Đẩy phía HA của "Claude Code" lên Home Assistant: package + card + dashboard /claude-code.

Chạy (Python hệ thống của PC1, cần `paramiko` + `websocket-client`):
  python ha/push.py            ghi tệp, nạp lại nếu package đổi, cập nhật resource + dashboard;
                               dừng nếu tệp trên HA đã bị sửa ngoài repo
  python ha/push.py --ghi-de   như trên, ghi đè cả tệp đã bị sửa trên HA (sau khi đã xem khác gì)
  python ha/push.py --xem      chỉ so tệp trên HA với tệp ở đây (băm SHA-1), không ghi; mã thoát 1 nếu có tệp khác

  1. SSH + base64 (host không có sftp-server): 62_claude_api_console.yaml → /config/packages/,
     claude-code-card.js → /config/www/claude/ (URL /local/claude/…)
  2. Package đổi ⇒ reload input_number/input_datetime/input_text/template/automation (KHÔNG reload_all, KHÔNG
     rest.reload). Đổi khối `rest:` hay Admin key trong secrets.yaml ⇒ khởi động lại HA (docs/claude-code-quota.md).
  3. WS: resource `?v=<hash>` (đổi file là app tải bản mới), tạo dashboard nếu chưa có, ghi view panel
     (lovelace/config/save; sửa .storage không có tác dụng).
Nguồn hạn mức: integration HACS `hass_claude_usage` (trickv) → sensor.claude_<tài khoản>_*.

`HA_PASS` (SSH) và `HA_TOKEN` (API) đọc từ `.env` của repo HA-Config (mặc định D:/code/HA-Config/.env, đổi bằng
biến môi trường `HA_CONFIG_ENV`): không chép khoá sang repo này.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import paramiko
import websocket  # type: ignore

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV = Path(os.environ.get("HA_CONFIG_ENV", "D:/code/HA-Config/.env"))
HA_HOST = "192.168.12.20"
HA = f"{HA_HOST}:8123"
CARD = HERE / "claude-code-card.js"
PACKAGE = HERE / "62_claude_api_console.yaml"
CARD_URL = f"/local/claude/{CARD.name}"
FILES = {
    PACKAGE: f"/config/packages/{PACKAGE.name}",
    CARD: f"/config/www/claude/{CARD.name}",
}
DASHBOARD_META = {
    "url_path": "claude-code", "title": "Claude Code", "icon": "mdi:robot-outline",
    "show_in_sidebar": True, "require_admin": False, "mode": "storage",
}
# Thêm tài khoản: thêm entry Claude Usage trong HA, đổi entity_id sang sensor.claude_<slug>_*,
# thêm khối REST + secret + helper trong 62_claude_api_console.yaml, thêm dòng ở đây và ở TAI_KHOAN của pc1/claude_gia_han.py.
# month_limit = "giới hạn bậc" (USD/tháng) trên dashboard Console; API không trả, bỏ trống thì không vẽ thanh.
ACCOUNTS = [{"slug": "vonupt", "name": "Vonupt", "plan": "Ultra"},
            {"slug": "vokupt", "name": "Vokupt", "plan": "Ultra"}]
CONFIG = {"title": "Claude Code", "views": [{
    "title": "Hạn mức", "path": "han-muc", "icon": "mdi:gauge", "type": "panel",
    "theme": "palette-axi-neon",  # theme chung của nhà (HA-Config themes/), không nằm trong repo này
    "cards": [{"type": "custom:claude-code-card", "accounts": ACCOUNTS}],
}]}
RELOAD = ("input_number", "input_datetime", "input_text", "template", "automation")
CR, LF = bytes([13]), bytes([10])
RONG = hashlib.sha1(b"").hexdigest()


def load_env() -> dict[str, str]:
    if not ENV.is_file():
        raise SystemExit(f"Không thấy {ENV} (HA_PASS, HA_TOKEN). Đặt biến HA_CONFIG_ENV trỏ tới tệp .env của HA-Config.")
    env = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.strip().split("=", 1)
            env[k] = v.strip().strip('"')
    return env


def noi_dung(src: Path) -> bytes:
    """Bytes ghi lên HA: luôn LF (checkout Windows có thể là CRLF — so băm theo bản này cho khỏi báo lệch giả)."""
    return src.read_bytes().replace(CR + LF, LF)


def bam(b: bytes) -> str:
    return hashlib.sha1(b).hexdigest()


def ket_noi(env: dict[str, str]) -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HA_HOST, username="vokupt", password=env["HA_PASS"], timeout=10)
    return ssh


def bam_live(ssh: paramiko.SSHClient, dst: str) -> str:
    """SHA-1 của tệp trên HA; tệp chưa có thì ra băm của chuỗi rỗng (RONG)."""
    _, stdout, _ = ssh.exec_command(f"sudo cat {dst} 2>/dev/null | sha1sum")
    return stdout.read().decode().split()[0]


def xem(env: dict[str, str]) -> int:
    ssh = ket_noi(env)
    khac = 0
    try:
        for src, dst in FILES.items():
            tren_ha = bam_live(ssh, dst)
            if tren_ha == bam(noi_dung(src)):
                print(f"= ha/{src.name} giống {dst}")
            else:
                khac += 1
                print(f"≠ ha/{src.name} {'chưa có trên HA:' if tren_ha == RONG else 'khác'} {dst}")
    finally:
        ssh.close()
    print(f"{khac} tệp khác / {len(FILES)}")
    return khac


def deploy(env: dict[str, str], ghi_de: bool) -> set[Path]:
    """Ghi các tệp khác bản trên HA. Trả tập tệp đã ghi."""
    ssh = ket_noi(env)
    da_ghi: set[Path] = set()
    try:
        # Kéo băm bản live ngay trước khi ghi: phiên khác có thể đã sửa thẳng trên HA.
        # Hợp lệ: trùng bản sắp ghi, trùng bản đã commit (HEAD) — tức chỉ repo đổi — hoặc chưa có trên HA.
        live, khac = {}, []
        for src, dst in FILES.items():
            head = subprocess.run(["git", "show", f"HEAD:{src.relative_to(ROOT).as_posix()}"], cwd=ROOT,
                                  capture_output=True).stdout.replace(CR + LF, LF)
            live[src] = bam_live(ssh, dst)
            if live[src] not in {bam(noi_dung(src)), bam(head), RONG}:
                khac.append((src, dst))
        if khac:
            print("Tệp trên HA khác bản repo:")
            for src, dst in khac:
                print(f"  {dst}  (repo: ha/{src.name})")
            if not ghi_de:
                raise SystemExit("Dừng — so bản live (`sudo cat`) với repo rồi chạy lại với --ghi-de nếu đúng là ghi đè")
        for src, dst in FILES.items():
            if live[src] == bam(noi_dung(src)):
                print(f"= ha/{src.name} (không đổi)")
                continue
            parent = dst.rsplit("/", 1)[0]
            stdin, stdout, stderr = ssh.exec_command(f"sudo mkdir -p {parent} && sudo sh -c 'base64 -d > {dst}'")
            stdin.write(base64.b64encode(noi_dung(src)))
            stdin.channel.shutdown_write()
            if stdout.channel.recv_exit_status() != 0:
                raise SystemExit(f"Ghi {dst} lỗi: {stderr.read().decode()}")
            da_ghi.add(src)
            print(f"✓ ha/{src.name} → {dst}")
    finally:
        ssh.close()
    return da_ghi


class WS:
    def __init__(self, token: str) -> None:
        self.ws = websocket.create_connection(f"ws://{HA}/api/websocket", timeout=60)
        self.ws.recv()
        self.ws.send(json.dumps({"type": "auth", "access_token": token}))
        if json.loads(self.ws.recv())["type"] != "auth_ok":
            raise SystemExit("WS auth thất bại")
        self.n = 0

    def call(self, msg: dict) -> dict:
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, **msg}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.n:
                if not r.get("success"):
                    raise SystemExit(f"{msg['type']} thất bại: {r}")
                return r


def main() -> None:
    args = sys.argv[1:]
    if args not in ([], ["--ghi-de"], ["--xem"]):
        sys.exit("Dùng: python ha/push.py [--xem | --ghi-de]")
    env = load_env()
    if args == ["--xem"]:
        sys.exit(1 if xem(env) else 0)
    da_ghi = deploy(env, args == ["--ghi-de"])
    ws = WS(env["HA_TOKEN"])
    if PACKAGE in da_ghi:
        # Không dùng homeassistant.reload_all: nó nạp lại cả `rest` của mọi package ⇒ hàng loạt lỗi "unique ID already
        # exists" (rest không reload sạch) — gặp 2026-11-22, ngay sau đó HA bị restart. Chỉ nạp các domain an toàn.
        for domain in RELOAD:
            ws.call({"type": "call_service", "domain": domain, "service": "reload"})
        print(f"Đã nạp lại: {', '.join(RELOAD)}. Đổi khối `rest:` (URL, header, sensor REST) thì phải KHỞI ĐỘNG LẠI HA.")
    url = f"{CARD_URL}?v={bam(noi_dung(CARD))[:8]}"
    found = [r for r in ws.call({"type": "lovelace/resources"})["result"] if r["url"].split("?")[0] == CARD_URL]
    if not found:
        ws.call({"type": "lovelace/resources/create", "res_type": "module", "url": url})
        print(f"Resource mới → {url}")
    elif found[0]["url"] != url:
        ws.call({"type": "lovelace/resources/update", "resource_id": found[0]["id"], "res_type": "module", "url": url})
        print(f"Resource → {url}")
    if not any(d["url_path"] == DASHBOARD_META["url_path"] for d in ws.call({"type": "lovelace/dashboards/list"})["result"]):
        ws.call({"type": "lovelace/dashboards/create", **DASHBOARD_META})
        print(f"Đã tạo dashboard /{DASHBOARD_META['url_path']}")
    ws.call({"type": "lovelace/config/save", "url_path": DASHBOARD_META["url_path"], "config": CONFIG})
    print(f"Đã ghi → http://{HA}/{DASHBOARD_META['url_path']}/han-muc")


if __name__ == "__main__":
    main()
