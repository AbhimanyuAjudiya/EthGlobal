# VPS: one command to live

Fresh Ubuntu 24.04 box → `https://$DOMAIN` (web) + `https://api.$DOMAIN` (API) + the agent, all behind Caddy HTTPS,
as three hardened systemd units. `ops/vps/bootstrap.sh` does it; `ops/vps/smoke.sh` is its check (docker).

## Recipe

1. DNS: an `A` record for `$DOMAIN` **and** one for `api.$DOMAIN` → the VPS IP; ports 80/443 open (Caddy issues the
   certificates itself).
2. Build the `MODE=live` `.env` on your machine from the password manager (names: ONSITE-RUNBOOK §0 "The VPS .env", the
   agent's `services/agent/README.md`, and the table below). Quote a value that contains `|`, `#` or a space, as in
   `AGENT_PAYTO_ALLOWLIST='…'`. Never `MODE=local` (T-85).
3. `ssh root@$VPS 'install -d -m 0700 /etc/recharge' && scp .env root@$VPS:/etc/recharge/.env`
4. `ssh root@$VPS` then, from any checkout of the repo (`curl -O` the script, or `git clone` first):
   `DOMAIN=<domain> REPO_URL=<git url> REF=<sha or branch> bash ops/vps/bootstrap.sh`
5. Verify: `curl https://api.$DOMAIN/healthz` (`"mode":"live"`), open `https://$DOMAIN`.
6. Logs: `journalctl -u recharge-api -f` (`recharge-agent`, `recharge-web`, `caddy` likewise).
7. Redeploy: `REF=<sha> bash /opt/recharge/ops/vps/bootstrap.sh` (fetch, checkout, frozen install, build, restart).
8. Rollback: the same with the previous `REF`. State survives (`/var/lib/recharge/{api,agent}`).
9. Changed `.env`: `systemctl restart recharge-api recharge-agent`; a changed `NEXT_PUBLIC_*` or `PRINT_TOKEN` needs a
   re-run of bootstrap (they are inlined at build time / copied into `/etc/recharge/web.env`).
10. Status at any time: `systemctl list-units 'recharge-*'`.

The script refuses to run if `/etc/recharge/.env` is missing, has `MODE=local`, or lacks one of the lines below.

## What differs from the local `.env`

| name                        | VPS value                                | why                                                                         |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `MODE`                      | `live`                                   | forbidden otherwise (T-85)                                                  |
| `HOST`                      | `127.0.0.1` (or unset)                   | Caddy is the only public listener (RT-P-01)                                 |
| `TRUST_PROXY`               | `1`                                      | rate limits and the webhook IP allow-list read Caddy's `X-Forwarded-For`    |
| `CORS_ORIGINS`              | `https://$DOMAIN`                        | the browser calls the API cross-origin; live refuses localhost (RT-A-09)    |
| `NEXT_PUBLIC_MODE`          | `live`                                   | compiles the demo wallet and seed hooks out of the bundle (T-63)            |
| `NEXT_PUBLIC_API_URL`       | `https://api.$DOMAIN`                    | inlined into the web bundle at build time                                   |
| `NEXT_PUBLIC_PUBLIC_ORIGIN` | `https://$DOMAIN`                        | the origin printed scratch cards encode                                     |
| `PRINT_TOKEN`               | 43 chars from `openssl rand -base64 32…` | guards `/print/cards` (T-64); the only non-public name the web process gets |
| `STATE_FILE`                | `/var/lib/recharge/api/state.json`       | the API's only writable directory (`ProtectSystem=strict`)                  |
| `INVENTORY_FILE`            | `/var/lib/recharge/api/inventory.enc`    | same, if the inventory reseller is used                                     |
| `AGENT_STATE_DIR`           | `/var/lib/recharge/agent`                | the agent's only writable directory                                         |
| `AGENT_API_URL`             | `http://127.0.0.1:8787`                  | the agent reaches the API on loopback (`PORT`)                              |

Everything else (keys, RPC URLs, `X402_*`, `RESELLER=esimaccess`, `WORLD_*`, `ARKIV_*`, `HEDERA_*`, `AGENT_*`) is the
runbook's list. `env.ts` refuses to boot on anything local-looking; `journalctl -u recharge-api` shows the name.

## Layout

- `/opt/recharge` — the checkout (owner `recharge`, read-only to the services); `/etc/recharge/.env` — `0600
root:recharge`, read by systemd only; `/etc/recharge/web.env` — the `NEXT_PUBLIC_*` + `PRINT_TOKEN` subset for the
  web unit; `/var/lib/recharge/{api,agent}` — state; `/etc/caddy/Caddyfile` — regenerated on every run.
- Units: `recharge-api` (`node dist/index.js`, `127.0.0.1:$PORT`), `recharge-agent` (`node dist/index.js`),
  `recharge-web` (`next start -p 3000 -H 127.0.0.1`); `Restart=always`, `NoNewPrivileges`, `ProtectSystem=strict`,
  `StateDirectory`, empty capability set.
- The contracts package is not built on the VPS (it needs Foundry; its ABI is committed).
