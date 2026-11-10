#!/bin/sh
# Installs (or reinstalls) the LaunchAgent that scores held leads with Claude Code on this Mac, twice a day:
# 7:15 (after the 6-7 am Vercel scout) and 19:15. Scoring runs on the Claude subscription, not API credits.
# Usage: sh scripts/install-score-leads.sh        (remove with: launchctl bootout gui/$(id -u)/com.fftank.score-leads)
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.fftank.score-leads"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$DIR/scripts/score-leads.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>15</integer></dict>
    <dict><key>Hour</key><integer>19</integer><key>Minute</key><integer>15</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/ff-tank-score-leads.out</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/ff-tank-score-leads.err</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (7:15 and 19:15) -> $PLIST; log: ~/Library/Logs/ff-tank-score-leads.log"
