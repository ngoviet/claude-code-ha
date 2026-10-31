"""Đẩy dashboard "Claude Code" (/claude-code): hạn mức 2 tài khoản thuê bao + lượng dùng API Console của từng tài khoản.

Chạy:  python dashboards/claude/push.py   → ghi dashboard (WS lovelace/config/save; sửa .storage không có tác dụng)
Nguồn hạn mức: integration HACS `hass_claude_usage` (trickv, v10), mỗi tài khoản 1 entry OAuth.
Entity đã đổi tên gọn, không chứa tên gói: sensor.claude_<tài khoản>_* (tài khoản = vonupt, vokupt).
API Console: packages/62_claude_api_console.yaml → sensor.claude_api_<tài khoản>_*; Admin key dán thẳng vào
/config/secrets.yaml trên HA (`anthropic_admin_key_<tài khoản>`) rồi khởi động lại HA
(rest.reload để sensor cũ giữ key cũ: "unique ID … already exists - ignoring").
Tài liệu: docs/claude-code-quota.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import websocket  # type: ignore

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HA = "192.168.10.15:8123"
DASHBOARD_META = {
    "url_path": "claude-code", "title": "Claude Code", "icon": "mdi:robot-outline",
    "show_in_sidebar": True, "require_admin": False, "mode": "storage",
}
# (slug entity, nhãn hiển thị). Thêm tài khoản: thêm entry trong HA, đổi entity_id sang sensor.claude_<slug>_*,
# thêm khối REST + secret trong packages/62_claude_api_console.yaml, thêm dòng ở đây
ACCOUNTS = [("vonupt", "Vonupt"), ("vokupt", "Vokupt")]
SEVERITY = {"green": 0, "yellow": 60, "red": 85}

# Đếm ngược tới mốc reset; khi chưa có cửa sổ (vd phiên 5 giờ chưa mở) thì nói rõ
COUNTDOWN = (
    "{% macro cd(e) %}{% set t = states(e) | as_datetime %}"
    "{% if t %}{% set s = (t - now()).total_seconds() | int %}"
    "{% if s > 0 %}reset sau **{% if s >= 86400 %}{{ s // 86400 }} ngày {% endif %}{{ (s % 86400) // 3600 }} giờ {{ (s % 3600) // 60 }} phút**"
    "{% else %}**đã reset**{% endif %} · {{ as_local(t).strftime('%H:%M %d/%m') }}"
    "{% else %}chưa mở (chưa dùng từ lần reset trước){% endif %}{% endmacro %}"
)


def account_section(slug: str, label: str) -> dict:
    s = f"sensor.claude_{slug}"
    a = f"sensor.claude_api_{slug}"
    md = (
        COUNTDOWN
        # Không hiện tên gói: API profile ghi "Max" trong khi desktop app ghi "Ultra" cho cùng tài khoản
        + f"⏱ **Phiên 5 giờ:** {{{{ cd('{s}_session_reset_time') }}}}\n\n"
        + f"📅 **Tuần:** {{{{ cd('{s}_weekly_reset_time') }}}}\n\n"
        + f"{{% set p = states('{s}_week_usage_pace') | float(none) %}}"
        + "{% if p is not none %}🏃 **Nhịp tuần:** {{ '%+.0f' % p }} điểm so với tiêu đều"
        + "{% if p > 15 %} — đang tiêu nhanh{% elif p < -15 %} — còn dư nhiều{% endif %}{% endif %}\n\n"
        + f"{{% if is_state('{s}_api_error', '1') %}}⚠️ **Lỗi đọc API** — số có thể cũ. Nếu HA báo *Re-authenticate*, đăng nhập lại entry Claude Usage.{{% endif %}}"
        + f"\n{{% set st = states['{s}_week_usage'] %}}"
        + "<small>Đọc API {{ ((now() - st.last_reported).total_seconds() // 60) | int if st else '?' }} phút trước · poll 5 phút/lần</small>"
    )
    no_key = (
        f"{{% if not has_value('{a}_cost_month') %}}**API Console:** chưa có số liệu. Dán Admin key "
        f"(`sk-ant-admin01-…`) của {label} vào `/config/secrets.yaml`, dòng `anthropic_admin_key_{slug}`, "
        "rồi **khởi động lại HA** (Cài đặt → ⋮ → Khởi động lại; tải lại RESTful KHÔNG nạp key mới).{% endif %}"
    )
    # card conditional coi entity chưa có giá trị là không khớp ⇒ khối số liệu chỉ hiện khi có key đúng
    has = {"condition": "state", "entity": f"{a}_cost_month", "state_not": "unavailable"}
    return {
        "type": "grid",
        "cards": [
            {"type": "heading", "heading": label, "icon": "mdi:account-circle"},
            {"type": "gauge", "entity": f"{s}_session_usage", "name": "Phiên 5 giờ", "unit": "%",
             "min": 0, "max": 100, "needle": True, "severity": SEVERITY, "grid_options": {"columns": 4}},
            {"type": "gauge", "entity": f"{s}_week_usage", "name": "Tuần · mọi model", "unit": "%",
             "min": 0, "max": 100, "needle": True, "severity": SEVERITY, "grid_options": {"columns": 4}},
            {"type": "gauge", "entity": f"{s}_weekly_fable_limit_usage", "name": "Tuần · Fable", "unit": "%",
             "min": 0, "max": 100, "needle": True, "severity": SEVERITY, "grid_options": {"columns": 4}},
            {"type": "markdown", "content": md},
            {"type": "conditional", "conditions": [has], "card": {
                "type": "entities", "title": "API · Claude Console", "state_color": False, "entities": [
                    {"entity": f"{a}_cost_today", "name": "Chi phí hôm nay (UTC)"},
                    {"entity": f"{a}_cost_month", "name": "Chi phí tháng này"},
                    {"entity": f"{a}_tokens_today", "name": "Token hôm nay"},
                    {"entity": f"{a}_tokens_7d", "name": "Token 7 ngày"},
                ], "footer": {"type": "graph", "entity": f"{a}_cost_month", "hours_to_show": 720}}},
            {"type": "markdown", "content": no_key, "visibility": [
                {"condition": "state", "entity": f"{a}_cost_month", "state": "unavailable"}]},
        ],
    }


def history_section() -> dict:
    colors = ["#e0773c", "#3c8ee0"]
    week = [{"entity": f"sensor.claude_{slug}_week_usage", "name": f"{label} · tuần", "color": colors[i],
             "stroke_width": 3, "extend_to": "now"} for i, (slug, label) in enumerate(ACCOUNTS)]
    sess = [{"entity": f"sensor.claude_{slug}_session_usage", "name": f"{label} · 5 giờ", "color": colors[i],
             "stroke_width": 1, "opacity": 0.5, "curve": "stepline", "extend_to": "now"} for i, (slug, label) in enumerate(ACCOUNTS)]
    common = {"type": "custom:apexcharts-card", "graph_span": "7d", "update_interval": "5min",
              "yaxis": [{"min": 0, "max": 100, "decimals": 0}],
              "apex_config": {"legend": {"show": True}, "chart": {"height": 260}}}
    return {
        "type": "grid", "column_span": 2,
        "cards": [
            {"type": "heading", "heading": "Lịch sử 7 ngày", "icon": "mdi:chart-line"},
            {**common, "header": {"show": True, "title": "% hạn mức tuần"}, "series": week},
            {**common, "graph_span": "2d", "header": {"show": True, "title": "% phiên 5 giờ (2 ngày)"}, "series": sess},
            {"type": "markdown", "content": "<small>API Console: ngày tính theo UTC (đổi ngày lúc 07:00 giờ VN), giống "
             "[dashboard Console](https://platform.claude.com/dashboard); số trễ ~5 phút, HA đọc 10 phút/lần.</small>"},
        ],
    }


CONFIG = {"title": "Claude Code", "views": [{
    "title": "Hạn mức", "path": "han-muc", "icon": "mdi:gauge", "type": "sections", "max_columns": 2,
    "sections": [*(account_section(s, l) for s, l in ACCOUNTS), history_section()],
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
    ws = WS(load_env()["HA_TOKEN"])
    if not any(d["url_path"] == DASHBOARD_META["url_path"] for d in ws.call({"type": "lovelace/dashboards/list"})["result"]):
        ws.call({"type": "lovelace/dashboards/create", **DASHBOARD_META})
        print(f"Đã tạo dashboard /{DASHBOARD_META['url_path']}")
    ws.call({"type": "lovelace/config/save", "url_path": DASHBOARD_META["url_path"], "config": CONFIG})
    print(f"Đã ghi → http://{HA}/{DASHBOARD_META['url_path']}/han-muc")


if __name__ == "__main__":
    main()
