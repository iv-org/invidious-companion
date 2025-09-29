# syntax=docker/dockerfile:1
# check=error=true

# Default values for versions
ARG THC_VERSION='0.39.0' \
    TINI_VERSION='0.19.0'

# Default values for variables that change less often
ARG DENO_DIR='/deno-dir' \
    GH_BASE_URL='https://github.com' \
    THC_PORT_NAME='PORT' \
    HOST='0.0.0.0' \
    PORT='8282'

# sha256 checksums for binaries
ARG THC_AMD64_SHA256='cb1797948015da46c222764a99ee30c06a6a9a30f5b87f212a28ea3c6d07610d' \
    THC_ARM64_SHA256='c177033fd474af673bd64788d47e13708844f3946e1eb51cce6a422a23a5e8cc' \
    TINI_AMD64_SHA256='93dcc18adc78c65a028a84799ecf8ad40c936fdfc5f2a57b1acda5a8117fa82c' \
    TINI_ARM64_SHA256='07952557df20bfd2a95f9bef198b445e006171969499a1d361bd9e6f8e5e0e81'

# we can use these aliases and let dependabot remain simple
# inspired by:
# https://github.com/dependabot/dependabot-core/issues/2057#issuecomment-1351660410
FROM alpine:3.22 AS dependabot-alpine
FROM debian:13-slim AS dependabot-debian

# Retrieve the deno binary from the repository
FROM denoland/deno:bin-2.5.2 AS deno-bin


# Stage for creating the non-privileged user
FROM dependabot-alpine AS user-stage

RUN adduser -u 10001 -S appuser

# Stage for downloading files using curl from Debian
FROM dependabot-debian AS debian-curl
RUN DEBIAN_FRONTEND='noninteractive' && export DEBIAN_FRONTEND && \
    apt-get update && apt-get install -y curl xz-utils

# Download tiny-health-checker from GitHub
FROM debian-curl AS thc-download
ARG GH_BASE_URL THC_VERSION THC_AMD64_SHA256 THC_ARM64_SHA256 CHECK_CHECKSUMS
RUN arch="$(uname -m)" && \
    gh_url() { printf -- "${GH_BASE_URL}/%s/releases/download/%s/%s\n" "$@" ; } && \
    URL="$(gh_url dmikusa/tiny-health-checker v${THC_VERSION} tiny-health-checker-${arch}-unknown-linux-musl.tar.xz)" && \
    curl -fsSL --output /tiny-health-checker-${arch}-unknown-linux-musl.tar.xz "${URL}" && \
    if [ "${CHECK_CHECKSUMS}" = "1" ] ; then \
        echo "Checking THC binary sha256 checksum" && \
        if [ "$arch" = "aarch64" ]; then \
            echo "${THC_ARM64_SHA256}  /tiny-health-checker-${arch}-unknown-linux-musl.tar.xz" | sha256sum -c; \
        else \
            echo "${THC_AMD64_SHA256}  /tiny-health-checker-${arch}-unknown-linux-musl.tar.xz" | sha256sum -c; \
        fi \
    fi && \
    tar -xvf /tiny-health-checker-${arch}-unknown-linux-musl.tar.xz && \
    mv /tiny-health-checker-${arch}-unknown-linux-musl/thc /thc && \
    chmod -v 00555 /thc

# Cache the thc binary as a layer
FROM scratch AS thc-bin
ARG THC_VERSION
ENV THC_VERSION="${THC_VERSION}"
COPY --from=thc-download /thc /thc

# Download tini from GitHub
FROM debian-curl AS tini-download
ARG GH_BASE_URL TINI_VERSION TINI_AMD64_SHA256 TINI_ARM64_SHA256 CHECK_CHECKSUMS
RUN arch="$(dpkg --print-architecture)" && \
    gh_url() { printf -- "${GH_BASE_URL}/%s/releases/download/%s/%s\n" "$@" ; } && \
    URL="$(gh_url krallin/tini v${TINI_VERSION} tini-${arch})" && \
    curl -fsSL --output /tini "${URL}" && \
    if [ "${CHECK_CHECKSUMS}" = "1" ] ; then \
        echo "Checking TINI binary sha256 checksum" && \
        if [ "$arch" = "arm64" ]; then \
            echo "${TINI_ARM64_SHA256}  /tini" | sha256sum -c; \
        else \
            echo "${TINI_AMD64_SHA256}  /tini" | sha256sum -c; \
        fi \
    fi && \
    chmod -v 00555 /tini

# Cache the tini binary as a layer
FROM scratch AS tini-bin
ARG TINI_VERSION
ENV TINI_VERSION="${TINI_VERSION}"
COPY --from=tini-download /tini /tini

# Stage for using git from Debian
FROM dependabot-debian AS debian-git
RUN DEBIAN_FRONTEND='noninteractive' && export DEBIAN_FRONTEND && \
    apt-get update && apt-get install -y git

# Stage for using deno on Debian
FROM debian-git AS debian-deno

# cache dir for youtube.js library
RUN mkdir -v -p /var/tmp/youtubei.js

ARG DENO_DIR
RUN useradd --uid 1993 --user-group deno \
  && mkdir -v "${DENO_DIR}" \
  && chown deno:deno "${DENO_DIR}"

ENV DENO_DIR="${DENO_DIR}" \
    DENO_INSTALL_ROOT='/usr/local'

COPY --from=deno-bin /deno /usr/bin/deno

# Create a builder using deno on Debian
FROM debian-deno AS builder

WORKDIR /app

COPY deno.lock ./
COPY deno.json ./

COPY ./src/ ./src/

# To let the `deno task compile` know the current commit on which
# Invidious companion is being built, similar to how Invidious does it.
# Dependencies are cached in ${DENO_DIR} for our deno builder
RUN --mount=type=bind,rw,source=.git,target=/app/.git \
    --mount=type=cache,target="${DENO_DIR}" \
    deno task compile

FROM gcr.io/distroless/cc AS app

# Copy group file for the non-privileged user from the user-stage
COPY --from=user-stage /etc/group /etc/group

# Copy passwd file for the non-privileged user from the user-stage
COPY --from=user-stage /etc/passwd /etc/passwd

COPY --from=thc-bin /thc /thc
COPY --from=tini-bin /tini /tini

# Copy cache directory and set correct permissions
COPY --from=builder --chown=appuser:nogroup /var/tmp/youtubei.js /var/tmp/youtubei.js

# Set the working directory
WORKDIR /app

COPY --from=builder /app/invidious_companion ./

ARG HOST PORT THC_VERSION THC_PORT_NAME TINI_VERSION
EXPOSE "${PORT}/tcp"

ENV SERVER_BASE_PATH=/companion \
    HOST="${HOST}" \
    PORT="${PORT}" \
    THC_PORT_NAME="${THC_PORT_NAME}" \
    THC_PATH="/healthz" \
    THC_VERSION="${THC_VERSION}" \
    TINI_VERSION="${TINI_VERSION}"

COPY ./config/ ./config/

# Switch to non-privileged user
USER appuser

ENTRYPOINT ["/tini", "--", "/app/invidious_companion"]

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=5 CMD ["/thc"]
