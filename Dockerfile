FROM docker:dind-rootless
USER root

# Keep this in sync with the musl tag below — the SDK's version check reads it
ENV SANDBOX_VERSION=0.12.7

# Use the musl build so it runs on Alpine-based docker:dind-rootless
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /container-server/sandbox /sandbox
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /bin/bash /bin/bash
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /usr/lib/libreadline.so.8 /usr/lib/libreadline.so.8
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /usr/lib/libreadline.so.8.2 /usr/lib/libreadline.so.8.2
# cloudflared backs the tunnels API (quick *.trycloudflare.com URLs) — the
# sandbox SDK shells out to this binary inside the container; without it
# tunnel.get fails with "Tunnel recovery attempts were exhausted".
COPY --from=docker.io/cloudflare/sandbox:0.12.7-musl /usr/local/bin/cloudflared /usr/local/bin/cloudflared

# The official sandbox image provides /workspace; the dind base does not.
# The container server's file/watch APIs restrict paths to this tree.
RUN mkdir -p /workspace

# Create startup script that starts dockerd with
# iptables disabled, waits for readiness, then keeps running
RUN printf '#!/bin/sh\n\
  set -eu\n\
  dockerd-entrypoint.sh dockerd --iptables=false --ip6tables=false &\n\
  until docker version >/dev/null 2>&1; do sleep 0.2; done\n\
  echo "Docker is ready"\n\
  wait\n' > /home/rootless/boot-docker-for-dind.sh && chmod +x /home/rootless/boot-docker-for-dind.sh

# Node.js + npm — required for the Kimi Code CLI. Note: install.sh can't be
# used on this base — it ships glibc-only binaries and docker:dind-rootless is
# Alpine (musl), so npm is the right install route here
# github-cli is Alpine's package name for the GitHub CLI (provides `gh`)
# inotify-tools provides inotifywait — the container server's watch API (used
# by the review pipeline's localBucket sync) shells out to it; the official
# sandbox image ships it
# curl is the sandbox's general HTTP client (API probes in design sessions and
# the design agent's presigned-upload PUTs)
# chromium (musl-native) is the headless browser behind design previews and
# @playwright/cli; glibc Playwright registry builds don't run on this base
# font-noto keeps chromium from rendering tofu glyphs
RUN apk add --no-cache nodejs npm github-cli inotify-tools curl \
	chromium font-noto

# @opencode/cli is the OpenCode v2 npm package (the older `opencode-ai`
# package still serves V1 1.x and rejects v2 config keys). Its npm bins are
# aliases of ONE binary that dispatches on argv[0]: `opencode` runs the V1
# back-compat CLI (rejects v2 config keys like the repo's committed
# opencode.jsonc) and `opencode2` runs the V2 CLI — the review wrapper picks
# opencode2 (see lib/review.ts). The musl platform binaries come from its
# optionalDependencies, so npm remains the right Alpine install route.
RUN npm install -g @moonshot-ai/kimi-code @opencode/cli @playwright/cli

# @playwright/cli drives headed browsing for agents; it can only launch the
# musl system chromium (Playwright's registry browsers are glibc-only), so a
# config pins executablePath to it. The file lives in /root/.playwright;
# sessions started elsewhere pass --config /root/.playwright/cli.config.json.
RUN mkdir -p /root/.playwright \
	&& printf '%s' '{"browser":{"browserName":"chromium","isolated":true,"launchOptions":{"executablePath":"/usr/bin/chromium-browser","args":["--no-sandbox","--disable-gpu"]}}}' \
	> /root/.playwright/cli.config.json

# pnpm — needed to install dependencies inside cloned repos (this repo and
# the repos it reviews use pnpm 10; pinned major matches packageManager).
RUN npm install -g pnpm@10

# Default Kimi Code sessions to fully autonomous mode and pin the default
# model to kimi-for-coding-highspeed inside the sandbox.
RUN mkdir -p /root/.kimi-code \
  && printf '%s\n' \
    'default_permission_mode = "auto"' \
    'default_model = "kimi-code/kimi-for-coding-highspeed"' \
    > /root/.kimi-code/config.toml

# Sandbox sessions launched by this worker set KIMI_MODEL_NAME explicitly, so
# this default only applies to manual container use. PR review checks pin
# their own model via the KIMI_MODEL_* env family (see lib/review.ts), which
# takes priority over this config.toml default.

ENTRYPOINT ["/sandbox"]
CMD ["/home/rootless/boot-docker-for-dind.sh"]


# Documents the ports this application uses (standard Docker convention)
EXPOSE 8080

# Design sessions run opencode interactively in the admin terminal view
# (lib/design-session.ts) — no long-lived `opencode web` process is started.
# Port kept for local wrangler-dev exposure; production tunnels connect
# inside the container regardless.
EXPOSE 4096
