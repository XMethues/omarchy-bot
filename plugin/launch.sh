#!/usr/bin/env bash
set -euo pipefail

plugin_root=${OMARCHY_BOT_PLUGIN_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
os_release=${OMARCHY_BOT_PLUGIN_OS_RELEASE:-/etc/os-release}
if [[ ! -r $os_release ]]; then
  printf 'Omarchy Bot requires a readable Omarchy release file: %s\n' "$os_release" >&2
  exit 1
fi

distribution_id=
while IFS='=' read -r key value; do
  if [[ $key == ID ]]; then
    distribution_id=${value%\"}
    distribution_id=${distribution_id#\"}
    distribution_id=${distribution_id%\'}
    distribution_id=${distribution_id#\'}
    break
  fi
done < "$os_release"
if [[ $distribution_id != omarchy || $(uname -m) != x86_64 ]]; then
  printf 'Omarchy Bot supports Omarchy on x86_64 only\n' >&2
  exit 1
fi

bun_bin=${OMARCHY_BOT_PLUGIN_BUN:-$(command -v bun || true)}
if [[ -z $bun_bin ]]; then
  printf 'Omarchy Bot requires Bun 1.4 or newer in PATH\n' >&2
  exit 1
fi
bun_version=$("$bun_bin" --version 2>/dev/null || true)
if [[ ! $bun_version =~ ^([0-9]+)\.([0-9]+) ]] \
  || (( BASH_REMATCH[1] < 1 )) \
  || (( BASH_REMATCH[1] == 1 && BASH_REMATCH[2] < 4 )); then
  printf 'Omarchy Bot requires Bun 1.4 or newer (found %s)\n' "${bun_version:-unknown}" >&2
  exit 1
fi

runtime_dir=${XDG_RUNTIME_DIR:?Omarchy Bot requires XDG_RUNTIME_DIR}
mkdir -p "$runtime_dir/omarchy-bot"
exec 9>"$runtime_dir/omarchy-bot/plugin.lock"
flock 9

revision=${OMARCHY_BOT_PLUGIN_REVISION:-$(git -C "$plugin_root" rev-parse HEAD)}
data_home=${XDG_DATA_HOME:-${HOME:?Omarchy Bot requires HOME}/.local/share}
apps_root="$data_home/omarchy-bot/app"
app_root="$apps_root/$revision"
ready="$app_root/.omarchy-bot-plugin-ready"
mkdir -p "$apps_root"
chmod 700 "$data_home/omarchy-bot" "$apps_root"

if [[ ! -f $ready || $(<"$ready") != "$revision" ]]; then
  staging="$apps_root/.stage-$revision-$$"
  rm -rf "$staging" "$app_root"
  mkdir -p "$staging"
  trap 'rm -rf "$staging"' EXIT
  git -C "$plugin_root" archive --format=tar "$revision" | tar -xf - -C "$staging"
  cd "$staging"
  "$bun_bin" install --frozen-lockfile
  "$bun_bin" run --filter=@omarchy-bot/web build
  "$bun_bin" apps/daemon/native/pointer-helper/build.ts
  "$bun_bin" apps/daemon/native/capture-helper/build.ts
  "$bun_bin" apps/daemon/native/bot-desktop/build.ts
  printf '%s\n' "$revision" > .omarchy-bot-plugin-ready
  mv "$staging" "$app_root"
  trap - EXIT
fi

for candidate in "$apps_root"/.stage-* "$apps_root"/*; do
  if [[ -d $candidate && $candidate != "$app_root" ]]; then
    rm -rf "$candidate"
  fi
done

cd "$app_root"
exec "$bun_bin" run start
