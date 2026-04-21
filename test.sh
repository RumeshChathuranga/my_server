#!/bin/bash
set -e

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-}"
STARTED_SERVER=0
SERVER_PID=""

port_in_use() {
  ss -ltn "sport = :$1" | awk 'NR > 1 { found = 1 } END { exit(found ? 0 : 1) }'
}

if [ -z "$PORT" ]; then
  for candidate in $(seq 1234 1300); do
    if ! port_in_use "$candidate"; then
      PORT="$candidate"
      break
    fi
  done
fi

if [ -z "$PORT" ]; then
  echo "Could not find an open port in range 1234-1300"
  exit 1
fi

BASE="http://${HOST}:${PORT}"

cleanup() {
  if [ "$STARTED_SERVER" -eq 1 ] && [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

PORT="$PORT" node --enable-source-maps dist/main.js >/dev/null 2>&1 &
SERVER_PID=$!
STARTED_SERVER=1

# Wait briefly for server startup before running tests
for _ in $(seq 1 30); do
  if curl -s --max-time 1 "$BASE/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if ! curl -s --max-time 1 "$BASE/health" >/dev/null 2>&1; then
  echo "Server did not become ready at $BASE"
  exit 1
fi

echo "=== Test 1: Root route ==="
curl -s $BASE/ | head -3

echo ""
echo "=== Test 2: POST /echo ==="
curl -s -X POST --data-binary "hello world" $BASE/echo

echo ""
echo "=== Test 3: Static file ==="
echo "Test file content" > public/test.txt
curl -s $BASE/files/test.txt

echo ""
echo "=== Test 4: Gzip compression ==="
curl -s --compressed -v $BASE/ 2>&1 | grep -i "content-encoding" || echo "(no gzip on this route)"

echo ""
echo "=== Test 5: Range request ==="
curl -s -H "Range: bytes=0-3" $BASE/files/test.txt

echo ""
echo "=== Test 6: Health check ==="
curl -s $BASE/health

echo ""
echo "=== Test 7: 404 ==="
curl -o /dev/null -s -w "Status: %{http_code}\n" $BASE/nonexistent

echo ""
echo "✅ All tests complete."