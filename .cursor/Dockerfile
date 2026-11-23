FROM ubuntu:24.04

# OS packages and Chrome for the verify journeys. Foundry VTT itself is not
# installed here: the download needs Runtime Secrets, and a signed licence is
# bound to the machine, so scripts/foundry-verify-server.sh does that on demand.

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-liberation \
        git \
        gnupg \
        iproute2 \
        python3 \
        unzip \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION=24.22.3
ARG NODE_SHA256=4f2b175a6d53a5c617a80dba2676238a0688cef28c6da4eba35c7d844e66fcfb
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o /tmp/node.tar.xz \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
    && rm /tmp/node.tar.xz \
    && npm install --global pnpm@11.19.0

RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /usr/share/keyrings/google-linux.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sfn /usr/bin/google-chrome-stable /usr/bin/google-chrome

USER ubuntu
