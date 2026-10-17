#!/system/bin/sh
# Run via root only, with an existing Marjane PID. Temporary app-namespace trust
# mount, not a system CA installation, Magisk module, or zygote modification.
set -eu
CERTS=/data/local/tmp/marjane-re-cacerts
APEX=/apex/com.android.conscrypt/cacerts
SELF=/data/local/tmp/marjane-re-mount.sh

if [ "${1:-}" = inside ]; then
    # Prevent this namespace's mount events propagating to other namespaces.
    # Android toybox mount does not implement the util-linux --make-rprivate
    # syntax. Use the installed Magisk BusyBox's explicit mount options.
    MOUNT=/data/adb/magisk/busybox
    "$MOUNT" mount -o rprivate / /
    "$MOUNT" mount -o bind "$CERTS" "$APEX"
    "$MOUNT" mount -o remount,bind,ro "$CERTS" "$APEX"
    echo app-namespace-ca-mounted
    exit 0
fi

PID=${1:-}
case "$PID" in ''|*[!0-9]*) echo invalid-pid >&2; exit 1;; esac
NAME=$(tr '\000' '\n' < "/proc/$PID/cmdline" | head -n 1)
[ "$NAME" = com.marjane.app ] || { echo not-marjane >&2; exit 1; }
APP_NS=$(readlink "/proc/$PID/ns/mnt")
[ "$APP_NS" != "$(readlink /proc/1/ns/mnt)" ] || { echo unsafe-shared-namespace >&2; exit 1; }
for ZYGOTE in $(pidof zygote zygote64 2>/dev/null || true); do
    [ "$APP_NS" != "$(readlink /proc/$ZYGOTE/ns/mnt)" ] || { echo unsafe-zygote-namespace >&2; exit 1; }
done
HASH=${2:-}
case "$HASH" in ????????) ;; *) echo invalid-ca-hash >&2; exit 1;; esac
case "$HASH" in *[!a-f0-9]*) echo invalid-ca-hash >&2; exit 1;; esac
[ -r "$CERTS/$HASH.0" ] || { echo missing-capture-ca >&2; exit 1; }
exec nsenter --mount="/proc/$PID/ns/mnt" -- sh "$SELF" inside
