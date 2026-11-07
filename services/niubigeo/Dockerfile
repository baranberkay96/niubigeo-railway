# NiubiGEO for Railway: the official NiubiGEO image, unmodified, plus a small supervisor
# (railway-supervisor.mjs) that runs the workbench server and the scheduling worker in one
# container. Upstream runs them as two containers sharing one data directory; a Railway
# volume belongs to exactly one service, so both processes live here.
#
# NIUBIGEO_IMAGE is also a Railway service variable (passed in as a build argument), so an
# upgrade is one variable change. Pin a tag with its index digest.
# v0.3.3 = commit 6f0eeeb11b4319e845b491a5067d2cfdc8d07b52, published 2026-11-03.
ARG NIUBIGEO_IMAGE=ghcr.io/albert-weasker/niubigeo:v0.3.3@sha256:5950b779edc0de9c3e869cdbbb6166a8053e0e7c209f7d00a8ca680d43c5841f
FROM ${NIUBIGEO_IMAGE}

# /usr/local/bin already exists in the image, so --chmod only applies to the file.
COPY --chmod=0755 railway-supervisor.mjs /usr/local/bin/niubigeo-railway-supervisor.mjs

# Fail the build early if the image no longer has what the supervisor relies on:
# the server and worker entry points, package.json's version and a working tar.
RUN node --check /usr/local/bin/niubigeo-railway-supervisor.mjs \
 && node /usr/local/bin/niubigeo-railway-supervisor.mjs --self-test

# Defaults; the Railway service variables set the same values.
ENV HOST=:: \
    PORT=8787 \
    MONITORING_DATA_DIR=/app/data \
    PRODUCT_DATA_DIR=/app/data/product-v2

WORKDIR /app
EXPOSE 8787

# No VOLUME instruction: Railway attaches the volume at /app/data (template.json).
ENTRYPOINT ["node", "/usr/local/bin/niubigeo-railway-supervisor.mjs"]
CMD []
