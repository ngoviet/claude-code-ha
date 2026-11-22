# claude-code-ha

<!-- readme-axi type=ha -->

[English](README.md) · **Tiếng Việt**

Theo dõi tài khoản **Claude Code** trên Home Assistant: hạn mức gói thuê bao (phiên 5 giờ, tuần, từng model), chi phí và
token **API Console**, số dư / hạn credit, **giờ gia hạn gói chính xác tới giây** và **cảnh báo thanh toán lỗi**. Tất cả
nằm trên dashboard `/claude-code`, một card toàn trang. Đây là cấu hình của một nhà, không phải integration đóng gói sẵn:
máy Home Assistant và danh sách tài khoản khai trong script.

## Tính năng

- **Hạn mức gói** từng tài khoản: phiên 5 giờ, tuần mọi model và tuần từng model, đếm ngược tới mỗi lần reset, nhãn nhịp tiêu tuần (Tiêu nhanh / Đúng nhịp / Còn dư nhiều).
- **API Console**: chi phí hôm nay và tháng này, token hôm nay và 7 ngày, tỉ lệ đọc cache và tiền cache tiết kiệm, lấy từ Admin API chính thức.
- **Số dư và hạn credit**: không API nào trả, nên card giữ một số dư mốc do mình nhập rồi trừ phần đã chi từ đó; automation hằng ngày chốt các ngày đã đóng vào số mốc.
- **Giờ gia hạn gói**: PC1 đọc từ claude.ai mỗi ngày rồi ghi lên Home Assistant; cookie đăng nhập không rời PC1.
- **Cảnh báo thanh toán**: trạng thái gói khác `active` / `trialing` (ví dụ `past_due` sau một lần trừ tiền lỗi) thì card hiện khung đỏ kèm link claude.ai › Billing.
- **Biểu đồ 7 ngày** hạn mức tuần và phiên 5 giờ của từng tài khoản.

## Cài đặt

