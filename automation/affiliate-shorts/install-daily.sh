#!/bin/bash
# 맥에서 매일 자동 제작(auto)을 돌리는 LaunchAgent 설치.
# 맥이 잠들어 있던 시간이 지나면, 깨어난 직후 한 번 실행된다.
#   ./install-daily.sh          매일 10:00
#   ./install-daily.sh 14 30    매일 14:30
#   ./install-daily.sh remove   해제
set -euo pipefail

LABEL=com.affiliate-shorts.daily
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = remove ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "해제했습니다."
  exit 0
fi

HOUR="${1:-10}"
MINUTE="${2:-0}"
NODE="$(command -v node)"
mkdir -p "$DIR/out" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string><string>--env-file-if-exists=.env</string><string>src/cli.mjs</string><string>auto</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
  <key>StandardOutPath</key><string>$DIR/out/daily.log</string>
  <key>StandardErrorPath</key><string>$DIR/out/daily.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
printf '매일 %02d:%02d 에 자동 제작합니다. 기록: %s/out/daily.log\n' "$HOUR" "$MINUTE" "$DIR"
