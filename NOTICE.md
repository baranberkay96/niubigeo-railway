# NOTICE

This Railway template is a community package. It is not affiliated with, sponsored by or endorsed by the NiubiGEO project, NiubiStar or the project's authors.

## What this template runs

| Component | Source | License |
|---|---|---|
| NiubiGEO v0.3.3 | `ghcr.io/albert-weasker/niubigeo:v0.3.3` (index digest `sha256:5950b779edc0de9c3e869cdbbb6166a8053e0e7c209f7d00a8ca680d43c5841f`, linux/amd64 manifest `sha256:b03c4c52a8967e91d57a947ec967f7d03613f338f5c960f5ac437745f7939b5a`, created 2026-11-03, built by upstream's release workflow from https://github.com/Albert-Weasker/niubigeo tag `v0.3.3`, commit `6f0eeeb11b4319e845b491a5067d2cfdc8d07b52`), used unmodified as the base image | Apache License 2.0, "Copyright 2026 NiubiStar" (upstream `LICENSE`; `package.json` declares `Apache-2.0`) |
| Inside that image | Node.js 22.23.4 on Alpine Linux 3.24.3 (`node:22-alpine`), busybox, and NiubiGEO's runtime dependencies: cheerio 1.2.0 (MIT), cron-parser 5.10.0 (MIT), linkify-it 6.1.0 (MIT), marked 18.0.11 (MIT), nodemailer 10.0.0 (MIT-0) | Their own licenses, as shipped by upstream |
| Caddy 2.11.9 | Official Docker image `caddy:2.11.9-alpine` (index digest `sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee`, created 2026-11-05, Alpine 3.24.4), used unmodified as the base image | Apache License 2.0 (caddyserver/caddy and caddyserver/caddy-docker) |

The name "NiubiGEO" and the upstream emblem (`assets/brand/niubigeo-emblem-light.svg`, loaded from the `v0.3.3` tag through jsDelivr as the template and service icon) are used only to identify the software this template deploys. Apache-2.0 section 6 grants no trademark rights; no endorsement is implied. The gateway icon is `svg/caddy.svg` from homarr-labs/dashboard-icons (Apache-2.0), loaded by URL.

## Apache-2.0 notes

These notes describe how this package relates to the licenses above. They are practical guidance, not legal advice.

- **No NiubiGEO code is modified or copied.** `services/niubigeo/Dockerfile` starts `FROM` the official image and adds one new file, `railway-supervisor.mjs`. The server (`dist/src/product/product-server.js`) and the worker (`dist/src/product/scheduling/schedule-worker.js`) run exactly as upstream ships them; the supervisor only starts them as child processes and passes environment variables. Settings such as hiding the advisor card use upstream's own documented variables.
- **No redistribution of the images by this package.** Railway pulls both base images from their registries during the build. The upstream image does not contain a copy of the Apache-2.0 text; the full text and copyright line are in upstream's `LICENSE` at the pinned tag.
- **Anyone who modifies NiubiGEO itself** and distributes the result must follow Apache-2.0 section 4 (keep the license and notices, mark changed files). Changing the environment variables or the files of this package does not modify NiubiGEO.

## What this package adds (original work)

- `services/niubigeo/Dockerfile`: `FROM` the pinned NiubiGEO image (overridable through the `NIUBIGEO_IMAGE` build argument), adds the supervisor, runs its `--self-test` at build time, sets defaults (`HOST=::`, `PORT=8787`, data paths), `ENTRYPOINT`. No volume declaration (Railway attaches the volume at `/app/data`).
- `services/niubigeo/railway-supervisor.mjs`: validates the settings, checks that the data directory is a writable volume, saves a `tar.gz` copy of `product-v2` when the NiubiGEO version changes (keeps the newest N), starts the server and the worker, restarts the worker with backoff, stops the container when the server stops, and forwards SIGTERM with a bounded grace period. Node standard library only.
- `services/gateway/Dockerfile`: `FROM` the pinned Caddy image, adds the Caddyfile and the start-up script, validates both at build time.
- `services/gateway/Caddyfile`: basic auth, a session cookie for the workbench's own key-connection requests, removal of basic-auth credentials before proxying, cross-site Origin refusal, a `Sec-Fetch-Site` exception for opening the workbench page from another site, security headers, compression, a plain-text page while NiubiGEO is unreachable.
- `services/gateway/entrypoint.sh`: checks the settings, hashes the password with `caddy hash-password` (bcrypt), derives the session token (SHA-256 of a generated secret, the user name and the password), removes the plain password and the secret from Caddy's environment, starts Caddy.
- `template.json`, `TEMPLATE.md`, `README.md`, this file.

## Reused ideas and prior work

- **dektionstudio/railway-template-images**, `niubigeo/` (MIT License, Copyright (c) 2026 Dektion Studio), the deploy source of the existing marketplace template "NiubiGEO". Read for ideas only: running the workbench and the worker in one container because they share the data volume, a login in front of the workbench, a switch for the worker, and hiding the advisor card through upstream's variable. No file or text from it is copied; the supervisor, the Caddy gateway and all texts here were written independently. The market template's README was not reused.
- The gateway follows the pattern of this project's own Redis template (`86-redis`, RedisInsight gateway): Caddy basic auth with a bcrypt hash made at start, `/healthz`, and cross-site Origin refusal.

## Upstream material checked (NiubiGEO v0.3.3, 2026-11-07)

Read from `_upstream/Albert-Weasker__niubigeo` (Apache-2.0). Every file relied on was compared with tag `v0.3.3` through the GitHub contents API (blob SHA) and is identical: `docker-compose.yml`, `Dockerfile`, `.env.example`, `package.json`, `LICENSE`, `README.md`, `SECURITY.md`, `src/product/product-server.ts`, `src/product/scheduling/schedule-worker.ts`, `src/product/scheduling/worker-status.ts`, `src/config/env.ts`, `src/product/connections/connection-http.ts`, `src/product/connections/provider-connections.ts`, `src/ui/provider-connections-ui.ts`, `src/ui/video-advisor.ts`, `src/providers/custom-connection.ts`, `src/product/recognition/recognition-http.ts`, `docs/deployment/docker.en.md`, `docs/deployment/docker.md`, `docs/upgrade.md`, `docs/limitations.md`, `docs/model-connections.md`, `docs/releases/v0.3.3.md`, `docs/known-issues.md`, `docs/brand.md`, `docs/monitoring-guide.md`, `src/ui/product-localization.ts`, `src/ui/keyword-monitoring-app.ts`, `src/ui/product-phase2-app.ts`, `src/product/configuration/model-catalog.ts`, `assets/brand/niubigeo-emblem-light.svg`.

Registry (GHCR, anonymous token): `albert-weasker/niubigeo:v0.3.3` resolves to the index digest above, which equals the digest in upstream's release asset `release-image-receipt.json`; `release-image-plan.json` lists `v0.3.3` and `sha-6f0eeeb…` as immutable tags. Image config: user root (no `USER`), `WORKDIR /app`, entrypoint `docker-entrypoint.sh`, command `node dist/src/product/product-server.js`, `HOST=0.0.0.0`, `PORT=8787`, `PRODUCT_DATA_DIR=/app/data/product-v2`, label `org.opencontainers.image.revision=6f0eeeb1…`, no volume declaration. Layer listings: `/bin/tar` → busybox present in the final filesystem; the `dist` layer contains both entry points; `package.json` version `0.3.3`.

## Market templates

The Railway marketplace template in `_market/` ("NiubiGEO", code `niubigeo`, 0 active projects) deploys `dektionstudio/railway-template-images` `/niubigeo` (MIT, see above). Its README has no license and was read only to understand the template; no text from it is reused.
