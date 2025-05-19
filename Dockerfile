FROM denoland/deno:debian-2.3.3 AS builder

ARG TINI_VERSION=0.19.0

WORKDIR /app

# cache dir for youtube.js library
RUN mkdir -p /var/tmp/youtubei.js

RUN apt update && apt install -y curl

RUN curl -fsSL https://github.com/krallin/tini/releases/download/v${TINI_VERSION}/tini-$(dpkg --print-architecture) \
        --output /tini \
    && chmod +x /tini

RUN arch=$(uname -m) && \
    curl -fsSL https://github.com/dmikusa/tiny-health-checker/releases/download/v0.36.0/thc-${arch}-unknown-linux-musl \
    --output /thc \
    && chmod +x /thc

COPY deno.json /app/
COPY deno.lock /app/

COPY ./src/ /app/src/

# Dependencies are cached on /deno-dir for the denoland/deno:debian image
RUN --mount=type=cache,target=/deno-dir deno task compile

# Stage for creating the non-privileged user
FROM alpine:3.21 AS user-stage

RUN adduser -u 10001 -S appuser

FROM gcr.io/distroless/cc

COPY --from=builder /app/invidious_companion /app/
COPY --from=builder /thc /thc
COPY ./config/ /app/config/
COPY --from=builder /tini /tini

ENV PORT=8282 \
    HOST=0.0.0.0

ENV THC_PORT=${PORT} \
    THC_PATH=/healthz

# Copy passwd file for the non-privileged user from the user-stage
COPY --from=user-stage /etc/passwd /etc/passwd

# Copy cache directory and set correct permissions
COPY --from=builder --chown=appuser /var/tmp/youtubei.js /var/tmp/youtubei.js

# Set the working directory
WORKDIR /app

# Switch to non-privileged user
USER appuser

ENTRYPOINT ["/tini", "--", "/app/invidious_companion"]

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=5 CMD ["/thc"]
