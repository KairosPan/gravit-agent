# The agent box: the face, dsh, Gravit's shell and the Account seat (compose.yml at the repo root).
# The tree is bind-mounted, not copied, and nothing of the face is installed at build: the
# entrypoint runs npm ci into the module volumes on the first up.
FROM node:22-bookworm

# uv, from its official standalone installer, then AKShare's MCP server (face/README.md,
# "AKShare MCP"), its executable at /usr/local/bin/akshare-mcp.
ENV UV_INSTALL_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv-tools \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh \
 && uv tool install --python 3.12 --with 'mcp<2' \
  'git+https://github.com/xiaozhozho/akshare-mcp.git@9b6a22b6d83cce2a996a5072743bb06686040ce0'

COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
