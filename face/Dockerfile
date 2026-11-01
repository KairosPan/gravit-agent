# The agent box: the face, dsh, Gravit's shell and the Account seat (compose.yml at the repo root).
# It runs no data source: the market data is the Account box's (account/Dockerfile).
# The tree is bind-mounted, not copied, and nothing of the face is installed at build: the
# entrypoint runs npm ci into the module volumes on the first up.
FROM node:22-bookworm

COPY docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
