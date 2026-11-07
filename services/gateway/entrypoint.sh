#!/bin/sh
# NiubiGEO Gateway start-up: checks the settings, hashes the basic-auth password for Caddy
# (bcrypt), derives the session-cookie token and starts Caddy. The plain password and the
# session secret are removed from Caddy's environment.
#
#   entrypoint.sh           start Caddy with the Railway variables
#   entrypoint.sh --check   validate the Caddyfile with throwaway values (used by the Docker build)
set -eu

fail() {
	echo "niubigeo-gateway: $*" >&2
	exit 1
}

mode=run
if [ "${1:-}" = "--check" ]; then
	mode=validate
	BASIC_AUTH_USERNAME=build-check
	BASIC_AUTH_PASSWORD=build-check-password-0123456789
	NIUBIGEO_GATEWAY_SESSION_SECRET=build-check-secret-0123456789abcdefghijklmnop
	NIUBIGEO_UPSTREAM=localhost:8787
fi

: "${BASIC_AUTH_USERNAME:?BASIC_AUTH_USERNAME must be set}"
: "${BASIC_AUTH_PASSWORD:?BASIC_AUTH_PASSWORD must be set}"
: "${NIUBIGEO_GATEWAY_SESSION_SECRET:?NIUBIGEO_GATEWAY_SESSION_SECRET must be set}"
: "${NIUBIGEO_UPSTREAM:?NIUBIGEO_UPSTREAM must be set, e.g. niubigeo.railway.internal:8787}"

case "${BASIC_AUTH_USERNAME}" in
	*[!A-Za-z0-9._-]*) fail "BASIC_AUTH_USERNAME may only contain A-Z a-z 0-9 . _ -" ;;
esac
[ "${#BASIC_AUTH_PASSWORD}" -ge 16 ] || fail "BASIC_AUTH_PASSWORD must be at least 16 characters"
[ "${#NIUBIGEO_GATEWAY_SESSION_SECRET}" -ge 32 ] || fail "NIUBIGEO_GATEWAY_SESSION_SECRET must be at least 32 characters"
case "${NIUBIGEO_UPSTREAM}" in
	*[!A-Za-z0-9.:_-]* | *:) fail "NIUBIGEO_UPSTREAM must look like host:port, got '${NIUBIGEO_UPSTREAM}'" ;;
	*:*) ;;
	*) fail "NIUBIGEO_UPSTREAM must include a port, e.g. niubigeo.railway.internal:8787" ;;
esac
case "${PORT:-8080}" in
	"" | *[!0-9]*) fail "PORT must be a number" ;;
esac

# Caddy only accepts hashed passwords.
BASIC_AUTH_HASH="$(caddy hash-password --algorithm bcrypt --plaintext "${BASIC_AUTH_PASSWORD}")"
case "${BASIC_AUTH_HASH}" in
	'$2'*) ;;
	*) fail "caddy hash-password did not return a bcrypt hash" ;;
esac

# The session cookie proves an earlier basic-auth login. It changes whenever the user name,
# the password or NIUBIGEO_GATEWAY_SESSION_SECRET changes, which signs everyone out.
NIUBIGEO_GATEWAY_SESSION_TOKEN="$(
	printf 'niubigeo-gateway-session-v1\n%s\n%s\n%s\n' \
		"${NIUBIGEO_GATEWAY_SESSION_SECRET}" "${BASIC_AUTH_USERNAME}" "${BASIC_AUTH_PASSWORD}" |
		sha256sum | cut -d ' ' -f 1
)"
case "${NIUBIGEO_GATEWAY_SESSION_TOKEN}" in
	*[!0-9a-f]* | "") fail "could not derive the session token" ;;
esac
[ "${#NIUBIGEO_GATEWAY_SESSION_TOKEN}" -eq 64 ] || fail "could not derive the session token"

export BASIC_AUTH_USERNAME BASIC_AUTH_HASH NIUBIGEO_GATEWAY_SESSION_TOKEN NIUBIGEO_UPSTREAM
unset BASIC_AUTH_PASSWORD NIUBIGEO_GATEWAY_SESSION_SECRET

if [ "${mode}" = run ]; then
	echo "niubigeo-gateway: basic auth for user ${BASIC_AUTH_USERNAME}, upstream ${NIUBIGEO_UPSTREAM}, port ${PORT:-8080}"
fi
exec caddy "${mode}" --config /etc/caddy/Caddyfile --adapter caddyfile
