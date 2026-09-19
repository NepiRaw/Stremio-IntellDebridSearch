#!/bin/bash
set -e

# ============================================================
# WARP Setup (optional - only runs if WARP_ENABLED=true)
# Provides a SOCKS5 proxy on localhost:40000 used ONLY by AllDebrid link/unlock,
# which AllDebrid refuses from a datacenter address.
# ============================================================

log() {
    local level="$1" symbol="$2" message="$3" fields="$4"
    printf '%s  %-7s  [system  ]  %s 🛡️ %-17s  %-22s  %s\n' "$(date -u +'%Y-%m-%d %H:%M:%S.%3NZ')" "[$level]" "$symbol" "WARP.startup" "$message" "$fields"
}

if [ "${WARP_ENABLED}" = "true" ] || [ "${WARP_ENABLED}" = "1" ]; then
    WARP_PORT="${WARP_PORT:-40000}"
    WARP_TIMEOUT="${WARP_TIMEOUT:-30}"

    # Waits for a warp-cli state instead of guessing how long the daemon needs.
    wait_for_warp() {
        for _ in $(seq "$WARP_TIMEOUT"); do
            if warp-cli --accept-tos status 2>/dev/null | grep -q "$1"; then
                return 0
            fi
            sleep 1
        done
        return 1
    }

    # Start dbus (required by warp-svc)
    mkdir -p /run/dbus
    if [ -f /run/dbus/pid ]; then
        rm /run/dbus/pid
    fi
    dbus-daemon --config-file=/usr/share/dbus-1/system.conf

    # Start WARP daemon (suppress verbose daemon logs)
    warp-svc --accept-tos > /dev/null 2>&1 &
    wait_for_warp "Status update" || log WARN "⚠" "Daemon not answering" "timeout=${WARP_TIMEOUT}s"

    # Register WARP if not already registered
    if [ ! -f /var/lib/cloudflare-warp/reg.json ]; then
        warp-cli --accept-tos registration new > /dev/null && log DEBUG " " "Client registered" "registered=new"
        if [ -n "$WARP_LICENSE_KEY" ]; then
            warp-cli --accept-tos registration license "$WARP_LICENSE_KEY" > /dev/null && log DEBUG " " "License registered" ""
        fi
    else
        log DEBUG " " "Client registered" "registered=existing"
    fi

    # Proxy mode tunnels only what is sent to the local SOCKS5 port, so every other request the
    # addon makes keeps the host's own address. warp-svc serves that port itself.
    warp-cli --accept-tos mode proxy > /dev/null
    warp-cli --accept-tos proxy port "$WARP_PORT" > /dev/null
    warp-cli --accept-tos connect > /dev/null
    wait_for_warp "Connected" || log WARN "⚠" "Not connected" "timeout=${WARP_TIMEOUT}s"

    # Verify WARP is working
    if curl -s --socks5-hostname "127.0.0.1:$WARP_PORT" "https://cloudflare.com/cdn-cgi/trace" 2>/dev/null | grep -q "warp=on\|warp=plus"; then
        log INFO "✓" "Proxy ready" "mode=proxy  port=$WARP_PORT"
    else
        log WARN "⚠" "Proxy unverified" "mode=proxy  port=$WARP_PORT  code=NO_SERVER_RISK"
    fi

    # Set the proxy URL for the Node.js app to pick up
    export ALLDEBRID_PROXY_URL="socks5h://127.0.0.1:$WARP_PORT"
else
    log INFO " " "Proxy disabled" "mode=off"
fi

# A supplied command lets one-shot checks use the same WARP setup as production.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

# Node prints a notice when the env file is missing; the container gets its environment from compose.
[ -f /app/.env ] || : > /app/.env
exec npm start --silent
