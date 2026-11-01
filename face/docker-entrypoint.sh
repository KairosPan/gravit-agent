#!/bin/sh
# The agent box's entrypoint (face/Dockerfile): Linux node_modules into the two module volumes
# when they are empty (the first up needs the network), the profile into $DSH_HOME when it has
# none, then the command. Runs from <repo>/face (compose.yml's working_dir).
set -e
for dir in ../face ../account; do
  [ -f "$dir/node_modules/.package-lock.json" ] || (cd "$dir" && npm ci)
done
[ -d "$DSH_HOME/profiles/face" ] || npm run setup
exec "$@"
