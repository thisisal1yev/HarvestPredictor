#!/usr/bin/env bash
# Initialize MinIO: create bucket, service account, lifecycle rule.
# Requires env vars: MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
# Assumes `mc` (MinIO client) is available in PATH or use the minio/mc image.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY_FILE="${SCRIPT_DIR}/rw-detections-only.json"

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY is required}"

# MinIO svcacct constraints: access key 3-20 chars, secret key 8-40 chars
if [ ${#MINIO_ACCESS_KEY} -lt 3 ] || [ ${#MINIO_ACCESS_KEY} -gt 20 ]; then
  echo "ERROR: MINIO_ACCESS_KEY must be 3-20 chars (current: ${#MINIO_ACCESS_KEY})" >&2
  exit 1
fi
if [ ${#MINIO_SECRET_KEY} -lt 8 ] || [ ${#MINIO_SECRET_KEY} -gt 40 ]; then
  echo "ERROR: MINIO_SECRET_KEY must be 8-40 chars (current: ${#MINIO_SECRET_KEY})" >&2
  exit 1
fi

MINIO_URL="${MINIO_URL:-http://minio:9000}"
BUCKET="${MINIO_BUCKET:-harvest-snapshots}"

echo "==> Setting mc alias 'local' → ${MINIO_URL}"
mc alias set local "${MINIO_URL}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"

echo "==> Creating bucket '${BUCKET}' (idempotent)"
mc mb --ignore-existing "local/${BUCKET}"

echo "==> Setting anonymous access to none"
mc anonymous set none "local/${BUCKET}"

echo "==> Creating service account scoped to detections/* prefix"
mc admin user svcacct add local "${MINIO_ROOT_USER}" \
  --access-key "${MINIO_ACCESS_KEY}" \
  --secret-key "${MINIO_SECRET_KEY}" \
  --policy "${POLICY_FILE}"

echo "==> Applying lifecycle rule: auto-expire objects after 90 days"
mc ilm rule add --expire-days 90 "local/${BUCKET}"

echo "==> MinIO initialization complete."
