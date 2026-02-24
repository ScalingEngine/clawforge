#!/bin/bash
# tests/validate-output.sh — assert GSD invocations present in output
# Usage: bash tests/validate-output.sh [output_dir]
# Exit: 0=PASS, 1=FAIL
set -e

OUTPUT_DIR="${1:-$(dirname "${BASH_SOURCE[0]}")/output}"
JSONL_FILE="${OUTPUT_DIR}/gsd-invocations.jsonl"

echo "=== Validate GSD Invocations ==="
echo "Output dir: ${OUTPUT_DIR}"
echo ""

# gsd-invocations.jsonl must exist
if [ ! -f "${JSONL_FILE}" ]; then
    echo "FAIL: gsd-invocations.jsonl not found at ${JSONL_FILE}"
    exit 1
fi

# Count non-empty lines (each line is one JSONL record)
RECORD_COUNT=$(grep -c . "${JSONL_FILE}" 2>/dev/null || echo 0)

if [ "${RECORD_COUNT}" -eq 0 ]; then
    echo "FAIL: gsd-invocations.jsonl is empty — GSD Skill tool was NOT invoked"
    echo ""
    echo "--- observability.md ---"
    cat "${OUTPUT_DIR}/observability.md" 2>/dev/null || echo "(no observability.md)"
    echo ""
    echo "--- claude-output.json (tail) ---"
    tail -20 "${OUTPUT_DIR}/claude-output.json" 2>/dev/null || echo "(no claude-output.json)"
    exit 1
fi

echo "PASS: ${RECORD_COUNT} GSD invocation(s) found"
echo ""
# Show what was called
jq -r '"  Skill(\(.skill)) at \(.ts)"' "${JSONL_FILE}" 2>/dev/null || cat "${JSONL_FILE}"
exit 0
