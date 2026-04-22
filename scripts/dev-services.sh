#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${ROOT_DIR}/.runtime/dev-services"

RELAY_PID_FILE="${RUNTIME_DIR}/relay-server.pid"
AGENT_PID_FILE="${RUNTIME_DIR}/desktop-agent.pid"

RELAY_LOG_FILE="${RUNTIME_DIR}/relay-server.log"
AGENT_LOG_FILE="${RUNTIME_DIR}/desktop-agent.log"

RELAY_PORT="${RELAY_PORT:-8787}"
DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/codex_mobile}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
RELAY_BIND_HOST="${RELAY_BIND_HOST:-127.0.0.1}"
RELAY_PUBLIC_BASE_URL="${RELAY_PUBLIC_BASE_URL:-}"
RELAY_PUBLIC_WS_URL="${RELAY_PUBLIC_WS_URL:-}"
RELAY_ENABLE_DEV_RESET="${RELAY_ENABLE_DEV_RESET:-1}"
STRICT_PORT_CHECK="${DEV_SERVICES_STRICT_PORT:-0}"
LOCAL_RELAY_WS_URL="${LOCAL_RELAY_WS_URL:-ws://127.0.0.1:${RELAY_PORT}/v1/connect}"
RELAY_MATCH_PATTERN="node runtime-apps/relay-server/dist/server\\.js serve"
AGENT_MATCH_PATTERN="node runtime-apps/desktop-agent/dist/main\\.js serve"
RELAY_HEALTH_URL="http://127.0.0.1:${RELAY_PORT}/healthz"

mkdir -p "${RUNTIME_DIR}"

read_pid() {
  local pid_file="$1"
  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  local pid
  pid="$(tr -d '[:space:]' < "${pid_file}")"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  echo "${pid}"
}

is_pid_running() {
  local pid="$1"
  kill -0 "${pid}" 2>/dev/null
}

process_matches_pattern() {
  local pid="$1"
  local match_pattern="$2"
  local command
  command="$(ps -o command= -p "${pid}" 2>/dev/null || true)"
  if [[ -z "${command}" ]]; then
    return 1
  fi

  printf '%s\n' "${command}" | grep -Eq "${match_pattern}"
}

cleanup_stale_pid_file() {
  local pid_file="$1"
  local match_pattern="${2:-}"
  local pid
  if ! pid="$(read_pid "${pid_file}")"; then
    rm -f "${pid_file}"
    return
  fi
  if ! is_pid_running "${pid}"; then
    rm -f "${pid_file}"
    return
  fi
  if [[ -n "${match_pattern}" ]] && ! process_matches_pattern "${pid}" "${match_pattern}"; then
    rm -f "${pid_file}"
  fi
}

is_relay_healthy() {
  curl -fsS --max-time 1 "${RELAY_HEALTH_URL}" >/dev/null 2>&1
}

wait_for_relay_ready() {
  local pid
  if ! pid="$(read_pid "${RELAY_PID_FILE}")"; then
    echo "[dev-services] relay-server 未记录 pid，无法等待健康检查"
    return 1
  fi

  for _ in $(seq 1 40); do
    if ! is_pid_running "${pid}"; then
      echo "[dev-services] relay-server 进程已退出，请检查日志: ${RELAY_LOG_FILE}"
      return 1
    fi
    if is_relay_healthy; then
      return 0
    fi
    sleep 0.25
  done

  echo "[dev-services] relay-server 启动后未通过健康检查: ${RELAY_HEALTH_URL}"
  return 1
}

