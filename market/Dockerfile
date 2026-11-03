# The market box: the market service, no volume, no wallet (compose.yml at the repo root).
FROM node:22-bookworm-slim

# bookworm-slim has no curl (uv's installer needs it) and no git (the sidecar installs from a
# git source).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# uv, from its official standalone installer, then AKShare's MCP server, the Account's sidecar,
# its executable at /usr/local/bin/akshare-mcp. Before the source copy: the layer survives a
# source change.
# MARKET_AKSHARE_BIN, last, is not uv's: it is the runtime path the Account reads (akshareCommand) to find the sidecar.
ENV UV_INSTALL_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv-tools \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    MARKET_AKSHARE_BIN=/usr/local/bin/akshare-mcp
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh \
 && uv tool install --python 3.12 --with 'mcp<2' \
  'git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0'

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 4821
