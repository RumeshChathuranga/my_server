#!/bin/bash
set -e
set -o pipefail

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
ROOT_FIXTURE="public/index.html"
ROOT_FIXTURE_CREATED=0

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1"
  exit 1
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label"
  else
    echo "Expected: $expected"
    echo "Actual  : $actual"
    fail "$label"
  fi
}

cleanup() {
  if [ "$ROOT_FIXTURE_CREATED" -eq 1 ]; then
    rm -f "$ROOT_FIXTURE"
  fi
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

if [ ! -f "$ROOT_FIXTURE" ]; then
  echo "<h1>my_server test index</h1>" > "$ROOT_FIXTURE"
  ROOT_FIXTURE_CREATED=1
fi

echo "=== Test 1: Root route ==="
ROOT_CODE=$(curl -s -o /tmp/my_server_root_body.txt -w "%{http_code}" "$BASE/")
assert_eq "$ROOT_CODE" "200" "GET / returns 200"
ROOT_BODY_SIZE=$(wc -c </tmp/my_server_root_body.txt | tr -d ' ')
if [ "$ROOT_BODY_SIZE" -gt 0 ]; then
  pass "GET / returns non-empty body"
else
  fail "GET / returns non-empty body"
fi
if [ "$ROOT_FIXTURE_CREATED" -eq 1 ]; then
  ROOT_BODY=$(< /tmp/my_server_root_body.txt)
  assert_eq "$ROOT_BODY" "<h1>my_server test index</h1>" "GET / serves index fixture content"
fi

echo ""
echo "=== Test 2: POST /echo ==="
ECHO_BODY=$(curl -s -X POST --data-binary "hello world" "$BASE/echo")
assert_eq "$ECHO_BODY" "hello world" "POST /echo echoes request body"

echo ""
echo "=== Test 3: Static file ==="
printf "Test file content" > public/test.txt
STATIC_BODY=$(curl -s "$BASE/files/test.txt")
assert_eq "$STATIC_BODY" "Test file content" "GET /files/test.txt returns file contents"

echo ""
echo "=== Test 4: Gzip compression ==="
GZIP_ENCODING=$(curl -s -D - -o /tmp/my_server_gzip_body.txt -H "Accept-Encoding: gzip" "$BASE/" \
  | awk 'BEGIN{IGNORECASE=1} /^Content-Encoding:/ {gsub("\r","",$0); print $2; exit}')
if [ "$GZIP_ENCODING" = "gzip" ]; then
  pass "Server advertises gzip when requested"
else
  fail "Server advertises gzip when requested"
fi

echo ""
echo "=== Test 5: Range request ==="
RANGE_CODE=$(curl -s -o /tmp/my_server_range_body.txt -w "%{http_code}" -H "Range: bytes=0-3" "$BASE/files/test.txt")
assert_eq "$RANGE_CODE" "206" "Range request returns 206"
RANGE_BODY=$(< /tmp/my_server_range_body.txt)
assert_eq "$RANGE_BODY" "Test" "Range request returns expected bytes"
RANGE_HEADER=$(curl -s -D - -o /dev/null -H "Range: bytes=0-3" "$BASE/files/test.txt" \
  | awk 'BEGIN{IGNORECASE=1} /^Content-Range:/ {gsub("\r","",$0); print $0; exit}')
assert_eq "$RANGE_HEADER" "Content-Range: bytes 0-3/17" "Range response includes Content-Range"

echo ""
echo "=== Test 6: Health check ==="
HEALTH_CODE=$(curl -s -o /tmp/my_server_health_body.txt -w "%{http_code}" "$BASE/health")
assert_eq "$HEALTH_CODE" "200" "GET /health returns 200"
HEALTH_BODY=$(< /tmp/my_server_health_body.txt)
assert_eq "$HEALTH_BODY" '{"status":"ok"}' "GET /health returns expected JSON"

echo ""
echo "=== Test 7: 404 ==="
NOT_FOUND_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/nonexistent")
assert_eq "$NOT_FOUND_CODE" "404" "Unknown route returns 404"

echo ""
echo "✅ All tests complete."