start_service() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local start_command="$4"
  local match_pattern="$5"

  cleanup_stale_pid_file "${pid_file}" "${match_pattern}"

  local pid
  if ! pid="$(read_pid "${pid_file}")"; then
    pid="$(pgrep -f "${match_pattern}" | head -n 1 || true)"
    if [[ -n "${pid}" ]]; then
      echo "${pid}" > "${pid_file}"
    fi
  fi

  if pid="$(read_pid "${pid_file}")" && is_pid_running "${pid}" && process_matches_pattern "${pid}" "${match_pattern}"; then
    echo "[dev-services] ${name} 已在运行 (pid=${pid})"
    return 0
  fi

  echo "[dev-services] 启动 ${name} ..."
  nohup bash -lc "cd \"${ROOT_DIR}\" && ${start_command}" < /dev/null >> "${log_file}" 2>&1 &
  pid="$!"
  echo "${pid}" > "${pid_file}"

  sleep 1
  if ! is_pid_running "${pid}" || ! process_matches_pattern "${pid}" "${match_pattern}"; then
    echo "[dev-services] ${name} 启动失败，请检查日志: ${log_file}"
    return 1
  fi

  echo "[dev-services] ${name} 已启动 (pid=${pid})"
}

stop_service() {
  local name="$1"
  local pid_file="$2"
  local match_pattern="$3"

  cleanup_stale_pid_file "${pid_file}" "${match_pattern}"

  local pid
  if ! pid="$(read_pid "${pid_file}")"; then
    local matched_pids
    matched_pids="$(pgrep -f "${match_pattern}" || true)"
    if [[ -n "${matched_pids}" ]]; then
      echo "[dev-services] ${name} 检测到孤儿进程，执行清理: ${matched_pids//$'\n'/ }"
      for orphan_pid in ${matched_pids}; do
        kill "${orphan_pid}" 2>/dev/null || true
      done
    else
      echo "[dev-services] ${name} 未运行"
    fi
    return 0
  fi

  if ! is_pid_running "${pid}"; then
    rm -f "${pid_file}"
    echo "[dev-services] ${name} 未运行"
    return 0
  fi

  echo "[dev-services] 停止 ${name} (pid=${pid}) ..."
  kill "${pid}" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! is_pid_running "${pid}"; then
      rm -f "${pid_file}"
      echo "[dev-services] ${name} 已停止"
      return 0
    fi
    sleep 0.25
  done

  kill -9 "${pid}" 2>/dev/null || true
  rm -f "${pid_file}"
  echo "[dev-services] ${name} 强制停止"

  local leftovers
  leftovers="$(pgrep -f "${match_pattern}" || true)"
  if [[ -n "${leftovers}" ]]; then
    echo "[dev-services] ${name} 清理残留进程: ${leftovers//$'\n'/ }"
    for leftover_pid in ${leftovers}; do
      kill -9 "${leftover_pid}" 2>/dev/null || true
    done
  fi
}

show_status() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local match_pattern="${4:-}"

  cleanup_stale_pid_file "${pid_file}" "${match_pattern}"

  local pid
  if pid="$(read_pid "${pid_file}")" && is_pid_running "${pid}" && { [[ -z "${match_pattern}" ]] || process_matches_pattern "${pid}" "${match_pattern}"; }; then
    echo "[dev-services] ${name}: running (pid=${pid})"
  else
    echo "[dev-services] ${name}: stopped"
  fi

  if [[ -f "${log_file}" ]]; then
    echo "[dev-services] ${name} 日志: ${log_file}"
  fi
}

kill_port_conflict() {
  local pids
  pids="$(lsof -ti "tcp:${RELAY_PORT}" || true)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi

  echo "[dev-services] 检测到端口 ${RELAY_PORT} 被占用: ${pids}"
  for pid in ${pids}; do
    local command
    command="$(ps -o command= -p "${pid}" 2>/dev/null || true)"
    if [[ "${command}" == *"dist/server.js serve"* ]] || [[ "${command}" == *"runtime-apps/relay-server/dist/server.js serve"* ]] || [[ "${command}" == *"@kodexlink/relay-server"* ]]; then
      echo "[dev-services] 清理 relay 相关占用进程 ${pid}"
      kill "${pid}" 2>/dev/null || true
    else
      if [[ "${STRICT_PORT_CHECK}" == "1" ]]; then
        echo "[dev-services] 端口占用进程 ${pid} 非 relay-server，请手动处理后再重试"
        echo "[dev-services] command: ${command}"
        return 1
      fi
      echo "[dev-services] 清理非 relay 的端口占用进程 ${pid}"
      echo "[dev-services] command: ${command}"
      kill "${pid}" 2>/dev/null || true
    fi
  done
}

