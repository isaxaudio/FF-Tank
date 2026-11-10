#!/bin/sh
# Installs (or reinstalls) the two FF Tank jobs that run on this Mac mini, on the Claude subscription and local tokens:
#   com.fftank.score-leads   7:15 and 19:15  scripts/score-leads.mjs         (Claude Code scores held leads, writes pitches)
#   com.fftank.flex-refresh  02:30 nightly   scripts/flex-refresh.mjs --apply (Flex documents and clients, upsert only)
# Logs: ~/Library/Logs/ff-tank-score-leads.log, ~/Library/Logs/ff-tank-flex-refresh.out
# Remove: launchctl bootout gui/$(id -u)/com.fftank.score-leads ; launchctl bootout gui/$(id -u)/com.fftank.flex-refresh
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PATHS="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install_job() { # label, times-xml, script args…
  LABEL="$1"; TIMES="$2"; shift 2
  ARGS=""; for a in "$@"; do ARGS="$ARGS<string>$a</string>"; done
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string>$ARGS</array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATHS</string></dict>
  <key>StartCalendarInterval</key><array>$TIMES</array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/$LABEL.out</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/$LABEL.err</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed $LABEL -> $PLIST"
}
at() { echo "<dict><key>Hour</key><integer>$1</integer><key>Minute</key><integer>$2</integer></dict>"; }
install_job com.fftank.score-leads "$(at 7 15)$(at 19 15)" "$DIR/scripts/score-leads.mjs"
install_job com.fftank.flex-refresh "$(at 2 30)" "$DIR/scripts/flex-refresh.mjs" "--apply"
