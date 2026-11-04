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

API: `sensor.claude_api_<tài khoản>_cost_today`, `_cost_month`, `_cache_saved_month` (USD), `_tokens_today`, `_tokens_7d`, `_tokens_prev_7d`, `_cache_hit_7d` (%), `_credit_balance` (USD).

### Số dư và hạn tín dụng

**Không API nào trả số dư hay hạn dùng** (dò Admin API 2026-11-04: chỉ có `spend_limits` cho Enterprise, Console báo `organization_type_not_supported`). Trang Console đọc endpoint nội bộ bằng cookie đăng nhập; không dùng vì phải cất phiên đăng nhập toàn quyền trên HA.

- Số dư = `input_number.claude_api_<tk>_credit_base` (số dư lúc 00:00 UTC ngày `input_datetime.claude_api_<tk>_credit_base_date`) − `cost_since_base` (analytics).
- Automation `Claude API — chốt chi phí ngày đã đóng vào số dư mốc` (12:05 hằng ngày) chuyển các ngày đã đóng từ `cost_closed` vào số mốc và dời ngày mốc, vì analytics chỉ tính tối đa 31 ngày một lần.
- Credit gói ([Max 100, Ultra 200 USD/kỳ](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans)) **hết kỳ thanh toán là mất phần thừa, không chuyển kỳ**, chỉ dùng cho API, Agent SDK, Managed Agents, Playground (không cho Claude Code); được tiêu trước credit tự mua. Số dư tính ra chỉ đúng trong kỳ: qua hạn card báo nhập lại.
- **Sau mỗi kỳ cấp credit hoặc nạp tiền**: bấm *sửa* cạnh "Tín dụng còn lại" trên card, dán số Console đang hiện; card tự cộng phần đã trừ. Đối chiếu Console thỉnh thoảng; số HA trễ hơn Console vài giờ (phần chi tiêu analytics chưa cập nhật).
- `cost_closed` `unavailable` từ lúc chốt tới 07:00 giờ VN là bình thường: ngày mốc = hôm nay UTC thì `cost_report` trả 400 (chưa có ngày đóng); số dư không phụ thuộc sensor này.
- Hạn dùng: bấm *sửa* cạnh "Hạn dùng" (`input_datetime.claude_api_<tk>_credit_expiry`, `2000-01-01` = chưa nhập). Lấy ngày ở Console › Billing › Promotional credits. Credit tự mua hết hạn [1 năm sau ngày mua](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-api-usage); nhiều đợt thì ghi hạn gần nhất.
- Ngày gia hạn gói: `input_datetime.claude_api_<tk>_plan_renew`, bấm *sửa* trên card, lấy ở claude.ai › Settings › Billing. API usage không trả ngày này; `~/.claude.json` chỉ có `subscriptionCreatedAt`. Qua ngày đã nhập thì card tự dời từng tháng (đúng với gói tháng; gói năm phải nhập lại). Credit tặng chưa nhập hạn riêng thì card lấy theo kỳ gói, ghi "theo kỳ gói".
- Giới hạn bậc tháng cũng không có API: khai `month_limit` trong `ACCOUNTS` ở `push.py`.

## Vận hành

- Giao diện: một card tự viết toàn trang [`dashboards/claude/claude-code-card.js`](../dashboards/claude/claude-code-card.js) (view `panel`, không cần card HACS): mỗi tài khoản 1 khối — vòng % tuần có vạch "tiêu đều", thanh 5 giờ / tuần / từng model (tự dò `*_weekly_*_limit_usage`), đếm ngược, nhãn nhịp (Tiêu nhanh / Đúng nhịp / Còn dư nhiều), khối API; dưới cùng mỗi tài khoản 1 biểu đồ 7 ngày (tuần và phiên 5 giờ) lấy qua WS `history/history_during_period` 10 phút/lần.
- Màu: theme **dark neon** của palette-axi (`generate --preset neon-dark`: nền navy, Vonupt = fuchsia, Vokupt = cyan, ok/warn/bad cùng dải sáng; khung, thanh, vòng, đường biểu đồ có quầng sáng neon). Token ghi bằng hex đã kẹp sRGB; kiểm: `palette-axi analyze dashboards/claude/claude-code-card.js --bg "#0a1122"` phải 7/7.
- Sửa dashboard: `python dashboards/claude/push.py` — chép JS lên `/config/www/claude/` qua SSH, cập nhật resource `?v=<hash>` (app tải bản mới), ghi view bằng WS `lovelace/config/save` (sửa `.storage` không có tác dụng).
- Bật phần API: trong `/config/secrets.yaml` trên HA đã có sẵn 2 dòng `anthropic_admin_key_vonupt` / `_vokupt` giá trị `"DAN_ADMIN_KEY_VAO_DAY"` → dán key vào giữa hai dấu nháy, rồi **khởi động lại HA**. Không cần PC1.
- Thêm tài khoản: Add Integration → Claude Usage (trình duyệt đăng nhập claude.ai đúng tài khoản), đổi entity_id sang `sensor.claude_<slug>_*`, thêm vào `ACCOUNTS` trong `push.py`.
- Chuỗi refresh OAuth sống ~30 ngày: khi HA báo *Re-authenticate* trên entry Claude Usage thì đăng nhập lại; card hiện "⚠️ Lỗi đọc API" khi `api_error = 1`.

## Bẫy đã gặp

- Tên gói trong device ("Max") khác desktop app ("Ultra") cho cùng tài khoản ⇒ tên gói khai tay trong `ACCOUNTS`.
- `rest.reload` **không** nạp key mới: sensor cũ cùng unique_id vẫn chạy với key cũ, bộ mới bị bỏ qua (log *"unique ID … already exists - ignoring"*) ⇒ đổi key phải restart HA.
- Admin API trả **403** với tổ chức cá nhân ("… Individual Org") dù key đúng loại ⇒ Console → Tổ chức → *Chuyển đổi thành nhóm*. Key `sk-ant-usr-…` gắn workspace ⇒ **401**; phải tạo key không gắn workspace (scope organization).
- Card `conditional` coi entity **chưa tồn tại** là không khớp mọi điều kiện (kể cả `state: unavailable`) ⇒ card tự viết tự hiện lời nhắc "chưa có Admin key" khi sensor API thiếu hoặc `unavailable`.
- `cost_report` và `usage_report` `bucket_width=1d` **không có ngày đang chạy**: trước 2026-11-04 ô "Hôm nay" thực ra là hôm qua. Chi phí hôm nay lấy từ `analytics/cost` (trễ ~1–4 giờ), token hôm nay từ `usage_report` `bucket_width=1h`.
- `input_datetime` mới tạo tự lấy ngày hiện tại, không rỗng ⇒ card coi `2000-01-01` là chưa nhập. Tên gói lấy từ `plan` trong `ACCOUNTS` (device ghi "Max" dù là Ultra).
- Giá trị `oklch()` làm tròn 3 chữ số có thể lệch nhẹ ra ngoài sRGB (palette-axi báo luật 7-gamut) ⇒ ghi token bằng hex đã kẹp.
