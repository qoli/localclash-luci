#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
	printf 'usage: scripts/build-dnsqualify-assets.sh <release-tag>\n' >&2
	exit 2
fi

tag="$1"
case "$tag" in
	v[0-9]*.[0-9]*.[0-9]*-[0-9]*) ;;
	*)
		printf 'dnsqualify release tag must match v<version>-<release>: %s\n' "$tag" >&2
		exit 2
		;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${repo_root}/.build/dnsqualify-source"
dist_dir="${repo_root}/dist"
release_base="https://github.com/qoli/localclash-luci/releases/download/${tag}"

source_metadata="$(python3 "${repo_root}/scripts/prepare-dnsqualify-source.py" --verify-only)"
source_repository="$(printf '%s' "$source_metadata" | python3 -c 'import json, sys; print(json.load(sys.stdin)["repository"])')"
source_commit="$(printf '%s' "$source_metadata" | python3 -c 'import json, sys; print(json.load(sys.stdin)["commit"])')"

mkdir -p "$dist_dir"

for arch in amd64 arm64; do
	name="dnsqualify-linux-${arch}"
	(
		cd "$source_dir"
		CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build \
			-trimpath \
			-ldflags "-s -w -X main.version=${tag}" \
			-o "${dist_dir}/${name}" .
	)
	(
		cd "$dist_dir"
		shasum -a 256 "$name" > "$name.sha256"
	)
done

amd64_sha="$(awk '{print $1; exit}' "${dist_dir}/dnsqualify-linux-amd64.sha256")"
arm64_sha="$(awk '{print $1; exit}' "${dist_dir}/dnsqualify-linux-arm64.sha256")"

{
	printf '{\n'
	printf '  "schema_version": 1,\n'
	printf '  "version": "%s",\n' "$tag"
	printf '  "source": {\n'
	printf '    "repository": "%s",\n' "$source_repository"
	printf '    "commit": "%s"\n' "$source_commit"
	printf '  },\n'
	printf '  "assets": [\n'
	printf '    {\n'
	printf '      "os": "linux",\n'
	printf '      "arch": "amd64",\n'
	printf '      "url": "%s/dnsqualify-linux-amd64",\n' "$release_base"
	printf '      "sha256": "%s"\n' "$amd64_sha"
	printf '    },\n'
	printf '    {\n'
	printf '      "os": "linux",\n'
	printf '      "arch": "arm64",\n'
	printf '      "url": "%s/dnsqualify-linux-arm64",\n' "$release_base"
	printf '      "sha256": "%s"\n' "$arm64_sha"
	printf '    }\n'
	printf '  ]\n'
	printf '}\n'
} > "${dist_dir}/dnsqualify-release-manifest.json"

printf 'Built dnsqualify release assets for %s\n' "$tag"
