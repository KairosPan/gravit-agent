#!/bin/sh
# The agent box's entrypoint (face/Dockerfile): Linux node_modules into the two module volumes
# when they are empty (the first up needs the network), the profile into $DSH_HOME when it has
# none, then the command. Runs from <repo>/face (compose.yml's working_dir).
set -e
for dir in ../face ../account; do
  [ -f "$dir/node_modules/.package-lock.json" ] || (cd "$dir" && npm ci)
done
[ -d "$DSH_HOME/profiles/face" ] || npm run setup
# rc.5's webserver refuses every wildcard bind at load (@deepseek-ai/dsh-host-webserver), so the box
# binds the container's own address, which serves the box's network; the host still reaches the face
# at 127.0.0.1:3090 through compose's publish. A FACE_BIND already set (docker run -e) wins.
: "${FACE_BIND:=$(hostname -i | awk '{print $1}')}"; export FACE_BIND
exec "$@"
