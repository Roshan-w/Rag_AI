#!/bin/sh
# Restarts the RAG containers if any of them has stopped. Run from cron every few minutes:
#   */5 * * * * /home/roshan/rag-system/deploy/watchdog.sh
# Writes what it did to watchdog.log, and the tunnel's current public link to tunnel-url.txt.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$DIR/watchdog.log"
URL_FILE="$DIR/tunnel-url.txt"
OLLAMA="http://127.0.0.1:11450"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }

restart_if_down() {
  if ! running "$1"; then
    log "$1 was not running — starting it"
    docker start "$1" >/dev/null 2>&1 || log "failed to start $1"
    return 0
  fi
  return 1
}

# Models first: the app is useless without them
if restart_if_down rag-ollama; then
  for i in $(seq 1 60); do curl -sf -m 3 "$OLLAMA/api/tags" >/dev/null && break; sleep 2; done
  # Load the models now so the first user question isn't slow
  for m in qwen2.5:7b llama3.1:8b; do
    curl -s -m 300 -o /dev/null "$OLLAMA/api/generate" -d "{\"model\":\"$m\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_ctx\":8192}}"
  done
  curl -s -m 60 -o /dev/null "$OLLAMA/api/embed" -d '{"model":"nomic-embed-text","input":"warmup"}'
  log "rag-ollama back up, models loaded"
fi

restart_if_down rag-system

if restart_if_down rag-tunnel; then
  sleep 15
fi
# Keep the current public link on record (it changes whenever the tunnel restarts)
URL=$(docker logs rag-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
if [ -n "$URL" ] && [ "$URL" != "$(cat "$URL_FILE" 2>/dev/null)" ]; then
  echo "$URL" > "$URL_FILE"
  log "tunnel public link is now $URL"
fi

# Keep the log small
[ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ] && tail -n 1000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exit 0
