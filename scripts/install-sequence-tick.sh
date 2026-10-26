#!/bin/sh
# Installs (or reinstalls) the LaunchAgent that ticks the sequence scheduler every 15 minutes from this Mac.
# Usage: sh scripts/install-sequence-tick.sh        (remove with: launchctl bootout gui/$(id -u)/com.fftank.sequence-tick)
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.fftank.sequence-tick"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod +x "$DIR/scripts/sequence-tick.sh"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$DIR/scripts/sequence-tick.sh</string></array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/ff-tank-sequence-tick.out</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/ff-tank-sequence-tick.err</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (every 15 min) -> $PLIST; log: ~/Library/Logs/ff-tank-sequence-tick.log"
