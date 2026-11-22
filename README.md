# claude-code-ha

Theo dõi tài khoản **Claude Code** trên Home Assistant của nhà: hạn mức gói thuê bao (phiên 5 giờ, tuần, từng model),
chi phí và token **API Console**, số dư / hạn credit, **giờ gia hạn gói chính xác tới giây** và **cảnh báo thanh toán lỗi**.
Dashboard `/claude-code` (một card toàn trang).

> Trước 22/11/2026 các tệp này nằm trong repo HA-Config (`dashboards/claude/`, `packages/62_claude_api_console.yaml`,
> `tools/claude_gia_han.py`, `docs/claude-code-quota.md`); lịch sử git đã chuyển theo.

## Thành phần

| Phần | Tệp | Chạy ở đâu |
| --- | --- | --- |
| Hạn mức gói (5 giờ / tuần / model) | integration HACS [`trickv/hass-claude-usage`](https://github.com/trickv/hass-claude-usage) → `sensor.claude_<tk>_*` | HA (cài qua HACS, không nằm trong repo) |
| Chi phí, token, số dư API Console + helper (`input_number` / `input_datetime` / `input_text`) | [ha/62_claude_api_console.yaml](ha/62_claude_api_console.yaml) → `/config/packages/` | HA |
| Card + dashboard | [ha/claude-code-card.js](ha/claude-code-card.js), [ha/push.py](ha/push.py) | HA (đẩy từ PC1) |
| Giờ gia hạn + trạng thái gói (`subscription_details` của claude.ai, cần cookie) | [pc1/claude_gia_han.py](pc1/claude_gia_han.py) + Task Scheduler `HA - Claude gio gia han` 08:30 | **PC1** (cookie không lên HA) |

Chi tiết nguồn dữ liệu, entity, bẫy đã gặp: [docs/claude-code-quota.md](docs/claude-code-quota.md).

## Dùng

```powershell
python ha/push.py --xem          # so tệp trên HA với repo, không ghi
python ha/push.py                # đẩy package + card, nạp lại nếu package đổi, ghi dashboard
python pc1/claude_gia_han.py doc # đọc giờ gia hạn + trạng thái gói (chỉ đọc)
python pc1/claude_gia_han.py ghi # ghi lên HA (lịch 08:30 chạy lệnh này)
python pc1/claude_gia_han.py login vokupt   # khi phiên claude.ai hết hạn
```

- `HA_PASS`, `HA_TOKEN`, `HA_URL` đọc từ `.env` của repo HA-Config (`D:/code/HA-Config/.env`, đổi bằng biến
  `HA_CONFIG_ENV`). Không chép khoá vào repo này.
- Python hệ thống của PC1, cần `paramiko`, `websocket-client`, `playwright` (dùng Chrome cài sẵn).
- Hồ sơ trình duyệt claude.ai ở `%USERPROFILE%\.claude-gia-han\<tk>` — **không** để trong `AppData` (Claude Desktop là
  gói MSIX, ghi vào `AppData\Local` bị chuyển hướng ⇒ Task Scheduler không thấy).
- Còn phụ thuộc HA-Config: `.env`, theme `palette-axi-neon`, secret `anthropic_admin_key_<tk>` trong `/config/secrets.yaml`.
