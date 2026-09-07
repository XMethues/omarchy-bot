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
# Install the pinned runtime when needed, while preserving any supported Bun
# 1.4-or-newer runtime already present in the Cloud Agent image.
bun_version="1.4.2"
bun_path="$(command -v bun || true)"
provisioned_bun=false

is_supported_bun_version() {
  local version="$1"
  local major minor
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.[0-9]+$ ]]; then
    return 1
  fi
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  (( 10#$major > 1 || (10#$major == 1 && 10#$minor >= 4) ))
}

installed_bun_version="$("$bun_path" --version 2>/dev/null || true)"
if ! is_supported_bun_version "$installed_bun_version"; then
  export BUN_INSTALL="$HOME/.bun"
  bun_path="$BUN_INSTALL/bin/bun"
  installed_bun_version="$("$bun_path" --version 2>/dev/null || true)"
  if ! is_supported_bun_version "$installed_bun_version"; then
    curl -fsSL https://bun.sh/install | bash -s "bun-v${bun_version}"
    provisioned_bun=true
  fi
fi

installed_bun_version="$("$bun_path" --version 2>/dev/null || true)"
if ! is_supported_bun_version "$installed_bun_version"; then
  printf 'Bun 1.4 or newer installation failed after requesting %s (found %s).\n' \
    "$bun_version" "${installed_bun_version:-none}" >&2
  exit 1
fi
export PATH="$(dirname "$bun_path"):$PATH"
if "$provisioned_bun"; then
  sudo ln -sf "$bun_path" /usr/local/bin/bun
  sudo ln -sf "$HOME/.bun/bin/bunx" /usr/local/bin/bunx
fi

# --- Workspace dependencies ------------------------------------------------
"$bun_path" install --frozen-lockfile

# --- Native pointer helper -------------------------------------------------
# Compiles the Wayland input helper so Computer Control is ready to run.
"$bun_path" run --filter='@omarchy-bot/daemon' build

# --- Browser for integration/e2e tests -------------------------------------
# The web-dev-runtime integration test and the Playwright e2e suite drive a
# real Chromium. Install the browser plus its system dependencies.
"$bun_path" x playwright install --with-deps chromium

echo "Omarchy Bot environment ready."
