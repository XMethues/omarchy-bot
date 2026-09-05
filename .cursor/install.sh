#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for Omarchy Bot.
# Safe to re-run: every step checks or converges to the desired state.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# --- System packages -------------------------------------------------------
# The Wayland client toolchain builds the daemon's native pointer helper
# (apps/daemon/native/pointer-helper); a C compiler and pkg-config are usually
# already present in the base image but are installed here for robustness.
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends \
  build-essential \
  pkg-config \
  git \
  curl \
  libwayland-bin \
  libwayland-dev \
  libxkbcommon-dev

# --- Bun runtime -----------------------------------------------------------
# Pin the major line the repo targets (Bun 1.4+). Install only when missing so
# re-runs are fast, then expose it on PATH for install/start/terminals shells.
if [ ! -x "$HOME/.bun/bin/bun" ]; then
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
sudo ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
sudo ln -sf "$HOME/.bun/bin/bunx" /usr/local/bin/bunx

# --- Workspace dependencies ------------------------------------------------
bun install --frozen-lockfile

# --- Native pointer helper -------------------------------------------------
# Compiles the Wayland input helper so Computer Control is ready to run.
bun run --filter='@omarchy-bot/daemon' build

# --- Browser for integration/e2e tests -------------------------------------
# The web-dev-runtime integration test and the Playwright e2e suite drive a
# real Chromium. Install the browser plus its system dependencies.
bunx playwright install --with-deps chromium

echo "Omarchy Bot environment ready."
