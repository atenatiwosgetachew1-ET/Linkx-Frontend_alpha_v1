#!/usr/bin/env bash
# ==============================================================================
# Linkx Frontend — Multi-Profile Release & Deployment Manager
# ==============================================================================
# Canonical Reference: doc/LINKX_RELEASE_ARCHITECTURE_HANDOFF.md
#
# Non-negotiable Architectural Invariants:
# 1. POSIX-atomic promotion via descriptor-relative openat2(RESOLVE_BENEATH).
# 2. Mutex isolation per profile via non-blocking flock on .deploy.lock.
# 3. Two-pointer deterministic rollback (current and previous swaps).
# 4. Strict crash-state durability: Table 5A (Deploy), Table 5B (Rollback),
#    Table 5C (Failure Archival).
# 5. Clean compilation inputs allowlist; never executes git reset/clean.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$SCRIPT_DIR"
CONTAINMENT_HELPER="$WORKSPACE_ROOT/containment_fs.py"
DEFAULT_RELEASES_ROOT="/var/www/linkx-releases"

# Exit codes
EXIT_SUCCESS=0
EXIT_ERROR=1
EXIT_STORAGE_FAULT=2
EXIT_AMBIGUOUS_STATE=98
EXIT_CONTAINMENT_PROBE_FAILED=99

# Colors for log output
COLOR_RESET="\033[0m"
COLOR_INFO="\033[0;32m"
COLOR_WARN="\033[0;33m"
COLOR_ERROR="\033[0;31m"

