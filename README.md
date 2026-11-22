# claude-code-ha

<!-- readme-axi type=ha -->

**English** · [Tiếng Việt](README.vi.md)

Tracks **Claude Code** accounts on Home Assistant: subscription usage limits (5-hour session, week, per model), **Claude
Console API** cost and tokens, credit balance and expiry, the **exact plan renewal time down to the second**, and a
**failed-payment alert**. Everything shows on the `/claude-code` dashboard, one full-page card. This is the setup of one
home, not a packaged integration: the Home Assistant host and the account list are set in the scripts.

## Features

- **Subscription limits** per account: 5-hour session, weekly all-model and weekly per-model usage, countdowns to each reset, and a weekly pace label (spending fast / on pace / plenty left).
- **API Console**: cost today and this month, tokens today and over 7 days, cache hit rate and the money cache saved, from the official Admin API.
- **Credit balance and expiry**: no API returns them, so the card keeps a base balance you enter and subtracts the spend since; a daily automation rolls closed days into the base.
- **Plan renewal time**: read daily on PC1 from claude.ai and written to Home Assistant; the login cookie never leaves PC1.
- **Payment alert**: when the plan status is anything other than `active` / `trialing` (for example `past_due` after a failed charge), the card shows a red frame with a link to claude.ai › Billing.
- **7-day charts** of weekly and 5-hour usage per account.

## Installation

