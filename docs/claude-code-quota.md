# Hạn mức Claude Code + lượng dùng API trên HA (2026-10-31)

Dashboard **`/claude-code`** ("Claude Code"): hạn mức gói thuê bao của 2 tài khoản (phiên 5 giờ, tuần mọi model, tuần Fable), đếm ngược tới reset, nhịp tiêu tuần, lịch sử; cùng chi phí/token **API** trên Claude Console.
Báo cáo nghiên cứu + so sánh phương án: https://claude.ai/artifact/XxvfCy29n5C8KouWa7J1JV

## Nguồn dữ liệu

| Phần | Nguồn | Ghi chú |
|---|---|---|
| Hạn mức thuê bao | Integration HACS **`hass_claude_usage`** ([trickv/hass-claude-usage](https://github.com/trickv/hass-claude-usage) v10) → `GET api.anthropic.com/api/oauth/usage` (endpoint sau `/usage`, **không công bố**) | Mỗi tài khoản 1 entry OAuth (luồng đăng nhập của Anthropic, scope chỉ `user:profile` ⇒ token **không chạy được model**). Poll 300 s (đừng hạ: gọi dồn bị chặn ~24 giờ, mất luôn `/usage` trong Claude Code) |
| API Console | Admin API chính thức `cost_report` + `usage_report/messages` → [packages/62_claude_api_console.yaml](../packages/62_claude_api_console.yaml) | **Mỗi tài khoản 1 Admin key** (Console riêng): secret `anthropic_admin_key_vonupt`, `anthropic_admin_key_vokupt` (`sk-ant-admin01-…`, Console phải là **Organization**). Ngày theo **UTC**. `amount` tính bằng **cent**. Key chưa có/sai ⇒ sensor `unavailable` |

Chủ chọn integration HACS (chạy cả khi PC1 tắt), chấp nhận token OAuth nằm trên HA và trong backup HA.

## Entity

`sensor.claude_<tài khoản>_*`, tài khoản = `vonupt`, `vokupt` (đã đổi từ `sensor.claude_usage_<tên>_ultra_*`; bỏ tên gói vì gói đổi thì entity_id không đổi theo):

- `session_usage`, `week_usage`, `weekly_fable_limit_usage` (%) · `session_reset_time`, `weekly_reset_time` (timestamp)
- `week_usage_pace` = % đã dùng − % thời gian tuần đã trôi (dương = tiêu nhanh hơn đều)
- `api_error` (0/1). Hạn mức theo model khác (Opus…) xuất hiện tự động thành `*_weekly_<model>_limit_usage`

API: `sensor.claude_api_<tài khoản>_cost_today`, `_cost_month` (USD), `_tokens_today`, `_tokens_7d`.

## Vận hành

- Sửa dashboard: `python dashboards/claude/push.py` (WS `lovelace/config/save`; sửa `.storage` không có tác dụng).
- Bật phần API: trong `/config/secrets.yaml` trên HA đã có sẵn 2 dòng `anthropic_admin_key_vonupt` / `_vokupt` giá trị `"DAN_ADMIN_KEY_VAO_DAY"` → dán key vào giữa hai dấu nháy, rồi Công cụ nhà phát triển → YAML → Tải lại **RESTful** (`rest.reload`, không cần restart). Không cần PC1.
- Thêm tài khoản: Add Integration → Claude Usage (trình duyệt đăng nhập claude.ai đúng tài khoản), đổi entity_id sang `sensor.claude_<slug>_*`, thêm vào `ACCOUNTS` trong `push.py`.
- Chuỗi refresh OAuth sống ~30 ngày: khi HA báo *Re-authenticate* trên entry Claude Usage thì đăng nhập lại; card hiện "⚠️ Lỗi đọc API" khi `api_error = 1`.

## Bẫy đã gặp

- Tên gói trong device ("Max") khác desktop app ("Ultra") cho cùng tài khoản ⇒ dashboard không hiện tên gói.
- Card `conditional` coi entity **chưa tồn tại** là không khớp mọi điều kiện (kể cả `state: unavailable`) ⇒ lời nhắc "chưa có Admin key" nằm trong markdown với `has_value()`.