log_info() {
    printf "${COLOR_INFO}[INFO] %s: %s${COLOR_RESET}\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_warn() {
    printf "${COLOR_WARN}[WARN] %s: %s${COLOR_RESET}\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_error() {
    printf "${COLOR_ERROR}[ERROR] %s: %s${COLOR_RESET}\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_fatal() {
    printf "${COLOR_ERROR}[FATAL] %s: %s${COLOR_RESET}\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

# ------------------------------------------------------------------------------
# ContainmentFS Dispatcher
# ------------------------------------------------------------------------------
cfs() {
    if [[ ! -f "$CONTAINMENT_HELPER" ]]; then
        log_fatal "ContainmentFS helper missing at $CONTAINMENT_HELPER"
        exit "$EXIT_CONTAINMENT_PROBE_FAILED"
    fi
    python3 "$CONTAINMENT_HELPER" "$@"
}

# ------------------------------------------------------------------------------
# Preflight Validation
# ------------------------------------------------------------------------------
preflight_environment() {
    local releases_root="$1"

    # OS check
    if [[ "$(uname -s)" != "Linux" ]]; then
        log_fatal "Unsupported operating system. Linux 5.6+ with openat2 is required."
        exit "$EXIT_CONTAINMENT_PROBE_FAILED"
    fi

    # Verify release root directory exists
    if [[ ! -d "$releases_root" ]]; then
        log_fatal "Releases root does not exist: $releases_root. Must be provisioned prior to execution."
        exit "$EXIT_CONTAINMENT_PROBE_FAILED"
    fi

    # Execute non-mutating openat2 containment probe
    if ! cfs probe "$releases_root"; then
        log_fatal "Kernel openat2(RESOLVE_BENEATH) capability probe failed on $releases_root."
        exit "$EXIT_CONTAINMENT_PROBE_FAILED"
    fi

    # Verify filesystem device matching
    if ! cfs device-check "$WORKSPACE_ROOT" "$releases_root"; then
        log_fatal "Filesystem device mismatch between workspace ($WORKSPACE_ROOT) and releases root ($releases_root)."
        exit "$EXIT_CONTAINMENT_PROBE_FAILED"
    fi
}

preflight_git() {
    local allow_dirty="$1"

    # Strict allowlist of compilation source inputs
    local source_inputs=("src" "public" "package.json" "package-lock.json" "vite.config.js" "index.html")

    if ! git -C "$WORKSPACE_ROOT" diff --quiet -- "${source_inputs[@]}"; then
        log_fatal "Tracked compilation source inputs contain uncommitted modifications. Refusing build."
        git -C "$WORKSPACE_ROOT" status --short -- "${source_inputs[@]}" >&2
        exit "$EXIT_ERROR"
    fi

    if [[ "$allow_dirty" != "true" ]]; then
        # Check if preserved deployed content has uncommitted CRLF line-ending differences
        if [[ -d "$WORKSPACE_ROOT/linkxCDR2026" && -d "$WORKSPACE_ROOT/linkxDS2026" ]]; then
            if ! git -C "$WORKSPACE_ROOT" diff --quiet -- linkxCDR2026/index.html linkxDS2026/index.html 2>/dev/null; then
                log_warn "Tracked production bundles have CRLF formatting diffs from prior builds."
                log_warn "Pass '--allow-dirty' to acknowledge preserved deployed content without modifying it."
                exit "$EXIT_ERROR"
            fi
        fi
    fi
}

preflight_profile_config() {
    local profile="$1"
    local env_file="$2"

    if [[ "$profile" != "cdr" && "$profile" != "nbe" ]]; then
        log_fatal "Invalid profile '$profile'. Supported profiles: 'cdr', 'nbe'."
        exit "$EXIT_ERROR"
    fi

    if [[ "$profile" == "cdr" && -z "$env_file" ]]; then
        # Verify if workspace .env targets CDR
        local env_theme=""
        if [[ -f "$WORKSPACE_ROOT/.env" ]]; then
            env_theme=$(grep -E '^VITE_THEME=' "$WORKSPACE_ROOT/.env" | cut -d'=' -f2 || true)
        fi
        if [[ "$env_theme" != "cdr" ]]; then
            log_fatal "Blocker D-1: Local CDR build on Node-18 lacks valid environment configuration."
            log_fatal "Workspace .env defines VITE_THEME='$env_theme'. You must supply '--env-file <path>' to build CDR."
            exit "$EXIT_ERROR"
        fi
    fi
}

# ------------------------------------------------------------------------------
# State File Helpers (Table 5C Compliance)
# ------------------------------------------------------------------------------
read_transaction_state() {
    local profile_dir="$1"
    local state_file="$profile_dir/.transaction.json"

    if [[ ! -f "$state_file" ]]; then
        return 1
    fi

    local size
    size=$(stat -c "%s" "$state_file" 2>/dev/null || echo "0")
    if [[ "$size" -eq 0 ]]; then
        log_fatal "State file $state_file is 0 bytes (corrupted from interrupted creation)."
        log_fatal "Preserving file untouched for manual operator inspection. Halting."
        exit "$EXIT_AMBIGUOUS_STATE"
    fi

    if ! python3 -c 'import sys, json; json.load(open(sys.argv[1]))' "$state_file" 2>/dev/null; then
        log_fatal "State file $state_file contains malformed JSON."
        log_fatal "Preserving file untouched for manual operator inspection. Halting."
        exit "$EXIT_AMBIGUOUS_STATE"
    fi

    return 0
}

write_transaction_state() {
    local profile_dir="$1"
    local tmp_dir="$2"
    local json_payload="$3"

    printf "%s" "$json_payload" | cfs write-atomic "$profile_dir" "$tmp_dir" ".transaction.json"
}

archive_transaction_failure() {
    local profile_dir="$1"
    local tmp_dir="$2"
    local tx_id="$3"
    local error_phase="$4"
    local error_msg="$5"

    local archive_name=".transaction.failed.${tx_id}.json"
    log_warn "Archiving failed transaction '$tx_id' to '$archive_name'..."

    # Read existing payload or construct new failed object
    local state_file="$profile_dir/.transaction.json"
    local payload
    if [[ -f "$state_file" ]]; then
        payload=$(python3 -c '
import sys, json
state_path = sys.argv[1]
tx = sys.argv[2]
err_phase = sys.argv[3]
err_msg = sys.argv[4]
failed_at = sys.argv[5]
try:
    with open(state_path, "r", encoding="utf-8") as f:
        d = json.load(f)
except Exception:
    d = {"transaction_id": tx}
d["status"] = "failed"
d["error_phase"] = err_phase
d["error_message"] = err_msg
d["failed_at_utc"] = failed_at
print(json.dumps(d, indent=2))
' "$state_file" "$tx_id" "$error_phase" "$error_msg" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    else
        payload=$(python3 -c '
import sys, json
data = {
    "transaction_id": sys.argv[1],
    "status": "failed",
    "error_phase": sys.argv[2],
    "error_message": sys.argv[3],
    "failed_at_utc": sys.argv[4]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$error_phase" "$error_msg" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    fi

    # Write failure archive atomically
    printf "%s" "$payload" | cfs write-atomic "$profile_dir" "$tmp_dir" "$archive_name"

    # Remove active .transaction.json if it exists
    if [[ -f "$state_file" ]]; then
        cfs unlink "$profile_dir" ".transaction.json"
    fi
}

halt_on_ambiguous_artifacts() {
    local profile_dir="$1"
    local tmp_dir="$2"
    local tx_id="$3"
    local reason="$4"

    log_fatal "AMBIGUOUS_STATE_HALT: $reason"
    log_fatal "Preserving ALL artifacts and state files on disk untouched for operator review."

    # Write companion conflict diagnosis file
    local conflict_file=".transaction.conflict.${tx_id}.json"
    local conflict_payload
    conflict_payload=$(python3 -c '
import sys, json
data = {
    "transaction_id": sys.argv[1],
    "status": "halted_ambiguous",
    "reason": sys.argv[2],
    "detected_at_utc": sys.argv[3]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$reason" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    printf "%s" "$conflict_payload" | cfs write-atomic "$profile_dir" "$tmp_dir" "$conflict_file"

    # Update primary .transaction.json to HALTED_AMBIGUOUS without unlinking it
    local state_file="$profile_dir/.transaction.json"
    if [[ -f "$state_file" ]]; then
        local updated_state
        updated_state=$(python3 -c '
import sys, json
state_path = sys.argv[1]
tx = sys.argv[2]
ambig_reason = sys.argv[3]
try:
    with open(state_path, "r", encoding="utf-8") as f:
        d = json.load(f)
except Exception:
    d = {"transaction_id": tx}
d["phase"] = "HALTED_AMBIGUOUS"
d["ambiguity_reason"] = ambig_reason
print(json.dumps(d, indent=2))
' "$state_file" "$tx_id" "$reason")
        printf "%s" "$updated_state" | cfs write-atomic "$profile_dir" "$tmp_dir" ".transaction.json"
    fi

    exit "$EXIT_AMBIGUOUS_STATE"
}

# ------------------------------------------------------------------------------
# Profile Initialization & Mutex
# ------------------------------------------------------------------------------
init_profile_tree() {
    local releases_root="$1"
    local profile="$2"

    local profile_dir="$releases_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    if [[ ! -d "$profile_dir" ]]; then
        cfs mkdir "$releases_root" "$profile"
    fi
    if [[ ! -d "$releases_dir" ]]; then
        cfs mkdir "$profile_dir" "releases"
    fi
    if [[ ! -d "$tmp_dir" ]]; then
        cfs mkdir "$profile_dir" "tmp"
    fi

    # Ensure live web root directory exists
    local live_dir="$releases_root/live"
    if [[ ! -d "$live_dir" ]]; then
        cfs mkdir "$releases_root" "live"
    fi
}

acquire_lock() {
    local lock_file="$1"
    exec 200>"$lock_file"
    if ! flock -n 200; then
        log_fatal "Could not acquire exclusive profile lock on $lock_file. Another deployment is in progress."
        exit "$EXIT_ERROR"
    fi
}

# ------------------------------------------------------------------------------
# Release Ledger Operations
# ------------------------------------------------------------------------------
append_ledger() {
    local profile_dir="$1"
    local tmp_dir="$2"
    local ledger_entry_json="$3"

    local ledger_file="$profile_dir/releases.json"
    local ledger_param="NONE"

    if [[ -f "$ledger_file" ]]; then
        ledger_param="$ledger_file"
    fi

    local updated_ledger
    updated_ledger=$(python3 -c '
import sys, json

ledger_path = sys.argv[1]
new_entry_json = sys.argv[2]

# 1. Parse new entry explicitly
try:
    new_entry = json.loads(new_entry_json)
    if not isinstance(new_entry, dict):
        raise ValueError("Ledger entry must be a JSON object")
except Exception as e:
    sys.stderr.write(f"[FATAL] MALFORMED_LEDGER_ENTRY: {e}\n")
    sys.exit(98)

# 2. Parse existing ledger if present
entries = []
if ledger_path != "NONE":
    try:
        with open(ledger_path, "r", encoding="utf-8") as f:
            content = f.read()
        if not content.strip():
            sys.stderr.write(f"[FATAL] CORRUPT_LEDGER_DETECTED: {ledger_path} is empty (0 bytes).\n")
            sys.exit(98)
        entries = json.loads(content)
        if not isinstance(entries, list):
            sys.stderr.write(f"[FATAL] CORRUPT_LEDGER_DETECTED: {ledger_path} root is not a JSON list.\n")
            sys.exit(98)
    except Exception as e:
        sys.stderr.write(f"[FATAL] CORRUPT_LEDGER_DETECTED: Failed to parse {ledger_path}: {e}\n")
        sys.exit(98)

# 3. Deduplicate by transaction_id (or release_id if transaction_id is absent)
tx_id = new_entry.get("transaction_id")
rel_id = new_entry.get("release_id")

already_exists = False
for e in entries:
    if not isinstance(e, dict):
        continue
    if tx_id:
        if e.get("transaction_id") == tx_id:
            already_exists = True
            break
    elif rel_id and e.get("release_id") == rel_id:
        already_exists = True
        break

if not already_exists:
    entries.append(new_entry)

print(json.dumps(entries, indent=2))
' "$ledger_param" "$ledger_entry_json") || {
        local exit_code=$?
        log_fatal "Ledger operation failed with exit code $exit_code. Ledger file preserved untouched."
        exit "$exit_code"
    }

    printf "%s" "$updated_ledger" | cfs write-atomic "$profile_dir" "$tmp_dir" "releases.json"
}

# ------------------------------------------------------------------------------
# Retention Pruning Policy
# Formula: {R_active} U take(5, sort_desc(Candidates \ {R_active}))
# ------------------------------------------------------------------------------
prune_retention() {
    local releases_root="$1"
    local profile="$2"

    local profile_dir="$releases_root/$profile"
    local releases_dir="$profile_dir/releases"

    # Identify protected pointers
    local cur_target=""
    local prev_target=""

    if [[ -L "$profile_dir/current" ]]; then
        cur_target=$(basename "$(cfs readlink "$profile_dir" "current")")
    fi
    if [[ -L "$profile_dir/previous" ]]; then
        prev_target=$(basename "$(cfs readlink "$profile_dir" "previous")")
    fi

    # Fail-closed guard: if current is missing or invalid, do not prune
    if [[ -z "$cur_target" || ! -d "$releases_dir/$cur_target" ]]; then
        log_warn "Active release pointer 'current' is missing or invalid in profile '$profile'. Aborting retention pruning to protect releases."
        return 0
    fi

    log_info "Evaluating release retention (Active + 5 historical valid releases)..."

    # Enumerate candidate release directories
    local candidates=()
    while IFS= read -r dir_name; do
        [[ -z "$dir_name" ]] && continue
        # Ignore .staging or temporary directories
        if [[ "$dir_name" == *.staging* || "$dir_name" == *.failed_* || "$dir_name" == *.quarantined_* ]]; then
            continue
        fi
        candidates+=("$dir_name")
    done < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort -r)

    # 1. Separate historical candidates (Candidates \ { cur_target })
    local hist_candidates=()
    for cand in "${candidates[@]}"; do
        if [[ "$cand" != "$cur_target" ]]; then
            hist_candidates+=("$cand")
        fi
    done

    # 2. Check if prev_target is a valid historical candidate outside the 5 newest historical releases
    # Normal window: up to 5 historical releases
    local max_other_historical=5
    local prev_is_older_historical=false

    if [[ -n "$prev_target" && "$prev_target" != "$cur_target" ]]; then
        local prev_in_candidates=false
        local prev_in_top5=false
        local h_idx=0
        for hc in "${hist_candidates[@]}"; do
            if [[ "$hc" == "$prev_target" ]]; then
                prev_in_candidates=true
                if [[ $h_idx -lt 5 ]]; then
                    prev_in_top5=true
                fi
                break
            fi
            h_idx=$((h_idx + 1))
        done

        if [[ "$prev_in_candidates" == "true" && "$prev_in_top5" == "false" ]]; then
            # prev_target is outside the 5 newest historical candidates.
            # Reserve 1 historical slot for prev_target; retain 4 newest other historical candidates.
            prev_is_older_historical=true
            max_other_historical=4
        fi
    fi

    # 3. Collect live pointer targets for fresh assertion
    local live_targets=()
    if [[ -d "$releases_root/live" ]]; then
        for llink in "$releases_root/live"/*; do
            if [[ -L "$llink" ]]; then
                local ltarget
                ltarget=$(basename "$(readlink -f "$llink" 2>/dev/null)")
                if [[ -n "$ltarget" ]]; then
                    live_targets+=("$ltarget")
                fi
            fi
        done
    fi

    # 4. Pruning loop over historical candidates
    local other_historical_count=0
    for cand in "${hist_candidates[@]}"; do
        # If prev_target is an older historical release, it is explicitly retained
        if [[ "$prev_is_older_historical" == "true" && "$cand" == "$prev_target" ]]; then
            log_info "Retaining older previous pointer target: releases/$cand"
            continue
        fi

        other_historical_count=$((other_historical_count + 1))
        if [[ $other_historical_count -le $max_other_historical ]]; then
            # Retained in historical pool
            continue
        fi

        # Fresh protected-pointer assertions immediately before deletion
        local fresh_cur=""
        local fresh_prev=""
        if [[ -L "$profile_dir/current" ]]; then
            fresh_cur=$(basename "$(cfs readlink "$profile_dir" "current")")
        fi
        if [[ -L "$profile_dir/previous" ]]; then
            fresh_prev=$(basename "$(cfs readlink "$profile_dir" "previous")")
        fi

        if [[ "$cand" == "$fresh_cur" || "$cand" == "$fresh_prev" ]]; then
            log_warn "Candidate $cand is referenced by fresh pointer check; skipping deletion."
            continue
        fi

        local is_live_referenced=false
        for lt in "${live_targets[@]}"; do
            if [[ "$cand" == "$lt" ]]; then
                is_live_referenced=true
                break
            fi
        done
        if [[ "$is_live_referenced" == "true" ]]; then
            log_warn "Candidate $cand is referenced by live pointer; skipping deletion."
            continue
        fi

        log_info "Pruning candidate release beyond retention window: releases/$cand"
        cfs rmtree "$releases_dir" "$cand"
    done
}

# ------------------------------------------------------------------------------
# Static Bundle Health Verification
# ------------------------------------------------------------------------------
verify_release_health() {
    local release_dir="$1"

    local index_html="$release_dir/index.html"
    if [[ ! -f "$index_html" ]]; then
        log_error "Health check failure: index.html missing in $release_dir"
        return 1
    fi

    # Verify script bundle exists
    local js_bundle
    js_bundle=$(grep -oE 'assets/index-[a-zA-Z0-9_-]+\.js' "$index_html" | head -n1 || true)
    if [[ -z "$js_bundle" || ! -f "$release_dir/$js_bundle" ]]; then
        log_error "Health check failure: Main JS bundle '$js_bundle' referenced in index.html is missing on disk."
        return 1
    fi

    # Verify style bundle exists
    local css_bundle
    css_bundle=$(grep -oE 'assets/index-[a-zA-Z0-9_-]+\.css' "$index_html" | head -n1 || true)
    if [[ -z "$css_bundle" || ! -f "$release_dir/$css_bundle" ]]; then
        log_error "Health check failure: Main CSS bundle '$css_bundle' referenced in index.html is missing on disk."
        return 1
    fi

    # Verify manifest exists and is non-empty
    local manifest="$release_dir/release_manifest.json"
    if [[ ! -f "$manifest" || ! -s "$manifest" ]]; then
        log_error "Health check failure: release_manifest.json missing or 0 bytes."
        return 1
    fi

    log_info "Static health checks passed for $(basename "$release_dir")"
    return 0
}

# ------------------------------------------------------------------------------
# Command: Deploy
# ------------------------------------------------------------------------------
cmd_deploy() {
    local profile="$1"
    local releases_root="$2"
    local allow_dirty="$3"
    local env_file="$4"
    local staging_only="$5"
    local dry_run="$6"

    preflight_environment "$releases_root"
    preflight_profile_config "$profile" "$env_file"
    preflight_git "$allow_dirty"

    init_profile_tree "$releases_root" "$profile"

    local profile_dir="$releases_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    acquire_lock "$profile_dir/.deploy.lock"

    # Reconcile in-flight transactions if present
    if read_transaction_state "$profile_dir"; then
        log_warn "In-flight transaction detected. Running recovery..."
        cmd_reconcile "$profile" "$releases_root"
    fi

    # Generate Release ID & Transaction ID
    local timestamp
    timestamp=$(date -u +%Y%m%d_%H%M%S)
    local rand_hex
    rand_hex=$(od -An -N4 -tx /dev/urandom | tr -d ' \n')
    local release_id="release_${timestamp}_${rand_hex}"
    local tx_id="tx_${timestamp}_${rand_hex}"

    local old_active_id="none"
    if [[ -L "$profile_dir/current" ]]; then
        old_active_id=$(basename "$(cfs readlink "$profile_dir" "current")")
    fi
    local old_previous_id="none"
    if [[ -L "$profile_dir/previous" ]]; then
        old_previous_id=$(basename "$(cfs readlink "$profile_dir" "previous")")
    fi

    log_info "Initiating deployment for profile '$profile' -> Release: $release_id (Tx: $tx_id)"

    if [[ "$dry_run" == "true" ]]; then
        log_info "[DRY-RUN] Would create staging releases/$release_id.staging, build Vite, and promote."
        return 0
    fi

    # 1. State: STAGING
    local tx_payload
    tx_payload=$(printf '{"action":"deploy","transaction_id":"%s","phase":"STAGING","profile":"%s","target_release_id":"%s","old_active_id":"%s","old_previous_id":"%s","created_at_utc":"%s"}' \
        "$tx_id" "$profile" "$release_id" "$old_active_id" "$old_previous_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    # Create staging directory
    local staging_name="${release_id}.staging"
    local staging_dir="$releases_dir/$staging_name"
    cfs mkdir "$releases_dir" "$staging_name"

    # Execute Vite build directly into staging directory
    log_info "Compiling React 19 / Vite frontend bundle directly into staging directory..."
    local vite_theme="$profile"
    if [[ "$profile" == "nbe" ]]; then
        vite_theme="nbe"
    fi

    local build_env=( "VITE_THEME=$vite_theme" )
    if [[ -n "$env_file" && -f "$env_file" ]]; then
        while IFS='=' read -r key val || [[ -n "$key" ]]; do
            [[ -z "$key" || "$key" == \#* ]] && continue
            build_env+=( "${key}=${val}" )
        done < "$env_file"
    fi

    # Invoke Vite directly; NEVER npm run build
    (
        cd "$WORKSPACE_ROOT"
        env "${build_env[@]}" npx vite build --outDir "$staging_dir"
    )

    # Seed byte-for-byte identical static asset directories from workspace
    log_info "Seeding static assets into release staging directory..."
    local static_dirs=("graph_icons" "libraries" "site_images" "site_videos" "thumbnails" "temp_placeholders" "temp_config" "temp_rules")
    for sdir in "${static_dirs[@]}"; do
        if [[ -d "$WORKSPACE_ROOT/public/$sdir" ]]; then
            cp -r "$WORKSPACE_ROOT/public/$sdir" "$staging_dir/"
        elif [[ -d "$WORKSPACE_ROOT/linkxDS2026/$sdir" ]]; then
            cp -r "$WORKSPACE_ROOT/linkxDS2026/$sdir" "$staging_dir/"
        fi
    done

    # Generate release_manifest.json with SHA256 checksums
    log_info "Generating release_manifest.json with SHA256 verification hashes..."
    local git_hash
    git_hash=$(git -C "$WORKSPACE_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
    local built_at
    built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    python3 -c '
import sys, os, hashlib, json

staging = sys.argv[1]
manifest = {
    "release_id": sys.argv[2],
    "transaction_id": sys.argv[3],
    "profile": sys.argv[4],
    "built_at_utc": sys.argv[5],
    "git_commit": sys.argv[6],
    "files": {}
}

for root, _, files in os.walk(staging):
    for f in sorted(files):
        if f == "release_manifest.json":
            continue
        full = os.path.join(root, f)
        rel = os.path.relpath(full, staging)
        h = hashlib.sha256()
        with open(full, "rb") as fp:
            while chunk := fp.read(65536):
                h.update(chunk)
        manifest["files"][rel] = {
            "sha256": h.hexdigest(),
            "size": os.path.getsize(full)
        }

with open(os.path.join(staging, "release_manifest.json"), "w", encoding="utf-8") as out:
    json.dump(manifest, out, indent=2)
' "$staging_dir" "$release_id" "$tx_id" "$profile" "$built_at" "$git_hash"

    # Verify static health in staging
    if ! verify_release_health "$staging_dir"; then
        log_error "Staging build validation failed. Aborting deployment."
        archive_transaction_failure "$profile_dir" "$tmp_dir" "$tx_id" "STAGING" "Staging bundle health check failed"
        exit "$EXIT_ERROR"
    fi

    if [[ "$staging_only" == "true" ]]; then
        log_info "Staging build completed successfully (--staging-only requested). Preserving $staging_dir."
        return 0
    fi

    # 2. State: FINALIZING
    tx_payload=$(printf '{"action":"deploy","transaction_id":"%s","phase":"FINALIZING","profile":"%s","target_release_id":"%s","old_active_id":"%s","old_previous_id":"%s"}' \
        "$tx_id" "$profile" "$release_id" "$old_active_id" "$old_previous_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    # Rename staging directory -> immutable release directory
    cfs rename "$releases_dir" "$staging_name" "$releases_dir" "$release_id"

    # 3. State: UPDATING_PREVIOUS
    local prev_tmp_name="previous.tmp.${tx_id}"
    local prev_tmp_target="releases/$old_active_id"
    if [[ "$old_active_id" != "none" && -d "$releases_dir/$old_active_id" ]]; then
        tx_payload=$(printf '{"action":"deploy","transaction_id":"%s","phase":"UPDATING_PREVIOUS","profile":"%s","target_release_id":"%s","old_active_id":"%s","previous_tmp_name":"%s","previous_tmp_target":"%s"}' \
            "$tx_id" "$profile" "$release_id" "$old_active_id" "$prev_tmp_name" "$prev_tmp_target")
        write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

        log_info "Updating previous pointer -> $prev_tmp_target..."
        cfs symlink-atomic "$profile_dir" "$prev_tmp_target" "previous" "$prev_tmp_name"
    fi

    # 4. State: UPDATING_CURRENT
    local cur_tmp_name="current.tmp.${tx_id}"
    local cur_tmp_target="releases/$release_id"
    tx_payload=$(printf '{"action":"deploy","transaction_id":"%s","phase":"UPDATING_CURRENT","profile":"%s","target_release_id":"%s","old_active_id":"%s","current_tmp_name":"%s","current_tmp_target":"%s"}' \
        "$tx_id" "$profile" "$release_id" "$old_active_id" "$cur_tmp_name" "$cur_tmp_target")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    log_info "Promoting new release: atomically swapping current -> $cur_tmp_target..."
    cfs symlink-atomic "$profile_dir" "$cur_tmp_target" "current" "$cur_tmp_name"

    # 5. State: VERIFYING
    tx_payload=$(printf '{"action":"deploy","transaction_id":"%s","phase":"VERIFYING","profile":"%s","target_release_id":"%s","old_active_id":"%s"}' \
        "$tx_id" "$profile" "$release_id" "$old_active_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    if ! verify_release_health "$profile_dir/current"; then
        log_error "Post-promotion health check failed! Initiating automated rollback..."
        # Rollback current pointer to old active
        if [[ "$old_active_id" != "none" && -d "$releases_dir/$old_active_id" ]]; then
            cfs symlink-atomic "$profile_dir" "releases/$old_active_id" "current" "current.tmp.rollback_${tx_id}"
        fi
        # Quarantine defective release
        cfs rename "$releases_dir" "$release_id" "$releases_dir" "${release_id}.failed_${timestamp}"
        archive_transaction_failure "$profile_dir" "$tmp_dir" "$tx_id" "VERIFYING" "Post-promotion static health check failed"
        exit "$EXIT_ERROR"
    fi

    # 6. State: COMMITTING
    tx_payload=$(printf '{"action":"deploy","transaction_id":"%s","phase":"COMMITTING","profile":"%s","target_release_id":"%s"}' \
        "$tx_id" "$profile" "$release_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    # Append release to ledger
    local ledger_entry
    ledger_entry=$(printf '{"action":"deploy","release_id":"%s","transaction_id":"%s","deployed_at_utc":"%s","status":"promoted"}' \
        "$release_id" "$tx_id" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    append_ledger "$profile_dir" "$tmp_dir" "$ledger_entry"

    # Prune historical retention
    prune_retention "$releases_root" "$profile"

    # Archive state
    cfs rename "$profile_dir" ".transaction.json" "$profile_dir" ".transaction.last.json"

    log_info "Deployment of $release_id for profile '$profile' successfully completed!"
}

# ------------------------------------------------------------------------------
# Command: Rollback
# ------------------------------------------------------------------------------
cmd_rollback() {
    local profile="$1"
    local releases_root="$2"
    local quarantine="$3"
    local dry_run="$4"

    preflight_environment "$releases_root"

    local profile_dir="$releases_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    acquire_lock "$profile_dir/.deploy.lock"

    # Reconcile in-flight transactions if present
    if read_transaction_state "$profile_dir"; then
        log_warn "In-flight transaction detected. Running recovery..."
        cmd_reconcile "$profile" "$releases_root"
    fi

    # Verify rollback prerequisites
    if [[ ! -L "$profile_dir/previous" ]]; then
        log_fatal "NO_PRIOR_RELEASE_AVAILABLE: 'previous' symlink does not exist for profile '$profile'."
        exit "$EXIT_ERROR"
    fi

    local current_target
    current_target=$(cfs readlink "$profile_dir" "current")
    local previous_target
    previous_target=$(cfs readlink "$profile_dir" "previous")

    local demoted_active_id
    demoted_active_id=$(basename "$current_target")
    local restore_target_id
    restore_target_id=$(basename "$previous_target")

    if [[ ! -d "$releases_dir/$restore_target_id" ]]; then
        log_fatal "EMERGENCY: Rollback target 'releases/$restore_target_id' missing on disk! Cannot rollback."
        exit "$EXIT_ERROR"
    fi

    local timestamp
    timestamp=$(date -u +%Y%m%d_%H%M%S)
    local rand_hex
    rand_hex=$(od -An -N4 -tx /dev/urandom | tr -d ' \n')
    local tx_id="tx_rb_${timestamp}_${rand_hex}"

    local cur_tmp_name="current.tmp.${tx_id}"
    local prev_tmp_name="previous.tmp.${tx_id}"
    local quarantine_target_id="${demoted_active_id}.quarantined_${timestamp}"

    # Discover prior historical release (H) if quarantining demoted active release
    local prior_historical_id=""
    if [[ "$quarantine" == "true" ]]; then
        while IFS= read -r dir_name; do
            [[ -z "$dir_name" ]] && continue
            # Exclude all staging, interrupted-staging, failed, and quarantined directories
            if [[ "$dir_name" == *.staging* || "$dir_name" == *.failed_* || "$dir_name" == *.quarantined_* ]]; then
                continue
            fi
            # Exclude currently active and rollback restoration targets
            if [[ "$dir_name" == "$demoted_active_id" || "$dir_name" == "$restore_target_id" ]]; then
                continue
            fi
            # Validate candidate release using static health check and manifest rules
            if verify_release_health "$releases_dir/$dir_name" >/dev/null 2>&1; then
                prior_historical_id="$dir_name"
                break
            else
                log_warn "Candidate historical release '$dir_name' failed health checks; excluding from selection."
            fi
        done < <(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" | sort -r)
    fi

    local expected_previous_target
    if [[ "$quarantine" == "true" ]]; then
        if [[ -n "$prior_historical_id" && -d "$releases_dir/$prior_historical_id" ]]; then
            expected_previous_target="releases/$prior_historical_id"
        else
            expected_previous_target="none"
        fi
    else
        expected_previous_target="releases/$demoted_active_id"
    fi

    log_info "Initiating rollback for profile '$profile': $demoted_active_id -> $restore_target_id"

    if [[ "$dry_run" == "true" ]]; then
        if [[ "$expected_previous_target" != "none" ]]; then
            log_info "[DRY-RUN] Would swap current -> releases/$restore_target_id and previous -> $expected_previous_target."
        else
            log_info "[DRY-RUN] Would swap current -> releases/$restore_target_id and unlink previous (no prior historical release)."
        fi
        return 0
    fi

    # 1. State: ROLLBACK_INITIALIZING
    local tx_payload
    tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_INITIALIZING",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "current_tmp_name": sys.argv[5],
    "current_tmp_target": "releases/" + sys.argv[4],
    "previous_tmp_name": sys.argv[6],
    "previous_tmp_target": sys.argv[7],
    "expected_previous_target": sys.argv[7],
    "quarantine_demoted": sys.argv[8] == "true",
    "quarantine_target_id": sys.argv[9]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$restore_target_id" "$cur_tmp_name" "$prev_tmp_name" "$expected_previous_target" "$quarantine" "$quarantine_target_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    # 2. State: ROLLBACK_SWAPPING_CURRENT
    tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_SWAPPING_CURRENT",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "current_tmp_name": sys.argv[5],
    "current_tmp_target": "releases/" + sys.argv[4],
    "previous_tmp_name": sys.argv[6],
    "previous_tmp_target": sys.argv[7],
    "expected_previous_target": sys.argv[7],
    "quarantine_demoted": sys.argv[8] == "true",
    "quarantine_target_id": sys.argv[9]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$restore_target_id" "$cur_tmp_name" "$prev_tmp_name" "$expected_previous_target" "$quarantine" "$quarantine_target_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    log_info "Rollback Step 1: Atomically swapping current -> releases/$restore_target_id..."
    cfs symlink-atomic "$profile_dir" "releases/$restore_target_id" "current" "$cur_tmp_name"

    # 3. State: ROLLBACK_SWAPPING_PREVIOUS
    tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_SWAPPING_PREVIOUS",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "previous_tmp_name": sys.argv[5],
    "previous_tmp_target": sys.argv[6],
    "expected_previous_target": sys.argv[6],
    "quarantine_demoted": sys.argv[7] == "true",
    "quarantine_target_id": sys.argv[8]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$restore_target_id" "$prev_tmp_name" "$expected_previous_target" "$quarantine" "$quarantine_target_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    if [[ "$expected_previous_target" != "none" ]]; then
        log_info "Rollback Step 2: Atomically swapping previous -> $expected_previous_target..."
        cfs symlink-atomic "$profile_dir" "$expected_previous_target" "previous" "$prev_tmp_name"
    else
        log_info "Rollback Step 2: No prior historical release available; safely unlinking previous pointer..."
        cfs unlink "$profile_dir" "previous"
    fi

    # 4. Optional Quarantine
    if [[ "$quarantine" == "true" ]]; then
        tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_QUARANTINING_DEMOTED",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "expected_previous_target": sys.argv[5],
    "quarantine_demoted": True,
    "quarantine_target_id": sys.argv[6]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$restore_target_id" "$expected_previous_target" "$quarantine_target_id")
        write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

        log_info "Quarantining demoted release $demoted_active_id -> $quarantine_target_id..."
        # Detect collisions and already-completed renames safely
        if [[ -d "$releases_dir/$quarantine_target_id" && ! -d "$releases_dir/$demoted_active_id" ]]; then
            log_info "Quarantine rename previously completed ($quarantine_target_id exists)."
        elif [[ -d "$releases_dir/$quarantine_target_id" && -d "$releases_dir/$demoted_active_id" ]]; then
            halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Quarantine destination collision: '$quarantine_target_id' already exists while source '$demoted_active_id' remains"
        elif [[ -d "$releases_dir/$demoted_active_id" ]]; then
            # Assert zero references to demoted active release
            local c_chk="none"
            local p_chk="none"
            if [[ -L "$profile_dir/current" ]]; then
                c_chk=$(basename "$(cfs readlink "$profile_dir" "current")")
            fi
            if [[ -L "$profile_dir/previous" ]]; then
                p_chk=$(basename "$(cfs readlink "$profile_dir" "previous")")
            fi
            if [[ "$c_chk" == "$demoted_active_id" || "$p_chk" == "$demoted_active_id" ]]; then
                log_fatal "Safety assertion failed: Cannot quarantine release currently referenced by pointers."
                exit "$EXIT_ERROR"
            fi
            cfs rename "$releases_dir" "$demoted_active_id" "$releases_dir" "$quarantine_target_id"
        else
            halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Demoted active release '$demoted_active_id' missing on disk"
        fi
    fi

    # 5. Verify restored health
    tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_VERIFYING",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "expected_previous_target": sys.argv[5],
    "quarantine_demoted": sys.argv[6] == "true",
    "quarantine_target_id": sys.argv[7]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$restore_target_id" "$expected_previous_target" "$quarantine" "$quarantine_target_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    if ! verify_release_health "$profile_dir/current"; then
        log_fatal "EMERGENCY: Restored rollback release also failed health checks! Double-fault detected."
        archive_transaction_failure "$profile_dir" "$tmp_dir" "$tx_id" "ROLLBACK_VERIFYING" "Double fault on restored release"
        exit "$EXIT_ERROR"
    fi

    # 6. Commit rollback to ledger
    tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_COMMITTING",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "quarantine_target_id": sys.argv[5]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$restore_target_id" "$quarantine_target_id")
    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

    local ledger_entry
    ledger_entry=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "restored_release_id": sys.argv[1],
    "demoted_release_id": sys.argv[2],
    "transaction_id": sys.argv[3],
    "quarantined": sys.argv[4] == "true",
    "timestamp_utc": sys.argv[5]
}
print(json.dumps(data))
' "$restore_target_id" "$demoted_active_id" "$tx_id" "$quarantine" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
    append_ledger "$profile_dir" "$tmp_dir" "$ledger_entry"

    # Archive state
    cfs rename "$profile_dir" ".transaction.json" "$profile_dir" ".transaction.last.json"

    log_info "Rollback to $restore_target_id completed successfully!"
}

# ------------------------------------------------------------------------------
# Command: Reconcile (Crash Recovery Engine per Tables 5A, 5B, 5C)
# ------------------------------------------------------------------------------
cmd_reconcile() {
    local profile="$1"
    local releases_root="$2"

    preflight_environment "$releases_root"

    local profile_dir="$releases_root/$profile"
    local releases_dir="$profile_dir/releases"
    local tmp_dir="$profile_dir/tmp"

    acquire_lock "$profile_dir/.deploy.lock"

    if ! read_transaction_state "$profile_dir"; then
        log_info "Steady state: No in-flight transaction found for profile '$profile'."
        return 0
    fi

    local state_file="$profile_dir/.transaction.json"

    # Parse state fields
    local action phase tx_id target_id old_active_id
    action=$(python3 -c 'import sys, json; print(json.load(open(sys.argv[1])).get("action", ""))' "$state_file")
    phase=$(python3 -c 'import sys, json; print(json.load(open(sys.argv[1])).get("phase", ""))' "$state_file")
    tx_id=$(python3 -c 'import sys, json; print(json.load(open(sys.argv[1])).get("transaction_id", ""))' "$state_file")
    target_id=$(python3 -c 'import sys, json; print(json.load(open(sys.argv[1])).get("target_release_id", ""))' "$state_file")
    old_active_id=$(python3 -c 'import sys, json; print(json.load(open(sys.argv[1])).get("old_active_id", ""))' "$state_file")

    log_info "Reconciling in-flight transaction: action=$action, phase=$phase, tx_id=$tx_id"

    if [[ "$phase" == "HALTED_AMBIGUOUS" ]]; then
        log_fatal "Transaction was previously halted due to ambiguous/conflicting artifacts."
        log_fatal "Manual operator intervention is required before further operations can proceed."
        exit "$EXIT_AMBIGUOUS_STATE"
    fi

    if [[ "$action" == "deploy" ]]; then
        case "$phase" in
            STAGING)
                # Staging build interrupted. Preserve with .staging_interrupted marker; archive state.
                if [[ -d "$releases_dir/${target_id}.staging" && ! -d "$releases_dir/$target_id" ]]; then
                    log_warn "Preserving interrupted staging directory with marker: ${target_id}.staging_interrupted"
                    cfs rename "$releases_dir" "${target_id}.staging" "$releases_dir" "${target_id}.staging_interrupted"
                    archive_transaction_failure "$profile_dir" "$tmp_dir" "$tx_id" "STAGING" "Staging interrupted by crash"
                else
                    halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Conflicting staging/target directory state"
                fi
                ;;
            FINALIZING)
                if [[ -d "$releases_dir/${target_id}.staging" && ! -d "$releases_dir/$target_id" ]]; then
                    # Staging directory exists; finalize rename
                    cfs rename "$releases_dir" "${target_id}.staging" "$releases_dir" "$target_id"
                fi
                # Advance to FINALIZED
                local updated
                updated=$(python3 -c 'import sys, json; d=json.load(open(sys.argv[1])); d["phase"]="FINALIZED"; print(json.dumps(d))' "$state_file")
                write_transaction_state "$profile_dir" "$tmp_dir" "$updated"
                ;;
            UPDATING_PREVIOUS)
                # Replay previous pointer update if valid
                if [[ -d "$releases_dir/$old_active_id" ]]; then
                    cfs symlink-atomic "$profile_dir" "releases/$old_active_id" "previous" "previous.tmp.${tx_id}"
                fi
                ;;
            UPDATING_CURRENT)
                # Check current pointer
                local cur_now="none"
                if [[ -L "$profile_dir/current" ]]; then
                    cur_now=$(basename "$(cfs readlink "$profile_dir" "current")")
                fi
                if [[ "$cur_now" == "$target_id" ]]; then
                    log_info "Cutover completed before crash."
                elif [[ "$cur_now" == "$old_active_id" ]]; then
                    log_info "Replaying cutover current -> releases/$target_id..."
                    cfs symlink-atomic "$profile_dir" "releases/$target_id" "current" "current.tmp.${tx_id}"
                else
                    halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Unexpected current symlink target '$cur_now'"
                fi
                ;;
            VERIFYING)
                verify_release_health "$profile_dir/current"
                ;;
            COMMITTING)
                cfs rename "$profile_dir" ".transaction.json" "$profile_dir" ".transaction.last.json"
                ;;
            *)
                halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Unrecognized transaction phase '$phase'"
                ;;
        esac
    elif [[ "$action" == "rollback" ]]; then
        local target_restore_id demoted_active_id prev_target quarantine_demoted quarantine_target_id cur_tmp_name prev_tmp_name
        read -r target_restore_id demoted_active_id prev_target quarantine_demoted quarantine_target_id cur_tmp_name prev_tmp_name < <(python3 -c '
import sys, json
try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        d = json.load(f)
    print(
        d.get("target_restore_id", ""),
        d.get("demoted_active_id", ""),
        d.get("previous_tmp_target", d.get("expected_previous_target", "none")),
        str(d.get("quarantine_demoted", False)).lower(),
        d.get("quarantine_target_id", ""),
        d.get("current_tmp_name", ""),
        d.get("previous_tmp_name", "")
    )
except Exception:
    print("", "", "none", "false", "", "", "")
' "$state_file")

        # Fallbacks for legacy/unpopulated state fields
        if [[ -z "$quarantine_target_id" ]]; then
            quarantine_target_id="${demoted_active_id}.quarantined_${tx_id}"
        fi
        if [[ -z "$cur_tmp_name" ]]; then
            cur_tmp_name="current.tmp.${tx_id}"
        fi
        if [[ -z "$prev_tmp_name" ]]; then
            prev_tmp_name="previous.tmp.${tx_id}"
        fi

        case "$phase" in
            ROLLBACK_INITIALIZING)
                local cur_chk="none"
                local prev_chk="none"
                if [[ -L "$profile_dir/current" ]]; then
                    cur_chk=$(basename "$(cfs readlink "$profile_dir" "current")")
                fi
                if [[ -L "$profile_dir/previous" ]]; then
                    prev_chk=$(basename "$(cfs readlink "$profile_dir" "previous")")
                fi
                if [[ "$cur_chk" == "$demoted_active_id" && "$prev_chk" == "$target_restore_id" ]]; then
                    archive_transaction_failure "$profile_dir" "$tmp_dir" "$tx_id" "ROLLBACK_INITIALIZING" "Rollback aborted before mutations"
                    return 0
                else
                    halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Inconsistent pre-rollback state during recovery: current='$cur_chk', previous='$prev_chk'"
                fi
                ;;

            ROLLBACK_SWAPPING_CURRENT|ROLLBACK_CURRENT_SWAPPED|\
            ROLLBACK_SWAPPING_PREVIOUS|ROLLBACK_PREVIOUS_SWAPPED|\
            ROLLBACK_QUARANTINING_DEMOTED|ROLLBACK_VERIFYING|ROLLBACK_COMMITTING)

                # 1. Reconcile current pointer cutover
                local cur_now="none"
                if [[ -L "$profile_dir/current" ]]; then
                    cur_now=$(basename "$(cfs readlink "$profile_dir" "current")")
                fi
                if [[ "$cur_now" == "$demoted_active_id" ]]; then
                    log_info "Reconciling rollback Step 1: Resuming atomic swap current -> releases/$target_restore_id..."
                    cfs symlink-atomic "$profile_dir" "releases/$target_restore_id" "current" "$cur_tmp_name"
                elif [[ "$cur_now" == "$target_restore_id" ]]; then
                    log_info "Rollback Step 1 already committed (current points to $target_restore_id)."
                else
                    halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Unexpected current symlink target '$cur_now' during rollback recovery"
                fi

                # Advance to ROLLBACK_CURRENT_SWAPPED
                local tx_payload
                tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_CURRENT_SWAPPED",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "previous_tmp_name": sys.argv[5],
    "previous_tmp_target": sys.argv[6],
    "expected_previous_target": sys.argv[6],
    "quarantine_demoted": sys.argv[7] == "true",
    "quarantine_target_id": sys.argv[8]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$target_restore_id" "$prev_tmp_name" "$prev_target" "$quarantine_demoted" "$quarantine_target_id")
                write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

                # 2. Reconcile previous pointer cutover / unlink
                local prev_now="none"
                if [[ -L "$profile_dir/previous" ]]; then
                    prev_now=$(basename "$(cfs readlink "$profile_dir" "previous")")
                fi
                local expected_prev_name="none"
                if [[ "$prev_target" != "none" && -n "$prev_target" ]]; then
                    expected_prev_name=$(basename "$prev_target")
                fi

                if [[ "$expected_prev_name" != "none" ]]; then
                    if [[ "$prev_now" != "$expected_prev_name" ]]; then
                        log_info "Reconciling rollback Step 2: Resuming atomic swap previous -> $prev_target..."
                        cfs symlink-atomic "$profile_dir" "$prev_target" "previous" "$prev_tmp_name"
                    else
                        log_info "Rollback Step 2 already committed (previous points to $expected_prev_name)."
                    fi
                else
                    if [[ "$prev_now" != "none" ]]; then
                        log_info "Reconciling rollback Step 2: Safely unlinking previous (no prior historical release)..."
                        cfs unlink "$profile_dir" "previous"
                    else
                        log_info "Rollback Step 2 already committed (previous safely unlinked)."
                    fi
                fi

                # Advance to ROLLBACK_PREVIOUS_SWAPPED
                tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_PREVIOUS_SWAPPED",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "previous_tmp_target": sys.argv[5],
    "expected_previous_target": sys.argv[5],
    "quarantine_demoted": sys.argv[6] == "true",
    "quarantine_target_id": sys.argv[7]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$target_restore_id" "$prev_target" "$quarantine_demoted" "$quarantine_target_id")
                write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

                # 3. Reconcile quarantine (if requested)
                if [[ "$quarantine_demoted" == "true" ]]; then
                    tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_QUARANTINING_DEMOTED",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "expected_previous_target": sys.argv[5],
    "quarantine_demoted": True,
    "quarantine_target_id": sys.argv[6]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$target_restore_id" "$prev_target" "$quarantine_target_id")
                    write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

                    log_info "Reconciling quarantine: $demoted_active_id -> $quarantine_target_id..."
                    if [[ -d "$releases_dir/$quarantine_target_id" && ! -d "$releases_dir/$demoted_active_id" ]]; then
                        log_info "Quarantine rename previously completed ($quarantine_target_id exists)."
                    elif [[ -d "$releases_dir/$quarantine_target_id" && -d "$releases_dir/$demoted_active_id" ]]; then
                        halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Quarantine destination collision: '$quarantine_target_id' already exists while source '$demoted_active_id' remains"
                    elif [[ -d "$releases_dir/$demoted_active_id" ]]; then
                        local c_chk="none"
                        local p_chk="none"
                        if [[ -L "$profile_dir/current" ]]; then
                            c_chk=$(basename "$(cfs readlink "$profile_dir" "current")")
                        fi
                        if [[ -L "$profile_dir/previous" ]]; then
                            p_chk=$(basename "$(cfs readlink "$profile_dir" "previous")")
                        fi
                        if [[ "$c_chk" == "$demoted_active_id" || "$p_chk" == "$demoted_active_id" ]]; then
                            halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Safety assertion failed: referenced release cannot be quarantined"
                        fi
                        cfs rename "$releases_dir" "$demoted_active_id" "$releases_dir" "$quarantine_target_id"
                    else
                        halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Demoted active release '$demoted_active_id' missing on disk"
                    fi
                fi

                # 4. Reconcile verification
                tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_VERIFYING",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "expected_previous_target": sys.argv[5],
    "quarantine_demoted": sys.argv[6] == "true",
    "quarantine_target_id": sys.argv[7]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$target_restore_id" "$prev_target" "$quarantine_demoted" "$quarantine_target_id")
                write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

                log_info "Verifying restored release health at current ($target_restore_id)..."
                if ! verify_release_health "$profile_dir/current"; then
                    log_fatal "EMERGENCY: Restored rollback release failed health checks! Double-fault detected."
                    archive_transaction_failure "$profile_dir" "$tmp_dir" "$tx_id" "ROLLBACK_VERIFYING" "Double fault on restored release during recovery"
                    exit "$EXIT_ERROR"
                fi

                # 5. Reconcile commit to ledger
                tx_payload=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "transaction_id": sys.argv[1],
    "phase": "ROLLBACK_COMMITTING",
    "profile": sys.argv[2],
    "demoted_active_id": sys.argv[3],
    "target_restore_id": sys.argv[4],
    "quarantine_target_id": sys.argv[5]
}
print(json.dumps(data, indent=2))
' "$tx_id" "$profile" "$demoted_active_id" "$target_restore_id" "$quarantine_target_id")
                write_transaction_state "$profile_dir" "$tmp_dir" "$tx_payload"

                local ledger_entry
                ledger_entry=$(python3 -c '
import sys, json
data = {
    "action": "rollback",
    "restored_release_id": sys.argv[1],
    "demoted_release_id": sys.argv[2],
    "transaction_id": sys.argv[3],
    "quarantined": sys.argv[4] == "true",
    "timestamp_utc": sys.argv[5]
}
print(json.dumps(data))
' "$target_restore_id" "$demoted_active_id" "$tx_id" "$quarantine_demoted" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")
                append_ledger "$profile_dir" "$tmp_dir" "$ledger_entry"

                # 6. Archive transaction to terminal state
                cfs rename "$profile_dir" ".transaction.json" "$profile_dir" ".transaction.last.json"
                log_info "Rollback recovery for profile '$profile' successfully completed! Transaction archived."
                ;;

            *)
                halt_on_ambiguous_artifacts "$profile_dir" "$tmp_dir" "$tx_id" "Unrecognized rollback phase '$phase'"
                ;;
        esac
    fi

    log_info "Reconciliation routine complete."
}

# ------------------------------------------------------------------------------
# Command: Status
# ------------------------------------------------------------------------------
cmd_status() {
    local profile="$1"
    local releases_root="$2"

    preflight_environment "$releases_root"

    local profile_dir="$releases_root/$profile"
    if [[ ! -d "$profile_dir" ]]; then
        log_warn "Profile directory does not exist: $profile_dir"
        return 0
    fi

    printf "\n=======================================================\n"
    printf " Linkx Release Status: Profile '%s'\n" "$profile"
    printf "=======================================================\n"

    # Current release
    if [[ -L "$profile_dir/current" ]]; then
        local cur_target
        cur_target=$(cfs readlink "$profile_dir" "current")
        printf " Active Release (current)  : %s\n" "$cur_target"
    else
        printf " Active Release (current)  : NONE\n"
    fi

    # Previous release
    if [[ -L "$profile_dir/previous" ]]; then
        local prev_target
        prev_target=$(cfs readlink "$profile_dir" "previous")
        printf " Prior Release (previous) : %s\n" "$prev_target"
    else
        printf " Prior Release (previous) : NONE\n"
    fi

    # In-flight transaction
    if [[ -f "$profile_dir/.transaction.json" ]]; then
        printf " In-Flight Transaction     : ACTIVE (.transaction.json present)\n"
    else
        printf " In-Flight Transaction     : None (Steady State)\n"
    fi

    # Historical releases
    local releases_dir="$profile_dir/releases"
    if [[ -d "$releases_dir" ]]; then
        printf "\n Available Releases in Store:\n"
        find "$releases_dir" -mindepth 1 -maxdepth 1 -type d -printf "   • %f\n" | sort -r
    fi
    printf "=======================================================\n\n"
}

# ------------------------------------------------------------------------------
# Main Entry Point & Argument Dispatcher
# ------------------------------------------------------------------------------
main() {
    local cmd="${1:-}"
    shift || true

    local profile=""
    local releases_root="$DEFAULT_RELEASES_ROOT"
    local allow_dirty="false"
    local env_file=""
    local staging_only="false"
    local dry_run="false"
    local quarantine="false"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            cdr|nbe)
                profile="$1"
                shift
                ;;
            --fixture-root|--releases-root)
                releases_root="$2"
                shift 2
                ;;
            --allow-dirty)
                allow_dirty="true"
                shift
                ;;
            --env-file)
                env_file="$2"
                shift 2
                ;;
            --staging-only)
                staging_only="true"
                shift
                ;;
            --dry-run)
                dry_run="true"
                shift
                ;;
            --quarantine)
                quarantine="true"
                shift
                ;;
            -h|--help)
                printf "Usage: %s <deploy|rollback|reconcile|status> <cdr|nbe> [options]\n" "$0"
                printf "Options:\n"
                printf "  --fixture-root <path>  Override releases root (used for isolated test fixtures)\n"
                printf "  --env-file <path>      Specify custom environment configuration file\n"
                printf "  --allow-dirty          Allow tracked line-ending diffs in preserved bundles\n"
                printf "  --staging-only         Assemble release in staging directory without promotion\n"
                printf "  --dry-run              Simulate operations without executing mutations\n"
                printf "  --quarantine           Quarantine demoted release on rollback\n"
                exit 0
                ;;
            *)
                log_fatal "Unknown argument: $1"
                exit "$EXIT_ERROR"
                ;;
        esac
    done

    case "$cmd" in
        deploy)
            if [[ -z "$profile" ]]; then
                log_fatal "Profile ('cdr' or 'nbe') required for deploy."
                exit "$EXIT_ERROR"
            fi
            cmd_deploy "$profile" "$releases_root" "$allow_dirty" "$env_file" "$staging_only" "$dry_run"
            ;;
        rollback)
            if [[ -z "$profile" ]]; then
                log_fatal "Profile ('cdr' or 'nbe') required for rollback."
                exit "$EXIT_ERROR"
            fi
            cmd_rollback "$profile" "$releases_root" "$quarantine" "$dry_run"
            ;;
        reconcile)
            if [[ -z "$profile" ]]; then
                log_fatal "Profile ('cdr' or 'nbe') required for reconcile."
                exit "$EXIT_ERROR"
            fi
            cmd_reconcile "$profile" "$releases_root"
            ;;
        status)
            profile="${profile:-nbe}"
            cmd_status "$profile" "$releases_root"
            ;;
        *)
            printf "Usage: %s <deploy|rollback|reconcile|status> <cdr|nbe> [options]\n" "$0"
            exit "$EXIT_ERROR"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
