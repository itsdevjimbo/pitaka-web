#!/usr/bin/env bash

set -euo pipefail

image_ref="${1:?Usage: scripts/docker-hub-manifest-status.sh <namespace/repository:tag>}"
repository="${image_ref%:*}"
tag="${image_ref##*:}"

if [ "$repository" != 'jimbodev0530/pitaka-web' ] || [ "$tag" = "$image_ref" ]; then
  echo "Expected a tag from jimbodev0530/pitaka-web, received: $image_ref" >&2
  exit 2
fi

token="$(curl --fail --silent --show-error \
  "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull" \
  | jq --exit-status --raw-output '.token // .access_token')"
status="$(curl --head --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --header "Authorization: Bearer ${token}" \
  --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
  "https://registry-1.docker.io/v2/${repository}/manifests/${tag}")"

case "$status" in
  200)
    echo present
    ;;
  404)
    echo missing
    ;;
  *)
    echo "Docker Hub manifest lookup failed for $image_ref with HTTP $status." >&2
    exit 1
    ;;
esac
