#!/usr/bin/env bash
# ==============================================================================
# Linkx Frontend — Release Manager Test Harness & Invariant Verification Suite
# ==============================================================================
# Canonical Reference: doc/LINKX_RELEASE_ARCHITECTURE_HANDOFF.md
#
# Design Invariants:
# 1. Operates strictly within an isolated test fixture root.
# 2. Captures pre-test production fingerprint and asserts 100% zero mutations.
# 3. Validates Linux openat2(RESOLVE_BENEATH) descriptor containment.
# 4. Validates crash recovery state machine per Tables 5A, 5B, and 5C.
# 5. Preserves all test artifacts on disk for forensics (zero implicit rm -rf).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$SCRIPT_DIR"
RELEASE_MGR="$WORKSPACE_ROOT/release_manager.sh"
CONTAINMENT_HELPER="$WORKSPACE_ROOT/containment_fs.py"

DEFAULT_FIXTURE_ROOT="/var/www/linkx-releases/.test_fixture"

TESTS_PASSED=0
TESTS_FAILED=0

# Log helpers
tlog() {
    printf "[TEST] %s: %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

tpass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    printf "\033[0;32m  [PASS] %s\033[0m\n" "$*"
}

tfail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf "\033[0;31m  [FAIL] %s\033[0m\n" "$*"
}

assert_eq() {
    local expected="$1"
    local actual="$2"
    local msg="$3"
    if [[ "$expected" == "$actual" ]]; then
        tpass "$msg"
    else
        tfail "$msg (Expected: '$expected', Actual: '$actual')"
    fi
}

assert_exists() {
    local path="$1"
    local msg="$2"
    if [[ -e "$path" ]]; then
        tpass "$msg"
    else
        tfail "$msg (Path missing: $path)"
    fi
}

assert_not_exists() {
    local path="$1"
    local msg="$2"
    if [[ ! -e "$path" ]]; then
        tpass "$msg"
    else
        tfail "$msg (Path unexpectedly exists: $path)"
    fi
}

# ------------------------------------------------------------------------------
# Production Fingerprint Capture & Verification
# ------------------------------------------------------------------------------
capture_production_fingerprint() {
    local out_file="$1"
    local targets=(
        "/var/www/linkx-frontend"
        "/var/www/linkx-frontend/linkxCDR2026"
        "/var/www/linkx-frontend/linkxDS2026"
        "/var/www/linkx-frontend/.env"
        "/var/www/linkx-frontend/deploy_pkg_172.21.13.73"
        "/etc/nginx/sites-available/linkx-frontend"
    )

    > "$out_file"
    for t in "${targets[@]}"; do
        if [[ -e "$t" ]]; then
            stat -c "%n|dev=%d|ino=%i|mode=%a|uid=%u|gid=%g|size=%s|mtime=%Y" "$t" >> "$out_file"
        fi
    done
}

