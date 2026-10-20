#!/bin/bash
# 맥에서 정해진 시각마다 스레드 글을 하나씩 자동 게시하는 LaunchAgent 설치.
# 맥이 잠들어 있어 놓친 시각은 깨어난 직후 한 번 실행되고, 하루 최대 개수(THREADS_MAX_PER_DAY)는 넘지 않는다.
#   ./install-threads.sh                         09:40 13:10 20:20
#   ./install-threads.sh "08:50 12:35 21:05"     시각 직접 지정
#   ./install-threads.sh remove                  해제
set -euo pipefail

LABEL=com.affiliate-shorts.threads
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" = remove ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "해제했습니다."
  exit 0
fi

TIMES="${1:-09:40 13:10 20:20}"
NODE="$(command -v node)"
mkdir -p "$DIR/out" "$HOME/Library/LaunchAgents"

INTERVALS=""
for t in $TIMES; do
  h=$((10#${t%%:*})); m=$((10#${t##*:}))
  INTERVALS+="<dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>$m</integer></dict>"
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string><string>--env-file-if-exists=.env</string><string>src/cli.mjs</string><string>threads</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key>
  <array>$INTERVALS</array>
  <key>StandardOutPath</key><string>$DIR/out/threads.log</string>
  <key>StandardErrorPath</key><string>$DIR/out/threads.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "스레드 자동 게시: 매일 $TIMES. 기록: $DIR/out/threads.log"
