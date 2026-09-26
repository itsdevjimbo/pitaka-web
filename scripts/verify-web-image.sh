#!/usr/bin/env bash

set -euo pipefail

image_ref="${1:?Usage: scripts/verify-web-image.sh <image-reference> <source-revision> <bundle-sha256>}"
source_revision="${2:?Usage: scripts/verify-web-image.sh <image-reference> <source-revision> <bundle-sha256>}"
bundle_sha256="${3:?Usage: scripts/verify-web-image.sh <image-reference> <source-revision> <bundle-sha256>}"
network_name="pitaka-web-smoke-${GITHUB_RUN_ID:-local}-$$"
api_name="${network_name}-api"
web_name="${network_name}-web"
api_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/container-smoke-api.mjs"
temporary_directory="$(mktemp -d)"

cleanup() {
  docker rm --force "$web_name" "$api_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}

trap cleanup EXIT

docker buildx imagetools inspect --raw "$image_ref" \
  | jq -e '
      [.manifests[].platform | select(.os == "linux" and (.architecture == "amd64" or .architecture == "arm64"))]
      | map(.architecture) | unique | sort == ["amd64", "arm64"]
    ' >/dev/null

for architecture in amd64 arm64; do
  docker pull --platform "linux/${architecture}" "$image_ref" >/dev/null
  actual_platform="$(docker image inspect "$image_ref" --format '{{.Os}}/{{.Architecture}}')"
  if [ "$actual_platform" != "linux/${architecture}" ]; then
    echo "Expected linux/${architecture}, pulled ${actual_platform}." >&2
    exit 1
  fi
  actual_revision="$(docker image inspect "$image_ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  actual_bundle_sha="$(docker image inspect "$image_ref" --format '{{ index .Config.Labels "org.pitaka.web.archive.sha256" }}')"
  if [ "$actual_revision" != "$source_revision" ]; then
    echo "The linux/${architecture} image has source revision ${actual_revision}, expected ${source_revision}." >&2
    exit 1
  fi
  if [ "$actual_bundle_sha" != "$bundle_sha256" ]; then
    echo "The linux/${architecture} image has web bundle checksum ${actual_bundle_sha}, expected ${bundle_sha256}." >&2
    exit 1
  fi
done

docker pull --platform linux/amd64 "$image_ref" >/dev/null
docker network create "$network_name" >/dev/null
docker run --detach --name "$api_name" --network "$network_name" --network-alias api \
  --volume "$api_script:/probe-api.mjs:ro" \
  --entrypoint node node:24-bookworm-slim /probe-api.mjs >/dev/null
docker run --detach --name "$web_name" --network "$network_name" \
  --publish 127.0.0.1::8080 \
  --env API_UPSTREAM=http://api:8080 \
  "$image_ref" >/dev/null

host_port="$(docker port "$web_name" 8080/tcp | sed 's/.*://')"
base_url="http://127.0.0.1:${host_port}"

for attempt in $(seq 1 30); do
  if curl --fail --silent "$base_url/" --output "$temporary_directory/index.html"; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    docker logs "$web_name"
    exit 1
  fi
  sleep 2
done

grep --ignore-case --quiet '<app-root' "$temporary_directory/index.html"
curl --fail --silent "$base_url/app/accounts" --output "$temporary_directory/route.html"
grep --ignore-case --quiet '<app-root' "$temporary_directory/route.html"

if docker exec "$web_name" sh -c "grep -rq 'api.pitaka.example' /usr/share/nginx/html"; then
  echo 'The production image still contains the placeholder API hostname.' >&2
  exit 1
fi

forwarded_request="$(curl --fail --silent --show-error "$base_url/api/image-smoke?source=web")"
if [ "$forwarded_request" != 'GET /api/image-smoke?source=web' ]; then
  echo "The API proxy changed the request path: $forwarded_request" >&2
  exit 1
fi

failure_status="$(curl --silent --show-error --output "$temporary_directory/api-error.txt" \
  --write-out '%{http_code}' "$base_url/api/image-smoke-failure")"
if [ "$failure_status" != '503' ] || [ "$(cat "$temporary_directory/api-error.txt")" != 'controlled upstream failure' ]; then
  echo 'An upstream API failure was not returned unchanged.' >&2
  exit 1
fi

echo "Verified $image_ref: linux/amd64 and linux/arm64 manifests, source and bundle labels, SPA refresh, relative API requests, path forwarding, and upstream error status."
