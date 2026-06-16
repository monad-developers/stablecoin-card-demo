# syntax=docker/dockerfile:1.7
#
# Monorepo image for Railway services. The same image can run Anvil or the
# frontend; each Railway service should override CMD with its own start command.

ARG BUN_VERSION=1.3.13
ARG FOUNDRY_VERSION=v1.5.0-monad.0.3.0

FROM debian:bookworm-slim AS foundry
ARG FOUNDRY_VERSION
ARG TARGETARCH=amd64

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ENV FOUNDRY_DIR=/root/.foundry
ENV PATH=${FOUNDRY_DIR}/bin:${PATH}

RUN case "${TARGETARCH}" in \
        amd64) foundry_sha256=7f1221c9c80cac25895ec9a58d4d01e644044a5d32432cfe22ac14d4be8ba307 ;; \
        arm64) foundry_sha256=e552557d09f7a9f97f3f6be32a904df982a693e7fcd2a26b63710ed671cefa83 ;; \
        *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && mkdir -p "${FOUNDRY_DIR}/bin" \
    && curl -fL "https://github.com/category-labs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_${TARGETARCH}.tar.gz" -o /tmp/foundry.tar.gz \
    && printf '%s  /tmp/foundry.tar.gz\n' "${foundry_sha256}" | sha256sum -c - \
    && tar -xzf /tmp/foundry.tar.gz -C "${FOUNDRY_DIR}/bin" \
    && rm /tmp/foundry.tar.gz \
    && forge --version \
    && anvil --version \
    && cast --version

FROM oven/bun:${BUN_VERSION}-debian AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=foundry /root/.foundry/bin/forge /usr/local/bin/forge
COPY --from=foundry /root/.foundry/bin/cast  /usr/local/bin/cast
COPY --from=foundry /root/.foundry/bin/anvil /usr/local/bin/anvil
COPY --from=foundry /root/.foundry/bin/chisel /usr/local/bin/chisel

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:${BUN_VERSION}-debian AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        libssl3 \
        tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=foundry /root/.foundry/bin/forge /usr/local/bin/forge
COPY --from=foundry /root/.foundry/bin/cast  /usr/local/bin/cast
COPY --from=foundry /root/.foundry/bin/anvil /usr/local/bin/anvil
COPY --from=foundry /root/.foundry/bin/chisel /usr/local/bin/chisel

WORKDIR /app

COPY --from=build /app /app

ENV NODE_ENV=production \
    PATH=/usr/local/bin:${PATH}

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["bun", "--version"]
