# Deploy and Host NiubiGEO with Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/niubigeo-v03-ai-brand-visibility-tracker?referralCode=20H68q)

NiubiGEO is an open-source (Apache-2.0) GEO research tool. It asks AI models about your domain and your keywords, then shows how they describe you, which competitors they name, the original answers and the sources they returned. This community template runs NiubiGEO v0.3.3 behind a login on its own HTTPS address, with scheduled monitoring and persistent storage.

## About Hosting NiubiGEO

NiubiGEO has two processes: a web workbench and a scheduling worker that runs saved schedules and keyword monitors. Both work on the same folder of JSON files; there is no database. NiubiGEO has no login of its own, and its docs say the workbench must not be exposed without one. This template runs the official v0.3.3 image, pinned by digest, with both processes in one private service on a Railway volume. A Caddy gateway with HTTP basic auth and a generated password is the only public entry point. Model calls go to OpenRouter or another provider with your own key.

## Common Use Cases

- See how different AI models describe your product and which competitors they associate with it
- Test neutral keywords (for example "best feature flag tools") without naming your brand, and see who gets mentioned or recommended
- Re-run the same keywords hourly, daily or weekly and compare runs in the Diff view, with CSV and JSON exports
- Check the raw answer and the cited sources behind every result before acting on it

## Dependencies for NiubiGEO Hosting

- NiubiGEO v0.3.3 (official image `ghcr.io/albert-weasker/niubigeo`, pinned by digest) with a small process supervisor
- Caddy 2.11.9 as the login gateway (official image, pinned by digest)
- A Railway volume for projects, runs, answers and evidence
- An OpenRouter API key (recommended), or keys for other OpenAI-compatible APIs entered in the browser

### Deployment Dependencies

- NiubiGEO source and releases: https://github.com/Albert-Weasker/niubigeo
- v0.3.3 release notes: https://github.com/Albert-Weasker/niubigeo/blob/v0.3.3/docs/releases/v0.3.3.md
- Docker deployment notes: https://github.com/Albert-Weasker/niubigeo/blob/v0.3.3/docs/deployment/docker.en.md
- Model connections: https://github.com/Albert-Weasker/niubigeo/blob/v0.3.3/docs/model-connections.md
- Reading monitoring results: https://github.com/Albert-Weasker/niubigeo/blob/v0.3.3/docs/monitoring-guide.md
- OpenRouter API keys: https://openrouter.ai/keys
- Caddy basic auth: https://caddyserver.com/docs/caddyfile/directives/basic_auth

### Implementation Details

| Service | Built from | Role | Public |
|---|---|---|---|
| NiubiGEO Gateway | `caddy:2.11.9-alpine` + Caddyfile (`services/gateway`) | Login, security headers, compression, proxy | yes |
| NiubiGEO | `niubigeo:v0.3.3` + supervisor (`services/niubigeo`) | Workbench and scheduling worker, volume at `/app/data` | no |

**Before you deploy (optional):** paste an OpenRouter key into `OPENROUTER_API_KEY` on the NiubiGEO service. The template also deploys without it. You can then connect a key in the browser, but browser keys live only in that tab and scheduled runs cannot use them.

**First login**

1. Wait until both services are Active. The first build takes a few minutes.
2. Open `NIUBIGEO_URL` from the NiubiGEO Gateway variables and log in with `BASIC_AUTH_USERNAME` (default `admin`) and `BASIC_AUTH_PASSWORD`.
3. The interface opens in Simplified Chinese. Click **EN** in the language switch at the bottom left for English (Português is also available). Some pages still contain Chinese-only text, measurement chart dates use a Chinese format, and a few error messages are only in Chinese. This is upstream's current state, listed in its known limitations.
4. Create a project for your domain, choose one or two models, save the configuration and start a test. Read the answers and sources, confirm the keywords you care about, then run keyword tests or create a schedule.

**Model costs:** every test calls the models you choose, and web search adds charges. OpenRouter or your provider bills these, not Railway. Start with one inexpensive model. Requests that bring no browser key use `OPENROUTER_API_KEY`, so share the login only with people you trust to spend it.

**Scheduled monitoring:** the worker looks for due schedules and keyword monitors every 60 seconds (`NIUBIGEO_WORKER_POLL_SECONDS`) and calls models with `OPENROUTER_API_KEY`. The workbench shows the worker's status. If the worker stops, it is restarted with backoff while the workbench stays up. `NIUBIGEO_WORKER_ENABLED=false` stops all scheduled runs. On redeploy the service gets 60 seconds to finish a running cycle.

**Other model providers:** the workbench's model connection dialog accepts OpenRouter and OpenAI-compatible APIs (OpenAI, DeepSeek, Gemini's OpenAI endpoint and others). Those connections are per browser session. For a model server in the same Railway project, such as Ollama, set `NIUBIGEO_ALLOW_LOCAL_PROVIDERS=true` and connect `http://{service-name}.railway.internal:11434/v1`.

**Security:** NiubiGEO has no user accounts, so the workbench listens only on Railway's private network. Everything on the public address except `/healthz` needs the login, and requests started by other websites are refused. After the first login the gateway also sets a session cookie, so that the workbench's own "connect API key" requests, which carry the key in the `Authorization` header, get through. To change the password, edit `BASIC_AUTH_PASSWORD` on the gateway and redeploy it; old sessions end. Upstream's advisor link card is hidden by default (`NIUBIGEO_VIDEO_ADVISOR_ENABLED`).

**Data, backups and upgrades:** projects, runs, raw answers and evidence are JSON files under `/app/data/product-v2`. Enable Railway's volume backups for disaster recovery. To upgrade, read upstream's release notes, pause schedules in the workbench, then set `NIUBIGEO_IMAGE` to the new tag with its digest and redeploy. Before a different NiubiGEO version opens the data, the supervisor saves `product-v2` as a `.tar.gz` in `/app/data/backups` (the last 3 are kept, `NIUBIGEO_SNAPSHOT_KEEP`). To roll back, set the previous image again and unpack the snapshot over a renamed copy of `product-v2` using `railway ssh`.

**Scaling:** run one replica. The data lives on one volume and there must be only one worker. Give the NiubiGEO service more memory if you run many models at once. Railway does not allow two deployments to share a volume, so a redeploy stops the old container before the new one starts.

**Pinning:** both images are pinned by tag and digest in the Dockerfiles. `NIUBIGEO_IMAGE` overrides the NiubiGEO base at build time; keep a digest in it.

NiubiGEO is early (0.x) software. It records answers from model APIs, which can differ from consumer chat apps such as the ChatGPT website, and one answer is not a ranking. This is a community template. It is not made, endorsed or supported by the NiubiGEO authors.

### Why Deploy NiubiGEO on Railway?

Railway runs the workbench, the worker, the volume and the HTTPS address for you, so a password-protected NiubiGEO with scheduled monitoring is one deploy instead of a server, a reverse proxy and a cron setup. Your research data stays in your Railway project, you pay Railway only for the small amount of RAM and CPU it uses, and model calls are billed directly by the provider you choose.
