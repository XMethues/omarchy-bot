#!/usr/bin/env bash
set -euo pipefail

root=$(CDPATH= cd -- "${1:-$(dirname -- "$0")/..}" && pwd)
sha=${OMARCHY_BOT_PLUGIN_REVISION:-$(git -C "$root" rev-parse HEAD)}
out_dir=${2:-$root/dist-runtime}
mkdir -p "$out_dir"
out_dir=$(CDPATH= cd -- "$out_dir" && pwd)
asset=omarchy-bot-runtime-${sha}-x86_64.tar.zst

required=(
  apps/web/dist
  apps/daemon/dist/native-pointer/omarchy-bot-wayland-input
  apps/daemon/dist/native-capture/omarchy-bot-wayland-capture
  apps/daemon/dist/native-bot-desktop/omarchy-bot-desktop
  package.json
  bun.lock
  node_modules
)
for path in "${required[@]}"; do
  if [[ ! -e $root/$path ]]; then
    printf 'Omarchy Bot runtime package is missing %s\n' "$path" >&2
    exit 1
  fi
done
for helper in \
  apps/daemon/dist/native-pointer/omarchy-bot-wayland-input \
  apps/daemon/dist/native-capture/omarchy-bot-wayland-capture \
  apps/daemon/dist/native-bot-desktop/omarchy-bot-desktop
do
  if [[ ! -x $root/$helper ]]; then
    printf 'Omarchy Bot runtime package helper is not executable: %s\n' "$helper" >&2
    exit 1
  fi
done

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

payload=(
  package.json
  bun.lock
  bunfig.toml
  tsconfig.json
  tsconfig.base.json
  manifest.json
  apps
  packages
  workers
  node_modules
)
existing=()
for path in "${payload[@]}"; do
  if [[ -e $root/$path ]]; then
    existing+=("$path")
  fi
done

tar -C "$root" -cf - "${existing[@]}" | tar -C "$staging" -xf -

tar --zstd -cf "$out_dir/$asset" -C "$staging" .
(cd "$out_dir" && sha256sum -- "$asset" > "$asset.sha256")
printf '%s\n' "$out_dir/$asset"