assert_production_unmutated() {
    local pre_file="$1"
    local post_file="$2"
    tlog "Asserting zero production mutations across protected server paths..."

    if diff -u "$pre_file" "$post_file"; then
        tpass "Zero production mutations: All production inodes, permissions, and timestamps 100% identical."
    else
        tfail "CRITICAL: Production server paths were mutated during test execution!"
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Test Suite 1: ContainmentFS Descriptor Isolation
# ------------------------------------------------------------------------------
suite_containment_fs() {
    local fixture_root="$1"
    tlog "Running Test Suite 1: ContainmentFS Syscall & Path Traversal Rejection..."

    # Test 1.1: Capability Probe
    if python3 "$CONTAINMENT_HELPER" probe "$fixture_root"; then
        tpass "openat2(RESOLVE_BENEATH) capability probe succeeded on fixture descriptor."
    else
        tfail "Capability probe failed unexpectedly."
    fi

    # Test 1.2: Relative Directory Creation
    python3 "$CONTAINMENT_HELPER" mkdir "$fixture_root" "test_dir"
    assert_exists "$fixture_root/test_dir" "mkdir created directory beneath descriptor."

    # Test 1.3: Atomic File Write and fsync
    printf "CONTAINMENT_TEST_DATA" | python3 "$CONTAINMENT_HELPER" write-atomic "$fixture_root/test_dir" "$fixture_root/test_dir" "test_file.txt"
    assert_exists "$fixture_root/test_dir/test_file.txt" "write-atomic staged and committed file."

    # Test 1.4: Atomic Symlink Creation & Swap
    python3 "$CONTAINMENT_HELPER" symlink-atomic "$fixture_root/test_dir" "test_file.txt" "active_link" "active_link.tmp"
    assert_exists "$fixture_root/test_dir/active_link" "symlink-atomic created relative pointer."
    local link_target
    link_target=$(python3 "$CONTAINMENT_HELPER" readlink "$fixture_root/test_dir" "active_link")
    assert_eq "test_file.txt" "$link_target" "readlink matches relative target string."

    # Test 1.5: Path Traversal Rejection ('..')
    local code=0
    python3 "$CONTAINMENT_HELPER" mkdir "$fixture_root/test_dir" "../escaped_dir" 2>/dev/null || code=$?
    assert_eq "99" "$code" "Path traversal ('..') correctly rejected with exit code 99."

    # Test 1.6: Absolute Path Rejection
    code=0
    python3 "$CONTAINMENT_HELPER" mkdir "$fixture_root/test_dir" "/var/tmp/escaped" 2>/dev/null || code=$?
    assert_eq "99" "$code" "Absolute path correctly rejected with exit code 99."

    # Test 1.7: Descriptor-Relative Recursive Deletion of Nested Hierarchy
    python3 "$CONTAINMENT_HELPER" mkdir "$fixture_root/test_dir" "nest_l1"
    python3 "$CONTAINMENT_HELPER" mkdir "$fixture_root/test_dir/nest_l1" "nest_l2"
    printf "SUB_DATA" | python3 "$CONTAINMENT_HELPER" write-atomic "$fixture_root/test_dir/nest_l1/nest_l2" "$fixture_root/test_dir/nest_l1/nest_l2" "deep_file.txt"
    python3 "$CONTAINMENT_HELPER" rmtree "$fixture_root/test_dir" "nest_l1"
    assert_not_exists "$fixture_root/test_dir/nest_l1" "rmtree deleted multi-level nested directory strictly beneath descriptor."

    # Test 1.8: Symlink Inside Target Directory Pointing Outside Fixture
    local external_target="/tmp/linkx_test_ext_target_$$.txt"
    echo "EXTERNAL_DATA_UNMUTATED" > "$external_target"
    python3 "$CONTAINMENT_HELPER" mkdir "$fixture_root/test_dir" "dir_with_ext_link"
    ln -s "$external_target" "$fixture_root/test_dir/dir_with_ext_link/ext_link"
    python3 "$CONTAINMENT_HELPER" rmtree "$fixture_root/test_dir" "dir_with_ext_link"
    assert_not_exists "$fixture_root/test_dir/dir_with_ext_link" "Directory containing external symlink deleted."
    assert_exists "$external_target" "External target file pointed to by symlink preserved intact."
    local ext_content
    ext_content=$(cat "$external_target")
    assert_eq "EXTERNAL_DATA_UNMUTATED" "$ext_content" "External target file content unmutated."
    rm -f "$external_target"

    # Test 1.9: Rejection of 'current', 'previous', and '..' Deletion Attempts
    code=0
    python3 "$CONTAINMENT_HELPER" rmtree "$fixture_root/test_dir" "current" 2>/dev/null || code=$?
    assert_eq "99" "$code" "Refusal to rmtree 'current' halted with exit code 99."

    code=0
    python3 "$CONTAINMENT_HELPER" rmtree "$fixture_root/test_dir" "previous" 2>/dev/null || code=$?
    assert_eq "99" "$code" "Refusal to rmtree 'previous' halted with exit code 99."

    code=0
    python3 "$CONTAINMENT_HELPER" rmtree "$fixture_root/test_dir" ".." 2>/dev/null || code=$?
    assert_eq "99" "$code" "Refusal to rmtree '..' halted with exit code 99."
}

# ------------------------------------------------------------------------------
# Test Suite 2: Multi-Profile Release Assembly & Promotion
# ------------------------------------------------------------------------------
suite_release_assembly() {
    local fixture_root="$1"
    tlog "Running Test Suite 2: Release Staging, Asset Seeding & Promotion..."

    # Setup mock workspace inputs
    local profile="nbe"
    local profile_dir="$fixture_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    mkdir -p "$profile_dir" "$releases_dir" "$tmp_dir" "$fixture_root/live"

    # Simulate Mock Release 1
    local rel1_id="release_20261024_100000_mock01"
    local rel1_dir="$releases_dir/$rel1_id"
    mkdir -p "$rel1_dir/assets"
    echo "<html><script src='assets/index-mock01.js'></script><link rel='stylesheet' href='assets/index-mock01.css'></html>" > "$rel1_dir/index.html"
    echo "/* JS */" > "$rel1_dir/assets/index-mock01.js"
    echo "/* CSS */" > "$rel1_dir/assets/index-mock01.css"
    echo '{"release_id":"'$rel1_id'","status":"verified"}' > "$rel1_dir/release_manifest.json"

    # Set up initial pointer
    ln -s "releases/$rel1_id" "$profile_dir/current"
    ln -s "$profile_dir/current" "$fixture_root/live/linkxDS2026"

    assert_exists "$profile_dir/current" "Initial current pointer established."
    assert_exists "$fixture_root/live/linkxDS2026" "Stable live symlink established."

    # Deploy Mock Release 2
    local rel2_id="release_20261024_110000_mock02"
    local rel2_dir="$releases_dir/$rel2_id"
    mkdir -p "$rel2_dir/assets"
    echo "<html><script src='assets/index-mock02.js'></script><link rel='stylesheet' href='assets/index-mock02.css'></html>" > "$rel2_dir/index.html"
    echo "/* JS 2 */" > "$rel2_dir/assets/index-mock02.js"
    echo "/* CSS 2 */" > "$rel2_dir/assets/index-mock02.css"
    echo '{"release_id":"'$rel2_id'","status":"verified"}' > "$rel2_dir/release_manifest.json"

    # Simulate cutover using release_manager functions
    python3 "$CONTAINMENT_HELPER" symlink-atomic "$profile_dir" "releases/$rel1_id" "previous" "previous.tmp.test"
    python3 "$CONTAINMENT_HELPER" symlink-atomic "$profile_dir" "releases/$rel2_id" "current" "current.tmp.test"

    local cur_target
    cur_target=$(python3 "$CONTAINMENT_HELPER" readlink "$profile_dir" "current")
    local prev_target
    prev_target=$(python3 "$CONTAINMENT_HELPER" readlink "$profile_dir" "previous")

    assert_eq "releases/$rel2_id" "$cur_target" "Current pointer promoted to Release 2."
    assert_eq "releases/$rel1_id" "$prev_target" "Previous pointer points to Release 1."
}

# ------------------------------------------------------------------------------
# Test Suite 3: Crash Recovery State Machine (Tables 5A, 5B, 5C)
# ------------------------------------------------------------------------------
suite_crash_recovery() {
    local fixture_root="$1"
    tlog "Running Test Suite 3: Crash Recovery Invariants & State Machine..."

    local profile="cdr"
    local profile_dir="$fixture_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    mkdir -p "$profile_dir" "$releases_dir" "$tmp_dir"

    # Case 3.1: Staging Build Interrupted (Table 5A)
    local tx_id="tx_crash_staging_001"
    local target_id="release_crash_001"
    mkdir -p "$releases_dir/${target_id}.staging"
    echo "partial_file" > "$releases_dir/${target_id}.staging/partial.txt"

    local state_json
    state_json=$(printf '{"action":"deploy","transaction_id":"%s","phase":"STAGING","profile":"%s","target_release_id":"%s","old_active_id":"none"}' \
        "$tx_id" "$profile" "$target_id")
    printf "%s" "$state_json" | python3 "$CONTAINMENT_HELPER" write-atomic "$profile_dir" "$tmp_dir" ".transaction.json"

    # Execute reconcile command
    bash "$RELEASE_MGR" reconcile "$profile" --fixture-root "$fixture_root"

    assert_exists "$releases_dir/${target_id}.staging_interrupted" "Interrupted staging directory preserved with marker."
    assert_exists "$profile_dir/.transaction.failed.${tx_id}.json" "Failed transaction state durably archived (Table 5C)."
    assert_not_exists "$profile_dir/.transaction.json" "Active transaction unlinked following archival."

    # Case 3.2: Ambiguous Artifacts Detection (Exit 98)
    local tx_ambig="tx_ambig_002"
    mkdir -p "$releases_dir/rel_good" "$releases_dir/rel_conflicting"
    ln -s "releases/rel_foreign" "$profile_dir/current.tmp.foreign"

    state_json=$(printf '{"action":"deploy","transaction_id":"%s","phase":"UPDATING_CURRENT","profile":"%s","target_release_id":"rel_good","old_active_id":"rel_good"}' \
        "$tx_ambig" "$profile")
    printf "%s" "$state_json" | python3 "$CONTAINMENT_HELPER" write-atomic "$profile_dir" "$tmp_dir" ".transaction.json"

    local code=0
    bash "$RELEASE_MGR" reconcile "$profile" --fixture-root "$fixture_root" 2>/dev/null || code=$?
    assert_eq "98" "$code" "Ambiguous artifacts halted execution with exit code 98."
    assert_exists "$profile_dir/.transaction.conflict.${tx_ambig}.json" "Companion conflict diagnostic file generated."
    assert_exists "$profile_dir/.transaction.json" "Primary .transaction.json preserved in place (not unlinked)."

    # Clean up test artifact from fixture
    rm -f "$profile_dir/current.tmp.foreign" "$profile_dir/.transaction.json" "$profile_dir/.transaction.conflict.${tx_ambig}.json"

    # Case 3.3: 0-Byte Corrupted State File (Exit 98)
    > "$profile_dir/.transaction.json"
    code=0
    bash "$RELEASE_MGR" reconcile "$profile" --fixture-root "$fixture_root" 2>/dev/null || code=$?
    assert_eq "98" "$code" "Zero-byte corrupted state file halted execution with exit code 98."
    local size
    size=$(stat -c "%s" "$profile_dir/.transaction.json")
    assert_eq "0" "$size" "Corrupted state file preserved byte-for-byte untouched on disk."
    rm -f "$profile_dir/.transaction.json"
}

# ------------------------------------------------------------------------------
# Test Suite 4: Rollback & Quarantine Validation
# ------------------------------------------------------------------------------
suite_rollback_quarantine() {
    local fixture_root="$1"
    tlog "Running Test Suite 4: Deterministic Rollback & Quarantine..."

    local profile="nbe"
    local profile_dir="$fixture_root/$profile"
    local releases_dir="$profile_dir/releases"

    local cur_before
    cur_before=$(basename "$(python3 "$CONTAINMENT_HELPER" readlink "$profile_dir" "current")")
    local prev_before
    prev_before=$(basename "$(python3 "$CONTAINMENT_HELPER" readlink "$profile_dir" "previous")")

    # Execute rollback with quarantine
    bash "$RELEASE_MGR" rollback "$profile" --fixture-root "$fixture_root" --quarantine

    local cur_after
    cur_after=$(basename "$(python3 "$CONTAINMENT_HELPER" readlink "$profile_dir" "current")")

    assert_eq "$prev_before" "$cur_after" "Current pointer rolled back to previous target."
    assert_not_exists "$profile_dir/previous" "Previous pointer is absent after demoted release is quarantined and no valid older historical release exists."

    # Check quarantine renaming
    local quarantined_found="false"
    if find "$releases_dir" -maxdepth 1 -name "${cur_before}.quarantined_*" | grep -q .; then
        quarantined_found="true"
    fi
    assert_eq "true" "$quarantined_found" "Demoted release renamed to quarantined forensic directory."
}

# ------------------------------------------------------------------------------
# Test Suite 5: Release Retention Pruning Policy
# ------------------------------------------------------------------------------
suite_retention_pruning() {
    local fixture_root="$1"
    tlog "Running Test Suite 5: Retention Pruning (Active + 5 Historical = Max 6)..."

    local profile="retention_test"
    local profile_dir="$fixture_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    mkdir -p "$profile_dir" "$releases_dir" "$tmp_dir"

    # Create 8 mock releases
    for i in {1..8}; do
        local rname="release_20261024_00000${i}_test"
        mkdir -p "$releases_dir/$rname"
        echo "manifest" > "$releases_dir/$rname/release_manifest.json"
    done

    # Set pointers: current -> release 8, previous -> release 7
    ln -s "releases/release_20261024_000008_test" "$profile_dir/current"
    ln -s "releases/release_20261024_000007_test" "$profile_dir/previous"

    # Invoke retention pruning logic via script
    # Simulates prune_retention call
    (
        source "$RELEASE_MGR"
        prune_retention "$fixture_root" "$profile"
    )

    # Count remaining valid releases
    local remaining_count
    remaining_count=$(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d ! -name "*.staging*" ! -name "*.failed*" ! -name "*.quarantined*" | wc -l)
    assert_eq "6" "$remaining_count" "Exactly 6 releases retained (1 active + 5 historical)."

    # Verify oldest releases (1 and 2) were pruned
    assert_not_exists "$releases_dir/release_20261024_000001_test" "Oldest release 1 pruned."
    assert_not_exists "$releases_dir/release_20261024_000002_test" "Oldest release 2 pruned."

    # Verify protected active and previous releases exist
    assert_exists "$releases_dir/release_20261024_000008_test" "Active release 8 protected from pruning."
    assert_exists "$releases_dir/release_20261024_000007_test" "Previous release 7 protected from pruning."

    # Test 5.2: Protected Previous Pointer Referencing Release Older than Rank 6
    local profile2="retention_old_prev"
    local profile2_dir="$fixture_root/$profile2"
    local releases2_dir="$profile2_dir/releases"
    mkdir -p "$profile2_dir" "$releases2_dir" "$profile2_dir/tmp"

    for i in {1..8}; do
        local rname="release_20261024_00000${i}_oldprev"
        mkdir -p "$releases2_dir/$rname"
        echo "manifest" > "$releases2_dir/$rname/release_manifest.json"
    done

    # current -> release 8, previous -> release 1 (normally candidate rank 8, older than window)
    ln -s "releases/release_20261024_000008_oldprev" "$profile2_dir/current"
    ln -s "releases/release_20261024_000001_oldprev" "$profile2_dir/previous"

    (
        source "$RELEASE_MGR"
        prune_retention "$fixture_root" "$profile2"
    )

    local rem_count2
    rem_count2=$(find "$releases2_dir" -mindepth 1 -maxdepth 1 -type d ! -name "*.staging*" ! -name "*.failed*" ! -name "*.quarantined*" | wc -l)
    assert_eq "6" "$rem_count2" "Old-previous retention preserves exactly 6 releases."

    # Verify release 1 (previous) and release 8 (current) exist
    assert_exists "$releases2_dir/release_20261024_000008_oldprev" "Active release 8 preserved."
    assert_exists "$releases2_dir/release_20261024_000001_oldprev" "Older previous release 1 explicitly preserved (protected pointer check)."

    # Verify releases 7, 6, 5, 4 (top 4 historical) preserved
    assert_exists "$releases2_dir/release_20261024_000007_oldprev" "Historical release 7 preserved."
    assert_exists "$releases2_dir/release_20261024_000006_oldprev" "Historical release 6 preserved."
    assert_exists "$releases2_dir/release_20261024_000005_oldprev" "Historical release 5 preserved."
    assert_exists "$releases2_dir/release_20261024_000004_oldprev" "Historical release 4 preserved."

    # Verify releases 2 and 3 pruned
    assert_not_exists "$releases2_dir/release_20261024_000002_oldprev" "Unprotected candidate 2 pruned."
    assert_not_exists "$releases2_dir/release_20261024_000003_oldprev" "Unprotected candidate 3 pruned."
}

# ------------------------------------------------------------------------------
# Test Suite 6: Sourcing Entrypoint & Shell Options Safety
# ------------------------------------------------------------------------------
suite_sourcing_safety() {
    tlog "Running Test Suite 6: Sourcing Entrypoint & Shell Option Safety..."

    # Test 6.1: Sourcing defines functions without invoking main or exiting
    local sourcing_test
    sourcing_test=$(
        source "$RELEASE_MGR"
        if declare -f prune_retention >/dev/null && declare -f cmd_deploy >/dev/null; then
            printf "FUNCTIONS_DEFINED"
        fi
    )
    assert_eq "FUNCTIONS_DEFINED" "$sourcing_test" "Sourcing defined functions without calling main or exiting."

    # Test 6.2: Shell Option Behavior Check
    # Verify that subshell encapsulation isolates parent shell options
    local parent_opts="$-"
    (
        source "$RELEASE_MGR"
        # Subshell now has set -euo pipefail
        if [[ "$-" == *"e"* ]]; then
            exit 0
        fi
        exit 1
    )
    local subshell_exit=$?
    assert_eq "0" "$subshell_exit" "Subshell successfully encapsulated release_manager options."
    local parent_opts_after="$-"
    assert_eq "$parent_opts" "$parent_opts_after" "Parent shell options 100% unaltered by subshell-encapsulated sourcing."
}

# ------------------------------------------------------------------------------
# Main Test Harness Runner
# ------------------------------------------------------------------------------
main() {
    local fixture_root=""
    local do_cleanup="false"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --fixture-root)
                fixture_root="$2"
                shift 2
                ;;
            --cleanup)
                do_cleanup="true"
                shift
                ;;
            -h|--help)
                printf "Usage: %s [--fixture-root <path>] [--cleanup]\n" "$0"
                printf "Runs complete release manager verification strictly within fixture.\n"
                exit 0
                ;;
            *)
                printf "Unknown argument: %s\n" "$1" >&2
                exit 1
                ;;
        esac
    done

    if [[ -z "$fixture_root" ]]; then
        local unique_ts
        unique_ts="$(date -u +'%Y%m%d_%H%M%S')_$$"
        fixture_root="/var/www/linkx-releases/.test_fixture/run_${unique_ts}"
    fi

    # Safety Assertions on Fixture Root
    if [[ "$fixture_root" == "/" || "$fixture_root" == "/var/www" || "$fixture_root" == "/var/www/linkx-frontend" || "$fixture_root" == "/var/www/linkx-releases" ]]; then
        printf "[FATAL] Fixture root '%s' cannot be a root or production directory!\n" "$fixture_root" >&2
        printf "Must specify a dedicated isolated test fixture path.\n" >&2
        exit 1
    fi

    printf "\n=================================================================\n"
    printf " Linkx Release Architecture — Verification Test Suite\n"
    printf " Fixture Root: %s\n" "$fixture_root"
    printf "=================================================================\n\n"

    # Capture pre-test production fingerprint
    local pre_fingerprint="/tmp/linkx_pre_test_fingerprint.txt"
    local post_fingerprint="/tmp/linkx_post_test_fingerprint.txt"
    capture_production_fingerprint "$pre_fingerprint"

    # Provision isolated fixture directory
    mkdir -p "$fixture_root"

    # Execute test suites
    suite_containment_fs "$fixture_root"
    suite_release_assembly "$fixture_root"
    suite_crash_recovery "$fixture_root"
    suite_rollback_quarantine "$fixture_root"
    suite_retention_pruning "$fixture_root"
    suite_sourcing_safety

    # Capture post-test production fingerprint and assert zero mutations
    capture_production_fingerprint "$post_fingerprint"
    assert_production_unmutated "$pre_fingerprint" "$post_fingerprint"

    # Cleanup temporary fingerprint files (fixture is preserved unless --cleanup)
    rm -f "$pre_fingerprint" "$post_fingerprint"

    printf "\n=================================================================\n"
    printf " Test Execution Summary\n"
    printf " Total Passed : %d\n" "$TESTS_PASSED"
    printf " Total Failed : %d\n" "$TESTS_FAILED"
    printf " Fixture Path : %s\n" "$fixture_root"
    printf "=================================================================\n\n"

    if [[ "$do_cleanup" == "true" && "$TESTS_FAILED" -eq 0 ]]; then
        tlog "Executing safe containment-helper cleanup of fixture: $fixture_root..."
        local parent_dir
        parent_dir="$(dirname "$fixture_root")"
        local leaf_name
        leaf_name="$(basename "$fixture_root")"
        python3 "$CONTAINMENT_HELPER" rmtree "$parent_dir" "$leaf_name"
        # If .test_fixture directory is now empty, remove it using containment helper
        if [[ "$parent_dir" == "/var/www/linkx-releases/.test_fixture" ]]; then
            local rem_runs
            rem_runs=$(find "$parent_dir" -mindepth 1 | wc -l)
            if [[ "$rem_runs" -eq 0 ]]; then
                python3 "$CONTAINMENT_HELPER" rmtree "/var/www/linkx-releases" ".test_fixture"
            fi
        fi
        tpass "Fixture directory cleaned up cleanly via descriptor-relative containment helper."
    fi

    if [[ "$TESTS_FAILED" -gt 0 ]]; then
        exit 1
    fi
    exit 0
}

# Only invoke main if executed as script, not when sourced
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