| Part | File | Runs on |
| --- | --- | --- |
| Subscription limits (5 hours / week / model) | HACS integration [`trickv/hass-claude-usage`](https://github.com/trickv/hass-claude-usage) → `sensor.claude_<account>_*` | HA (installed from HACS, not in this repo) |
| API Console cost, tokens, balance + helpers (`input_number` / `input_datetime` / `input_text`) | [ha/62_claude_api_console.yaml](ha/62_claude_api_console.yaml) → `/config/packages/` | HA |
| Card + dashboard | [ha/claude-code-card.js](ha/claude-code-card.js), [ha/push.py](ha/push.py) | HA (pushed from PC1) |
| Renewal time + plan status (claude.ai `subscription_details`, needs a cookie) | [pc1/claude_gia_han.py](pc1/claude_gia_han.py) + Task Scheduler `HA - Claude gio gia han` at 08:30 | **PC1** (the cookie stays off HA) |

1. Install **Claude Usage** from HACS and add one entry per account (the browser signs in to claude.ai with that account), then rename its entities to `sensor.claude_<account>_*`.
2. On PC1, with the system Python and `paramiko`, `websocket-client`, `playwright` (uses the installed Chrome), push the package and the card:

   ```powershell
   python ha/push.py --xem   # compare the files on HA with this repo, write nothing
   python ha/push.py         # push package + card, reload if the package changed, write the dashboard
   ```

3. Sign in once per account for the renewal time, then schedule `ghi` daily (the Task Scheduler entry runs `pythonw.exe … ghi --log %USERPROFILE%\.claude-gia-han\lan-chay-cuoi.log`):

   ```powershell
   python pc1/claude_gia_han.py login <account>   # opens Chrome, you sign in to claude.ai
   python pc1/claude_gia_han.py doc               # read renewal time + plan status (read only)
   python pc1/claude_gia_han.py ghi               # write them to HA (what the 08:30 schedule runs)
   ```

## Configuration

- `HA_PASS` (SSH), `HA_TOKEN` and `HA_URL` are read from the `.env` of the HA-Config repository (`D:/code/HA-Config/.env`, override with the `HA_CONFIG_ENV` variable). No key is copied into this repo.
- Admin API keys go in `/config/secrets.yaml` on HA as `anthropic_admin_key_<account>` (`sk-ant-admin01-…`, the Console must be an **Organization**). After pasting a key, **restart HA**: `rest.reload` does not pick up a new key.
- Credit balance: press *edit* next to "Tín dụng còn lại" on the card after each credit grant or top-up and paste the number the Console shows; the card adds back what was already spent. Expiry: press *edit* next to "Hạn dùng" (`2000-01-01` means not entered).
- The monthly spend limit tier has no API either: set `month_limit` per account in `ha/accounts.local.json` (not committed; `ha/push.py` merges it into `ACCOUNTS`).
- The browser profile for claude.ai lives in `%USERPROFILE%\.claude-gia-han\<account>`, **not** under `AppData` (Claude Desktop is an MSIX package, so writes to `AppData\Local` are redirected and Task Scheduler cannot see them).
- Adding an account: add a Claude Usage entry, rename its entities, add a REST block, secret and helpers in the package, then a line in `ACCOUNTS` (`ha/push.py`) and `TAI_KHOAN` (`pc1/claude_gia_han.py`).
- Still shared with HA-Config: the `.env`, the `palette-axi-neon` theme and the `anthropic_admin_key_<account>` secrets.

## Entities

Subscription limits, from the HACS integration:

- `sensor.claude_<account>_session_usage`, `_week_usage`, `_weekly_fable_limit_usage` (%) · `_session_reset_time`, `_weekly_reset_time` (timestamp)
- `sensor.claude_<account>_week_usage_pace` = % used − % of the week elapsed (positive = spending faster than evenly)
- `sensor.claude_<account>_api_error` (0/1). Limits for other models show up on their own as `*_weekly_<model>_limit_usage`

API Console, from the package:

- `sensor.claude_api_<account>_cost_today`, `_cost_month`, `_cache_saved_month`, `_credit_balance` (USD)
- `sensor.claude_api_<account>_tokens_today`, `_tokens_7d`, `_tokens_prev_7d`, `_cache_hit_7d` (%)
- Helpers: `input_number.claude_api_<account>_credit_base`, `input_datetime.claude_api_<account>_credit_base_date`, `_credit_expiry`, `_plan_renew` (with time), `input_text.claude_api_<account>_plan_status`

Data sources, entity details and the traps met so far: [docs/claude-code-quota.md](docs/claude-code-quota.md) (Vietnamese).

## Troubleshooting

- **Do not call `homeassistant.reload_all`** after changing the package: it reloads `rest` in every package and floods "unique ID … already exists". `ha/push.py` reloads only input_*/template/automation; a change to a `rest:` block or an Admin key needs a restart.
- The Admin API answers **403** for an individual org even with the right key: convert the Console to an organization. A `sk-ant-usr-…` key tied to a workspace gives **401**; create one scoped to the organization.
- API sensors are `unavailable` until a valid key is in place; the card then shows a "no Admin key" reminder instead of zeros.
- `cost_closed` being `unavailable` from the daily roll-over until 07:00 Việt Nam time is normal: on that day `cost_report` has no closed day yet.
- Keep the integration's poll at 300 s (bursts can be blocked for about 24 hours) and make no extra calls to `api.anthropic.com/api/oauth/*` with its token: 8 extra calls on 04/11/2026 got both accounts a 429 for about 70 minutes, and the integration does not back off. If it is blocked, raise `update_interval` in the entry options, then set it back to 300; do not sign in again.
- The renewal log says the session expired or was blocked: run `python pc1/claude_gia_han.py login <account>` again. Google blocks sign-in in a Playwright-driven browser, so `login` opens normal Chrome.
- When HA asks to *Re-authenticate* the Claude Usage entry (the OAuth refresh lasts about 30 days), sign in again; the card shows an API read error while `api_error = 1`.

## Development

```powershell
python ha/push.py --xem      # what differs on HA (exit 1 if anything does)
python ha/push.py --ghi-de   # push even over files edited on HA, after looking at the difference
```

- Card UI check: the HA-Config card harness (`python tools/card-harness/build.py`, then `design-kit check tools/card-harness/out/claude-code-card.html --schemes dark --strict`, run inside HA-Config; it copies `ha/claude-code-card.js` from this repo).
- Colours follow the palette-axi dark neon theme; `palette-axi analyze ha/claude-code-card.js --bg "#0a1122"` must pass 7/7.
- Before 22/11/2026 these files lived in the HA-Config repository (`dashboards/claude/`, `packages/62_claude_api_console.yaml`, `tools/claude_gia_han.py`, `docs/claude-code-quota.md`); the git history came along.
- `.github/workflows/readme.yml` checks both READMEs against the [readme-axi](https://github.com/ngoviet/readme-axi) layout.

<!-- support:start -->
## Support the project

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/banner-v2.svg" width="560" alt="Built and maintained by one person in Việt Nam">
</p>

<p align="center">Free and open source. Your support pays for new device support, faster fixes and every release.</p>

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

<p align="center"><b>Crypto wallet, BNB Smart Chain (BEP20) only:</b><br><code>0xcbf0402b232cb24b4d998f09a4884f87b5f74750</code></p>

<p align="center">🇻🇳 VietQR: scan with any Vietnamese banking app, transfer note <code>Ung ho claude-code-ha</code>. Thank you for keeping this project alive!</p>
<!-- support:end -->

## License

[MIT](LICENSE) © Ngô Đức Việt

Not affiliated with Anthropic.