start_all() {
  kill_port_conflict
  start_service \
    "relay-server" \
    "${RELAY_PID_FILE}" \
    "${RELAY_LOG_FILE}" \
    "export DATABASE_URL='${DATABASE_URL}' REDIS_URL='${REDIS_URL}' RELAY_BIND_HOST='${RELAY_BIND_HOST}' RELAY_PUBLIC_BASE_URL='${RELAY_PUBLIC_BASE_URL}' RELAY_PUBLIC_WS_URL='${RELAY_PUBLIC_WS_URL}' RELAY_ENABLE_DEV_RESET='${RELAY_ENABLE_DEV_RESET}' && pnpm --filter @kodexlink/relay-server build && node runtime-apps/relay-server/dist/server.js migrate && exec node runtime-apps/relay-server/dist/server.js serve" \
    "${RELAY_MATCH_PATTERN}"
  wait_for_relay_ready
  start_service \
    "desktop-agent" \
    "${AGENT_PID_FILE}" \
    "${AGENT_LOG_FILE}" \
    "export KODEXLINK_RELAY_URL='${LOCAL_RELAY_WS_URL}' && pnpm --filter kodexlink build && exec node runtime-apps/desktop-agent/dist/main.js serve" \
    "${AGENT_MATCH_PATTERN}"
}

stop_all() {
  stop_service "desktop-agent" "${AGENT_PID_FILE}" "${AGENT_MATCH_PATTERN}"
  stop_service "relay-server" "${RELAY_PID_FILE}" "${RELAY_MATCH_PATTERN}"
}

status_all() {
  show_status "relay-server" "${RELAY_PID_FILE}" "${RELAY_LOG_FILE}" "${RELAY_MATCH_PATTERN}"
  show_status "desktop-agent" "${AGENT_PID_FILE}" "${AGENT_LOG_FILE}" "${AGENT_MATCH_PATTERN}"
}

tail_logs() {
  touch "${RELAY_LOG_FILE}" "${AGENT_LOG_FILE}"
  echo "[dev-services] relay 日志: ${RELAY_LOG_FILE}"
  echo "[dev-services] agent 日志: ${AGENT_LOG_FILE}"
  tail -f "${RELAY_LOG_FILE}" "${AGENT_LOG_FILE}"
}

reset_device_auth() {
  local device_id="${1:-}"
  local dev_reset_flag
  if [[ -z "${device_id}" ]]; then
    echo "[dev-services] 用法: bash scripts/dev-services.sh reset-auth <deviceId>"
    return 1
  fi

  dev_reset_flag="$(printf '%s' "${RELAY_ENABLE_DEV_RESET}" | tr '[:upper:]' '[:lower:]')"
  if [[ "${RELAY_ENABLE_DEV_RESET}" != "1" && "${dev_reset_flag}" != "true" && "${dev_reset_flag}" != "yes" ]]; then
    echo "[dev-services] 当前 RELAY_ENABLE_DEV_RESET=${RELAY_ENABLE_DEV_RESET}，未开启 dev reset"
    return 1
  fi

  if ! is_relay_healthy; then
    echo "[dev-services] relay-server 未就绪，无法执行 reset-auth"
    return 1
  fi

  echo "[dev-services] 重置设备认证: ${device_id}"
  curl -fsS \
    -X POST \
    -H "content-type: application/json" \
    -d "{\"deviceId\":\"${device_id}\"}" \
    "http://127.0.0.1:${RELAY_PORT}/v1/dev/reset-device-auth"
  echo
}

usage() {
  cat <<'EOF'
用法: bash scripts/dev-services.sh <up|down|status|logs|reset-auth>
EOF
}

case "${1:-}" in
  up)
    start_all
    status_all
    ;;
  down)
    stop_all
    status_all
    ;;
  status)
    status_all
    ;;
  logs)
    tail_logs
    ;;
  reset-auth)
    reset_device_auth "${2:-}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
