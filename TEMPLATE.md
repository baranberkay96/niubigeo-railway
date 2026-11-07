# NiubiGEO v0.3 AI Brand Visibility Tracker (GEO): Railway template spec

## Listing

| Field | Value |
|---|---|
| Name | **NiubiGEO v0.3 AI Brand Visibility Tracker (GEO)** ("v0.3" = major.minor of the pinned 0.x release v0.3.3) |
| Description | See how AI models describe your brand and competitors, with evidence. (69 chars) |
| Category | Analytics |
| Tags | niubigeo, geo, generative-engine-optimization, ai-visibility, brand-monitoring, competitor-analysis, seo, llm, openrouter, self-hosted |
| Icon | `https://cdn.jsdelivr.net/gh/Albert-Weasker/niubigeo@v0.3.3/assets/brand/niubigeo-emblem-light.svg` (200, image/svg+xml; dark #111 glyphs on transparent; the white `niubigeo-emblem.svg` would vanish on light backgrounds; homarr dashboard-icons has no NiubiGEO icon: 404) |
| Repo | `baranberkay96/niubigeo-railway` (`/services/niubigeo`, `/services/gateway`) |

"AI models", not "AI assistants": NiubiGEO records answers from provider APIs (OpenRouter and OpenAI-compatible endpoints), which upstream says can differ from consumer chat apps. "With evidence" = the raw answers, mentions and returned citations it stores per run.

## Base market template

- **"NiubiGEO"** (code `niubigeo`, 0 active projects, 1 project ever, created 2026-09-25, category Analytics): one repo service from `dektionstudio/railway-template-images` `/niubigeo` (MIT). `FROM ghcr.io/albert-weasker/niubigeo:v0.2.0` plus a Node script that starts the workbench and the worker and puts a hand-written basic-auth proxy in front on port 8080; volume `/app/data`; healthcheck `/health`; ON_FAILURE 10; variables `NIUBIGEO_USER`, `NIUBIGEO_PASSWORD` (`secret(24)`), `NIUBIGEO_SCHEDULER`, `OPENROUTER_API_KEY` (required, empty), `NIUBIGEO_VIDEO_ADVISOR_ENABLED=true`.
- Kept: one container for workbench + worker (forced by Railway volumes), the volume at `/app/data` with upstream compose's layout (`/app/data/product-v2`), `/health`, a worker switch, the advisor-card variable.
- Changed: see "Improvements over market templates". Their files were read for ideas only (MIT; credited in NOTICE.md); nothing is copied.

## Pinned versions

| Service | Image / source | Tag | Index digest | Released | Checked |
|---|---|---|---|---|---|
| NiubiGEO | repo `/services/niubigeo` → `FROM ghcr.io/albert-weasker/niubigeo` | `v0.3.3` (= `latest` and `sha-6f0eeeb…` today; commit `6f0eeeb11b4319e845b491a5067d2cfdc8d07b52`) | `sha256:5950b779edc0de9c3e869cdbbb6166a8053e0e7c209f7d00a8ca680d43c5841f` (amd64 `sha256:b03c4c52…f7939b5a`, arm64 `sha256:315bf27f…a3aed219`) | 2026-11-03 | 2026-11-07 |
| ↳ runtime | Node.js 22.23.4, Alpine 3.24.3, busybox (`tar`) | as built upstream | | 2026-11-03 | 2026-11-07 |
| NiubiGEO Gateway | repo `/services/gateway` → `FROM caddy` | `2.11.9-alpine` (Caddy v2.11.9, Alpine 3.24.4) | `sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee` | 2026-11-05 | 2026-11-07 |

The NiubiGEO digest equals the one in upstream's release asset `release-image-receipt.json`. Upstream re-pointed all older Docker tags (`v0.2.0`, `v0.3.0`, old `sha-` tags) to its v0.3.2 security build, so a tag alone is not a stable pin; both Dockerfiles pin tag + digest. Caddy 2.11.9 is a two-day-old patch release with security fixes (mostly FastCGI, not used here) on top of 2.11.8.

## Architecture

```
          Internet (HTTPS at Railway's edge)
                     │ one domain, port 8080
                     ▼
 ┌────────────────────────────────────────────┐  healthcheck GET /healthz (no auth, no data)
 │ NiubiGEO Gateway (Caddy 2.11.9)            │
 │  basic auth (bcrypt) or session cookie     │
 │  refuses cross-site Origin, strips Basic   │
 │  credentials, security headers, zstd/gzip  │
 └─────────────────────┬──────────────────────┘
                       │ http://niubigeo.railway.internal:8787 (private network)
                       ▼
 ┌────────────────────────────────────────────┐  healthcheck GET /health
 │ NiubiGEO (no public domain)                │
 │  railway-supervisor.mjs (node, not PID 1)  │  volume /app/data
 │   ├─ product-server.js   :: 8787           │   ├─ product-v2/   projects, runs, answers,
 │   │   UI + JSON API, manual runs           │   │                evidence, schedules, worker-status
 │   └─ schedule-worker.js 60                 │   ├─ backups/      pre-upgrade snapshots
 │       schedules + keyword monitors         │   └─ .railway-template/niubigeo-version
 └─────────────────────┬──────────────────────┘
                       │ HTTPS to OpenRouter / OpenAI-compatible APIs (user's keys)
                       ▼
               model providers (billed by the provider)
```

NiubiGEO has no database, queue or cache: every store (`ProductProjectFileStore`, measurement, recognition, report, schedule, keyword-monitor and worker-status stores) writes JSON files with single-file atomic renames under `PRODUCT_DATA_DIR`. Manual domain and keyword runs execute inside the server process (HTTP 202, then background work); due schedules and keyword monitors run in the worker. Upstream compose runs the worker as a second container on the same bind mount. Railway volumes cannot be shared, so both run in this one service, and this is the only correct layout on Railway (Rule 3b). There are no migrations: upstream reads older JSON layouts directly and documents no migration step, only "back up the whole data directory before upgrading", which the supervisor automates.

Boot sequence (`railway-supervisor.mjs`):

1. Validate settings (`NIUBIGEO_WORKER_ENABLED`, `NIUBIGEO_WORKER_POLL_SECONDS` 10–86400, `NIUBIGEO_SNAPSHOT_KEEP` 0–50, absolute data paths, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`); any error exits 1 with the variable named.
2. Log one summary line: NiubiGEO version (from `/app/package.json`), data path, worker on/off and interval, and whether an OpenRouter server key is set (never its value).
3. `mkdir -p` the product directory, warn if `/app/data` is not a separate mount (no volume), write-test the directory (exit 1 if read-only).
4. Compare the image's version with `/app/data/.railway-template/niubigeo-version`. If it changed and data exists, `tar -czf /app/data/backups/product-v2-before-<new>-from-<old>-<UTC>.tar.gz` while nothing else runs, keep the newest `NIUBIGEO_SNAPSHOT_KEEP` (3), then record the new version. A failed snapshot (for example a full volume) stops the start with a clear message and leaves the old version recorded, so the next start retries.
5. Start `node dist/src/product/product-server.js` (listens on `HOST=::`, `PORT=8787`) and, unless disabled, `node dist/src/product/scheduling/schedule-worker.js 60`.
6. Server exits → SIGTERM the worker, exit with the server's code (0 becomes 1), Railway restarts the service. Worker exits → restart after 5, 10, 20 … 300 s (reset after 10 minutes of uptime); the workbench stays up and shows the worker as stale meanwhile.
7. SIGTERM from Railway → SIGTERM both, wait up to `RAILWAY_DEPLOYMENT_DRAINING_SECONDS − 5` s (55 s), then SIGKILL. The worker finishes its current cycle on SIGTERM; when it is sleeping between polls it is killed at the deadline, which is harmless.

## Services

### NiubiGEO
- Source: repo `baranberkay96/niubigeo-railway`, root directory `/services/niubigeo` (Dockerfile). `ARG NIUBIGEO_IMAGE` (tag + digest) is the base; the service variable of the same name overrides it at build time. The build runs `node --check` and `--self-test` (entry points present, version readable, a real `tar` snapshot round trip in a temp dir).
- Start command: none (`ENTRYPOINT node /usr/local/bin/niubigeo-railway-supervisor.mjs`, `CMD []`). Pre-deploy: none (no migrations exist).
- Healthcheck: `/health` (upstream; returns `{"ok":true}` once the HTTP server listens), timeout 600 s (covers a snapshot of a large data folder).
- Public domain: **none**. TCP proxy: none. Reached only through the gateway.
- Volume: `/app/data`. Restart: ON_FAILURE, 10. Replicas: 1 (one worker per data folder; volume).
- Runs as root, as upstream's image does (no `USER`); Railway's volume is root-owned.

| Variable | Default | Description |
|---|---|---|
| OPENROUTER_API_KEY | *(empty)* | Recommended, optional. Server-side OpenRouter key for requests without a browser key and for all scheduled runs. Upstream also reads `OPENROUTER_KEY` and `*_FILE`. |
| PORT | `8787` | Workbench port; healthcheck and gateway target. |
| HOST | `::` | Dual-stack bind (Node). Upstream's image default is `0.0.0.0`. |
| MONITORING_DATA_DIR | `/app/data` | Data root on the volume (upstream variable). |
| PRODUCT_DATA_DIR | `/app/data/product-v2` | Product data (upstream variable, compose layout). |
| NIUBIGEO_WORKER_ENABLED | `true` | Run the scheduling worker. |
| NIUBIGEO_WORKER_POLL_SECONDS | `60` | Worker poll interval (upstream's argument; must be ≥ 10). |
| NIUBIGEO_VIDEO_ADVISOR_ENABLED | `false` | Upstream variable; `true` shows the advisor link card. |
| NIUBIGEO_ALLOW_LOCAL_PROVIDERS | `false` | Upstream variable; `true` allows http/private model endpoints (Ollama in the project). |
| NIUBIGEO_SNAPSHOT_KEEP | `3` | Pre-upgrade snapshots kept; `0` disables. |
| RAILWAY_DEPLOYMENT_DRAINING_SECONDS | `60` | Stop-to-kill window on redeploy. |
| NIUBIGEO_IMAGE | `ghcr.io/albert-weasker/niubigeo:v0.3.3@sha256:5950b7…841f` | Build base; change to upgrade. |

Read by upstream, settable later, not exposed: `PROVIDER_TIMEOUT_MS` (45000), `PROVIDER_HTTP_ATTEMPTS` (3), `PROVIDER_RUN_ATTEMPTS` (4), `PROVIDER_RETRY_BASE_MS`, `PROVIDER_EMPTY_ANSWER_MAX_TOKENS`, `INTENT_ANALYSIS_MAX_TOKENS`. Not used by the v0.3.3 workbench or worker, so not set: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PERPLEXITY_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_COMPATIBLE_*`, `SMTP_URL`, `SMTP_FROM`, `NIUBIGEO_WEBHOOK_TIMEOUT_MS`, `MONITORING_TASK_LEASE_MS`, `RUNS_DIR`, `AUDIT_CONCURRENCY` (all belong to the legacy `src/server.ts` workbench and CLI; product-v2 resolves server keys only for `openrouter`, and custom endpoints only from the browser).

### NiubiGEO Gateway
- Source: repo `baranberkay96/niubigeo-railway`, root directory `/services/gateway` (Dockerfile). The build runs `entrypoint.sh --check`: real `caddy hash-password`, token derivation and `caddy validate` of the Caddyfile with throwaway values.
- Start command: none (`ENTRYPOINT niubigeo-gateway-entrypoint.sh`). Healthcheck: `/healthz` (Caddy answers `ok` itself, so the gateway deploys even while NiubiGEO still builds), timeout 300 s.
- Public domain: yes, target port 8080. No volume (`admin off`, `persist_config off`, `auto_https off`). Restart: ON_FAILURE, 10. Replicas: 1 (stateless; can be raised).

| Variable | Default | Description |
|---|---|---|
| PORT | `8080` | Listen port; domain and healthcheck target. |
| BASIC_AUTH_USERNAME | `admin` | Login name (`A-Z a-z 0-9 . _ -`). |
| BASIC_AUTH_PASSWORD | `${{secret(32, "<57 unambiguous letters/digits>")}}` | Generated login password (≈187 bits); bcrypt-hashed at start; min. 16 characters. |
| NIUBIGEO_GATEWAY_SESSION_SECRET | `${{secret(48, "<a-z A-Z 0-9>")}}` | Secret for the session-cookie token; min. 32 characters. |
| NIUBIGEO_UPSTREAM | `${{NiubiGEO.RAILWAY_PRIVATE_DOMAIN}}:${{NiubiGEO.PORT}}` | Private address of NiubiGEO. |
| NIUBIGEO_URL | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | Where to log in (informational). |

No user input is required. `OPENROUTER_API_KEY` is the one recommended input.

## Authentication model

NiubiGEO has no accounts or login; upstream's docs bind it to `127.0.0.1` and say remote deployments need authentication and TLS in front. On Railway the NiubiGEO service gets no public domain, and the gateway is the only way in.

- **Basic auth** with a generated password, checked by Caddy against a bcrypt hash made at start (Caddy's Caddyfile adapter caches successful checks, so the cost-14 hash is not recomputed per request). The plain password and the session secret are `unset` before `exec caddy`.
- **Conflict with NiubiGEO's key dialog.** NiubiGEO's "connect API key" dialog validates a key with `POST /api/openrouter/key` or `/api/custom-provider/connect` carrying `Authorization: Bearer <key>`. A script-set `Authorization` header replaces the browser's cached basic-auth credentials, so plain basic auth answers 401 and the dialog fails (this is what the market template's proxy does). The gateway therefore sets `__Host-niubigeo_session` (HttpOnly, Secure, SameSite=Strict, Path=/, 24 h, refreshed on every basic-auth request) after a successful login and accepts that cookie instead of basic auth. The value is `SHA-256("niubigeo-gateway-session-v1", secret, user, password)`, so changing any of them ends all sessions. It is compared with Caddy's `vars` matcher; an empty token cannot occur (the entrypoint enforces 64 hex characters, and Caddy's `vars` matcher refuses an empty value list).
- **Basic credentials never reach NiubiGEO.** NiubiGEO parses every `Authorization` header as a model key and answers any non-Bearer value with 401 "OpenRouter Key 格式无效", so `Authorization: Basic …` is removed before proxying (`request_header @basic_credentials -Authorization`). Bearer keys from the dialog pass through unchanged.
- **Cross-site requests.** The gateway refuses any request whose `Origin` is not `https://{host}` (403); NiubiGEO itself also refuses `Sec-Fetch-Site: cross-site` and foreign `Origin` hosts. A top-level `GET /` navigation from another site (the domain link in the Railway dashboard) carries `Sec-Fetch-Site: cross-site`, which NiubiGEO would answer with a JSON 403, so the gateway drops that one header for `GET`/`HEAD` navigations to `/` only. The page is the app shell, has no side effects, and cross-site pages cannot read it.
- **Residual exposure.** Anyone with the login can spend `OPENROUTER_API_KEY` and read all projects. NiubiGEO's port 8787 is reachable without login from other services in the same Railway project and environment (private network). The plain password is visible to project members in the Variables tab.

## Improvements over market templates

1. **Current release, really pinned.** v0.3.3 (2026-11-03) by tag + index digest, instead of the `v0.2.0` tag, which upstream has since re-pointed to its v0.3.2 security build. One variable (`NIUBIGEO_IMAGE`) upgrades it.
2. **The in-app key dialog works behind the login.** The market proxy rejects the dialog's `Authorization: Bearer` requests, so browser keys and the 16 provider shortcuts (OpenAI, DeepSeek, Gemini, Moonshot and others) cannot be connected there. The session cookie fixes that without opening any endpoint.
3. **Opening the URL from the Railway dashboard works**, instead of NiubiGEO's cross-site 403 JSON.
4. **The workbench is not on the public internet at all.** It runs on the private network behind a separate Caddy gateway (official image by digest, bcrypt, cross-site Origin refusal, security headers, compression), instead of a hand-written Node proxy in the same process that serves the app.
5. **Deploys without any key.** `OPENROUTER_API_KEY` is optional (the market template requires it); the boot log says whether scheduled runs have a key.
6. **A worker crash no longer restarts the workbench** (backoff restart), and a server crash still restarts the service.
7. **Graceful redeploys:** 60 s draining, SIGTERM forwarded, so a monitoring cycle can finish; the market wrapper exits 3 s after SIGTERM.
8. **Pre-upgrade snapshot** of the data, as upstream's upgrade guide asks, taken automatically when the version changes; the last 3 are kept.
9. **Advisor card off by default** (it links to the upstream team's external service; one variable shows it).
10. Settings validated at start with clear errors; volume and write checks; build-time self-tests in both images; `HOST=::` for the private network.

## Resource estimate

Not measured (no Docker run, no deploy). Basis: three small Node processes and Caddy at idle; the market template's README reports 55 MB for its single container at idle.

| Service | Idle RAM | Typical RAM | Typical vCPU | Volume |
|---|---|---|---|---|
| NiubiGEO (supervisor + server + worker) | ~0.15 GB | 0.25–0.4 GB (runs parse model answers in the server and worker) | 0.01–0.05 | 0.05–1 GB (JSON evidence grows with every run; snapshots add copies) |
| NiubiGEO Gateway | ~0.03 GB | ~0.04 GB | < 0.01 | — |
| **Total** | **~0.18 GB, ~0.01 vCPU** | **~0.4 GB, ~0.05 vCPU** | | **0.1–1 GB** |

At Railway prices (RAM $10/GB-month, vCPU $20/vCPU-month, volume $0.15/GB-month):
- Idle: 0.18 × 10 + 0.01 × 20 + 0.1 × 0.15 ≈ **$2 / month**.
- Typical (daily keyword monitors on a few models, regular manual tests): 0.4 × 10 + 0.05 × 20 + 1 × 0.15 ≈ **$5 / month**.
- Not included: model and web-search charges, billed by OpenRouter or the provider per token and request. As a reference point, upstream ran its 20 published case studies under a USD 2 budget cap (docs/limitations.md).

Minimum plan: **Trial** boots it (both services far below 1 GB). **Hobby** is recommended for continuous scheduled monitoring. Pro is not needed.

## Verification checklist

1. Builds. NiubiGEO: `[niubigeo-railway] self-test passed: NiubiGEO 0.3.3, Node v22.23.4, tar snapshot round trip ok.` Gateway: `caddy validate` prints "Valid configuration".
2. NiubiGEO deploy log: `NiubiGEO 0.3.3; data in /app/data/product-v2; worker on, every 60 s; OpenRouter server key not set …`, no "not a separate volume" warning, `server started`, `niubigeo product server listening on http://:::8787`, `worker started`. Healthcheck `/health` passes. The service has no public domain.
3. Gateway: `GET https://{domain}/healthz` → 200 `ok`. `GET /` without credentials → 401 with `WWW-Authenticate: Basic realm="NiubiGEO"`. With credentials → 200 HTML and a `Set-Cookie: __Host-niubigeo_session=…`. `curl -X POST -H 'Origin: https://evil.example' …/api/projects` with credentials → 403.
4. Click the domain link in the Railway dashboard, log in: the workbench loads (no `Cross-origin requests are not allowed.` JSON).
5. Switch the UI to EN (bottom left). Create a project for a domain; redeploy NiubiGEO; the project is still there.
6. Browser key: open "connect OpenRouter", paste a key → connected. Also connect a custom OpenAI-compatible endpoint from a platform logo. Both must work behind the login (cookie path).
7. Server key: set `OPENROUTER_API_KEY`, redeploy, run a domain test with one inexpensive model without a browser key → answers, mentions and sources appear.
8. Worker: `GET /api/scheduler/status` (through the gateway) → `state: running`. Create an hourly keyword monitor; within the hour the log shows `{"type":"keyword_monitor_due",…}` and the history gets a run.
9. Snapshot: `railway ssh` into NiubiGEO, `echo 0.3.2 > /app/data/.railway-template/niubigeo-version`, restart → log `NiubiGEO 0.3.2 -> 0.3.3: saving …`, file in `/app/data/backups`, `tar -tzf` lists `product-v2/…`.
10. Redeploy during an idle period: log shows `SIGTERM received; stopping …` and both processes end within 60 s. Kill the worker (`kill <pid>` via `railway ssh`): `worker exited …; restarting it in 5 s`, workbench stays up.
11. Stop NiubiGEO: the gateway answers 502 with the "not reachable yet" text after login. Change `BASIC_AUTH_PASSWORD`, redeploy the gateway: the old password and old cookie stop working.

## Open questions

- Nothing was built or run on Railway (no Docker by instruction). The supervisor was exercised locally with Node 24 against stub server/worker scripts, and the gateway entrypoint under `dash` with a stub `caddy`; the real Caddyfile is only validated by the Docker build (`caddy validate`). The constructs were checked against Caddy v2.11.9 source (`vars` matcher with a cookie placeholder, `not` inline, `header_regexp`, `handle_errors` status codes, basic-auth header kept on unmatched error routes).
- Browser behaviour assumed from the Fetch spec: a script-set `Authorization` header suppresses cached basic-auth credentials, and the same-origin cookie is sent with it. Verify with Chrome, Firefox and Safari (checklist 6).
- `Sec-Fetch-Site: cross-site` on the first navigation from railway.com to `*.up.railway.app` (expected, as `up.railway.app` is a public suffix): verify (checklist 4).
- Whether Railway passes the `NIUBIGEO_IMAGE` service variable into the global `ARG` before `FROM`. If not, the Dockerfile default (v0.3.3 digest) is used, which is still correct.
- Private-service healthcheck on `::`: Node's `::` socket is dual-stack, so Railway's IPv4 probe should reach it.
- RAM and CPU figures are estimates. Manual runs execute inside the server process; very large runs could need more memory.
