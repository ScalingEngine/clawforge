#!/bin/bash
# tests/test-job.sh — local Docker test for ClawForge GSD chain
# Usage: ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"

echo "=== ClawForge GSD Test Harness ==="
echo "Docker image: clawforge-job-test"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Check ANTHROPIC_API_KEY is set
if [ -z "${ANTHROPIC_API_KEY}" ]; then
    echo "ERROR: ANTHROPIC_API_KEY must be set"
    echo "Usage: ANTHROPIC_API_KEY=sk-... bash tests/test-job.sh"
    exit 1
fi

# [1/4] Build Docker image from docker/job/
echo "[1/4] Building Docker image from docker/job/..."
docker build -t clawforge-job-test "${REPO_ROOT}/docker/job" --quiet
echo "      Built: clawforge-job-test"

# [2/4] Clean and prepare output directory
echo "[2/4] Preparing output directory..."
rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

# [3/4] Run test container with bind mounts
# Mounts:
#   /fixtures  <- tests/fixtures/ (fixture files for the test job)
#   /test-entrypoint.sh <- tests/test-entrypoint.sh (bypass entrypoint, no git ops)
#   /output    -> tests/output/ (written by hook and entrypoint; read by validate-output.sh)
echo "[3/4] Running test container..."
docker run --rm \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
    -e TEST_JOB_ID="test-$(date +%s)" \
    -v "${SCRIPT_DIR}/fixtures:/fixtures:ro" \
    -v "${SCRIPT_DIR}/test-entrypoint.sh:/test-entrypoint.sh:ro" \
    -v "${OUTPUT_DIR}:/output:rw" \
    --entrypoint /bin/bash \
    clawforge-job-test \
    /test-entrypoint.sh

# [4/4] Validate output
echo "[4/4] Validating output..."
bash "${SCRIPT_DIR}/validate-output.sh" "${OUTPUT_DIR}"

echo ""
echo "PASS — GSD chain verified"
echo ""
echo "Artifacts:"
ls -la "${OUTPUT_DIR}/"
