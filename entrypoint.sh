#!/bin/bash
set -e

# ============================================================
# WARP Setup (optional - only runs if WARP_ENABLED=true)
# Provides a SOCKS5 proxy on localhost:40000 used ONLY by AllDebrid link/unlock,
# which AllDebrid refuses from a datacenter address.
# ============================================================

if [ "${WARP_ENABLED}" = "true" ] || [ "${WARP_ENABLED}" = "1" ]; then
    echo "[WARP] Starting Cloudflare WARP in proxy mode..."

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
    wait_for_warp "Status update" || echo "[WARP] WARNING: warp-svc did not answer within ${WARP_TIMEOUT}s"

    # Register WARP if not already registered
    if [ ! -f /var/lib/cloudflare-warp/reg.json ]; then
        warp-cli --accept-tos registration new && echo "[WARP] Client registered"
        if [ -n "$WARP_LICENSE_KEY" ]; then
            warp-cli --accept-tos registration license "$WARP_LICENSE_KEY" && echo "[WARP] License registered"
        fi
    else
        echo "[WARP] Client already registered"
    fi

    # Proxy mode tunnels only what is sent to the local SOCKS5 port, so every other request the
    # addon makes keeps the host's own address. warp-svc serves that port itself.
    warp-cli --accept-tos mode proxy
    warp-cli --accept-tos proxy port "$WARP_PORT"
    warp-cli --accept-tos connect
    wait_for_warp "Connected" || echo "[WARP] WARNING: not connected after ${WARP_TIMEOUT}s"

    # Verify WARP is working
    if curl -s --socks5-hostname "127.0.0.1:$WARP_PORT" "https://cloudflare.com/cdn-cgi/trace" 2>/dev/null | grep -q "warp=on\|warp=plus"; then
        echo "[WARP] Connected, proxy on 127.0.0.1:$WARP_PORT"
    else
        echo "[WARP] WARNING: WARP may not be connected. AllDebrid link/unlock may return NO_SERVER."
    fi

    # Set the proxy URL for the Node.js app to pick up
    export ALLDEBRID_PROXY_URL="socks5h://127.0.0.1:$WARP_PORT"
else
    echo "[WARP] Disabled (set WARP_ENABLED=true to enable)"
fi

# A supplied command lets one-shot checks use the same WARP setup as production.
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec npm start