| Phần | Tệp | Chạy ở đâu |
| --- | --- | --- |
| Hạn mức gói (5 giờ / tuần / model) | integration HACS [`trickv/hass-claude-usage`](https://github.com/trickv/hass-claude-usage) → `sensor.claude_<tk>_*` | HA (cài qua HACS, không nằm trong repo) |
| Chi phí, token, số dư API Console + helper (`input_number` / `input_datetime` / `input_text`) | [ha/62_claude_api_console.yaml](ha/62_claude_api_console.yaml) → `/config/packages/` | HA |
| Card + dashboard | [ha/claude-code-card.js](ha/claude-code-card.js), [ha/push.py](ha/push.py) | HA (đẩy từ PC1) |
| Giờ gia hạn + trạng thái gói (`subscription_details` của claude.ai, cần cookie) | [pc1/claude_gia_han.py](pc1/claude_gia_han.py) + Task Scheduler `HA - Claude gio gia han` 08:30 | **PC1** (cookie không lên HA) |

1. Cài **Claude Usage** qua HACS, thêm mỗi tài khoản một entry (trình duyệt đăng nhập claude.ai đúng tài khoản), rồi đổi entity sang `sensor.claude_<tk>_*`.
2. Trên PC1, bằng Python hệ thống có `paramiko`, `websocket-client`, `playwright` (dùng Chrome cài sẵn), đẩy package và card:

   ```powershell
   python ha/push.py --xem   # so tệp trên HA với repo, không ghi
   python ha/push.py         # đẩy package + card, nạp lại nếu package đổi, ghi dashboard
   ```

3. Đăng nhập một lần cho mỗi tài khoản để lấy giờ gia hạn, rồi hẹn lịch `ghi` hằng ngày (mục Task Scheduler chạy `pythonw.exe … ghi --log %USERPROFILE%\.claude-gia-han\lan-chay-cuoi.log`):

   ```powershell
   python pc1/claude_gia_han.py login <tk>   # mở Chrome, chủ tự đăng nhập claude.ai
   python pc1/claude_gia_han.py doc          # đọc giờ gia hạn + trạng thái gói (chỉ đọc)
   python pc1/claude_gia_han.py ghi          # ghi lên HA (lịch 08:30 chạy lệnh này)
   ```

## Cấu hình

- `HA_PASS` (SSH), `HA_TOKEN`, `HA_URL` đọc từ `.env` của repo HA-Config (`D:/code/HA-Config/.env`, đổi bằng biến `HA_CONFIG_ENV`). Không chép khoá vào repo này.
- Admin API key để trong `/config/secrets.yaml` trên HA, tên `anthropic_admin_key_<tk>` (`sk-ant-admin01-…`, Console phải là **Organization**). Dán key xong thì **khởi động lại HA**: `rest.reload` không nạp key mới.
- Số dư credit: sau mỗi kỳ cấp credit hoặc nạp tiền, bấm *sửa* cạnh "Tín dụng còn lại" trên card, dán số Console đang hiện; card tự cộng phần đã trừ. Hạn dùng: bấm *sửa* cạnh "Hạn dùng" (`2000-01-01` = chưa nhập).
- Giới hạn bậc tháng cũng không có API: khai `month_limit` từng tài khoản trong `ha/accounts.local.json` (không commit; `ha/push.py` ghép vào `ACCOUNTS`).
- Hồ sơ trình duyệt claude.ai ở `%USERPROFILE%\.claude-gia-han\<tk>`, **không** để trong `AppData` (Claude Desktop là gói MSIX, ghi vào `AppData\Local` bị chuyển hướng ⇒ Task Scheduler không thấy).
- Thêm tài khoản: thêm entry Claude Usage, đổi entity, thêm khối REST + secret + helper trong package, rồi thêm dòng ở `ACCOUNTS` (`ha/push.py`) và `TAI_KHOAN` (`pc1/claude_gia_han.py`).
- Còn dùng chung với HA-Config: `.env`, theme `palette-axi-neon`, secret `anthropic_admin_key_<tk>`.

## Thực thể

Hạn mức gói, từ integration HACS:

- `sensor.claude_<tk>_session_usage`, `_week_usage`, `_weekly_fable_limit_usage` (%) · `_session_reset_time`, `_weekly_reset_time` (timestamp)
- `sensor.claude_<tk>_week_usage_pace` = % đã dùng − % thời gian tuần đã trôi (dương = tiêu nhanh hơn đều)
- `sensor.claude_<tk>_api_error` (0/1). Hạn mức theo model khác tự xuất hiện thành `*_weekly_<model>_limit_usage`

API Console, từ package:

- `sensor.claude_api_<tk>_cost_today`, `_cost_month`, `_cache_saved_month`, `_credit_balance` (USD)
- `sensor.claude_api_<tk>_tokens_today`, `_tokens_7d`, `_tokens_prev_7d`, `_cache_hit_7d` (%)
- Helper: `input_number.claude_api_<tk>_credit_base`, `input_datetime.claude_api_<tk>_credit_base_date`, `_credit_expiry`, `_plan_renew` (có giờ), `input_text.claude_api_<tk>_plan_status`

Chi tiết nguồn dữ liệu, entity, bẫy đã gặp: [docs/claude-code-quota.md](docs/claude-code-quota.md).

## Xử lý sự cố

- **Không gọi `homeassistant.reload_all`** sau khi đổi package: nó nạp lại `rest` của mọi package ⇒ hàng loạt lỗi "unique ID … already exists". `ha/push.py` chỉ nạp lại input_*/template/automation; đổi khối `rest:` hay Admin key thì phải khởi động lại.
- Admin API trả **403** với tổ chức cá nhân dù key đúng loại ⇒ chuyển Console thành tổ chức. Key `sk-ant-usr-…` gắn workspace ⇒ **401**; phải tạo key phạm vi organization.
- Sensor API `unavailable` khi chưa có key đúng; lúc đó card hiện lời nhắc "chưa có Admin key" thay vì số 0.
- `cost_closed` `unavailable` từ lúc chốt ngày tới 07:00 giờ VN là bình thường: hôm đó `cost_report` chưa có ngày đã đóng.
- Giữ chu kỳ đọc của integration ở 300 s (gọi dồn có thể bị chặn khoảng 24 giờ) và không gọi thêm `api.anthropic.com/api/oauth/*` bằng token của nó: 8 lượt thử ngày 04/11/2026 làm cả 2 tài khoản bị 429 khoảng 70 phút, mà integration không tự lùi. Bị chặn thì tăng `update_interval` trong tuỳ chọn entry, hết lỗi trả về 300; đừng đăng nhập lại.
- Log giờ gia hạn báo phiên hết hạn hoặc bị chặn: chạy lại `python pc1/claude_gia_han.py login <tk>`. Google chặn đăng nhập trong trình duyệt do Playwright điều khiển, nên `login` mở Chrome thường.
- HA báo *Re-authenticate* trên entry Claude Usage (chuỗi refresh OAuth sống khoảng 30 ngày) thì đăng nhập lại; card hiện lỗi đọc API khi `api_error = 1`.

## Phát triển

```powershell
python ha/push.py --xem      # trên HA khác gì (mã thoát 1 nếu có tệp khác)
python ha/push.py --ghi-de   # đẩy đè cả tệp đã bị sửa trên HA, sau khi đã xem khác gì
```

- Kiểm giao diện card: bộ thử của HA-Config (`python tools/card-harness/build.py` rồi `design-kit check tools/card-harness/out/claude-code-card.html --schemes dark --strict`, chạy trong HA-Config; nó chép `ha/claude-code-card.js` từ repo này).
- Màu theo theme dark neon của palette-axi; `palette-axi analyze ha/claude-code-card.js --bg "#0a1122"` phải 7/7.
- Trước 22/11/2026 các tệp này nằm trong repo HA-Config (`dashboards/claude/`, `packages/62_claude_api_console.yaml`, `tools/claude_gia_han.py`, `docs/claude-code-quota.md`); lịch sử git đã chuyển theo.
- `.github/workflows/readme.yml` kiểm hai README theo khung [readme-axi](https://github.com/ngoviet/readme-axi).

<!-- support:start -->
## Ủng hộ dự án

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/banner-v2.svg" width="560" alt="Built and maintained by one person in Việt Nam">
</p>

<p align="center">Một người Việt tự xây dựng và duy trì, miễn phí và mã nguồn mở. Sự ủng hộ của bạn giúp hỗ trợ thêm thiết bị, sửa lỗi nhanh hơn và ra bản mới đều đặn.</p>

<p align="center">
  <a href="https://buymeacoffee.com/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-coffee.svg" height="56" alt="Buy me a coffee"></a>
  &nbsp;
  <a href="https://github.com/sponsors/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-sponsors.svg" height="56" alt="GitHub Sponsors"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/vietqr-card.svg" width="300" alt="VietQR — MB Bank — NGO DUC VIET — 911051212">
  &nbsp;
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/crypto-card.svg" width="300" alt="Crypto — BNB Smart Chain (BEP20) — 0xcbf0402b232cb24b4d998f09a4884f87b5f74750">
</p>

<p align="center"><b>Ví tiền mã hoá, chỉ gửi qua mạng BNB Smart Chain (BEP20):</b><br><code>0xcbf0402b232cb24b4d998f09a4884f87b5f74750</code></p>

<p align="center">🇻🇳 VietQR: quét bằng app ngân hàng bất kỳ, nội dung <code>Ung ho claude-code-ha</code>. Cảm ơn bạn đã giúp dự án tiếp tục phát triển!</p>
<!-- support:end -->

## Giấy phép

[MIT](LICENSE) © Ngô Đức Việt

Không liên kết với Anthropic.
