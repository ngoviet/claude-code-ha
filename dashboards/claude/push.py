"""Đẩy dashboard "Claude Code" (/claude-code): một card toàn trang `claude-code-card` (hạn mức 2 tài khoản + API Console).

Chạy:  python dashboards/claude/push.py
  1. SSH + base64 (host không có sftp-server): claude-code-card.js → /config/www/claude/ (URL /local/claude/…)
  2. WS: resource `?v=<hash>` (đổi file là app tải bản mới), tạo dashboard nếu chưa có, ghi view panel
     (lovelace/config/save; sửa .storage không có tác dụng).
Nguồn hạn mức: integration HACS `hass_claude_usage` (trickv, v10) → sensor.claude_<tài khoản>_*.
API Console: packages/62_claude_api_console.yaml → sensor.claude_api_<tài khoản>_*; Admin key trong
/config/secrets.yaml (`anthropic_admin_key_<tài khoản>`), đổi key phải khởi động lại HA (rest.reload không nạp).
Tài liệu: docs/claude-code-quota.md
"""
from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import paramiko
import websocket  # type: ignore

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HA = "192.168.10.15:8123"
CARD = HERE / "claude-code-card.js"
CARD_URL = f"/local/claude/{CARD.name}"
DASHBOARD_META = {
    "url_path": "claude-code", "title": "Claude Code", "icon": "mdi:robot-outline",
    "show_in_sidebar": True, "require_admin": False, "mode": "storage",
}
# Thêm tài khoản: thêm entry Claude Usage trong HA, đổi entity_id sang sensor.claude_<slug>_*,
# thêm khối REST + secret trong packages/62_claude_api_console.yaml, thêm dòng ở đây.
# month_limit = "giới hạn bậc" (USD/tháng) trên dashboard Console; API không trả, bỏ trống thì không vẽ thanh.
ACCOUNTS = [{"slug": "vonupt", "name": "Vonupt"}, {"slug": "vokupt", "name": "Vokupt"}]
CONFIG = {"title": "Claude Code", "views": [{
    "title": "Hạn mức", "path": "han-muc", "icon": "mdi:gauge", "type": "panel",
    "cards": [{"type": "custom:claude-code-card", "accounts": ACCOUNTS}],
}]}


def load_env() -> dict[str, str]:
    env = {}
    # worktree trong .claude/worktrees/ không có .env → lấy của checkout chính ở thư mục cha
    path = next(p / ".env" for p in (ROOT, *ROOT.parents) if (p / ".env").is_file())
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.strip().split("=", 1)
            env[k] = v.strip().strip('"')
    return env


def deploy(env: dict[str, str]) -> None:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect("192.168.10.15", username="vokupt", password=env["HA_PASS"], timeout=10)
    try:
        dst = f"/config/www/claude/{CARD.name}"
        stdin, stdout, stderr = ssh.exec_command(f"sudo mkdir -p /config/www/claude && sudo sh -c 'base64 -d > {dst}'")
        stdin.write(base64.b64encode(CARD.read_bytes()))
        stdin.channel.shutdown_write()
        if stdout.channel.recv_exit_status() != 0:
            raise SystemExit(f"Ghi {dst} lỗi: {stderr.read().decode()}")
        print(f"✓ {CARD.relative_to(ROOT)} → {dst}")
    finally:
        ssh.close()


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
    env = load_env()
    deploy(env)
    ws = WS(env["HA_TOKEN"])
    url = f"{CARD_URL}?v={hashlib.sha1(CARD.read_bytes()).hexdigest()[:8]}"
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
