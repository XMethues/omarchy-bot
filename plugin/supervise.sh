#!/usr/bin/env bash
set -euo pipefail

state_home=${XDG_STATE_HOME:-${HOME:?Omarchy Bot requires HOME}/.local/state}
mkdir -p "$state_home/omarchy-bot"
log=$state_home/omarchy-bot/plugin-launch.log
launcher=${OMARCHY_BOT_PLUGIN_LAUNCH:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/launch.sh}

set +e
bash "$launcher" >"$log" 2>&1
status=$?
set -e

if (( status != 0 )) && command -v notify-send >/dev/null; then
  notify-send -u critical "Omarchy Bot" "Failed to start. See $log" || true
fi

exit "$status"
