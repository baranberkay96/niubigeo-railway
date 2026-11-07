# NiubiGEO Gateway: the official Caddy image with HTTP basic auth in front of NiubiGEO,
# which has no login of its own. Caddy 2.11.9 (2026-11-05), pinned by index digest.
FROM caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee

# /etc/caddy and /usr/local/bin already exist in the image.
COPY Caddyfile /etc/caddy/Caddyfile
COPY --chmod=0755 entrypoint.sh /usr/local/bin/niubigeo-gateway-entrypoint.sh

# Run the start-up script with throwaway values: hashes a password, derives a session
# token and validates the Caddyfile. The build fails if any of that breaks.
RUN /usr/local/bin/niubigeo-gateway-entrypoint.sh --check

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/niubigeo-gateway-entrypoint.sh"]
CMD []
