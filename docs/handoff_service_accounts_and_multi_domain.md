# Linkx Service Accounts, Multi-Domain & System Principal Protection — Handoff Document

**Document Version:** 2.0  
**Date:** 2026-10-21  
**Scope:** Service Account Management, Custom Storage Schemas, Protected System Daemons, Multi-Domain Routing, CDR Telecom Alignment & Deployment

---

## 1. Overview & Context

This handoff document details the implementation of **Service Account Management**, **Custom Storage & Domain Schema Mappings**, **Protected System Principal Security**, and the enterprise **CDR (Call Data Records) Telecom Domain Alignment** within the Linkx frontend.

All features are integrated into the unified production codebase (`/var/www/linkx-frontend`), supporting interchangeable build profiles:
* **BDR Banking Profile** (`npm run build`, `VITE_THEME=nbe`) ➔ Standard banking schema, AML detection thresholds, currency metrics in Birr.
* **CDR Telecom Profile** (`npm run build:cdr`, `VITE_THEME=cdr`) ➔ Telecom terminology (MSISDN, Duration, Towers), 18 telecom detection thresholds, 17 fraud typologies, duration volume tiers, and emergency hotline whitelists.

---

## 2. Features Delivered

### A. Advanced Storage Target & Custom Schema Overrides
Service accounts support custom Elasticsearch storage overrides and projection schemas directly within their `config` object:

1. **Storage Target Coordinates**:
   - `storage_host`: Hostname or IP address of the Elasticsearch search node.
   - `storage_port`: Port number (defaults to `5000`).
   - `storage_endpoint`: Search API endpoint path (e.g. `api/search/uii`).
   - `auth_token`: Optional bearer or API token.
2. **Domain / Institution Radio Pills (`DomainSelector`)**:
   - Replaced legacy select boxes with responsive, themed radio pill cards displaying domain badges and schema descriptions.
   - Supported domains:
     - **Bank**: Standard banking schema (`ACCOUNTNO`, `BENACCOUNTNO`, `AMOUNTINBIRR`).
     - **Microfinance**: Micro-loans schema (`SENDERACCOUNTID`, `RECEIVERACCOUNTID`, `TRANSFERAMOUNT`).
     - **Insurance**: Policy & claims payouts (`POLICY_NO`, `CLAIM_ID`, `CLAIM_AMOUNT`).
     - **CDR**: Call Detail Records (`CALLER_MSISDN`, `CALLEE_MSISDN`, `DURATION_SEC`).
     - **Telecom**: Telecommunications subscriber schema.
     - **Fintech**: E-wallets & payment gateways (`PAYER_WALLET`, `PAYEE_WALLET`).
     - **Enterprise**: Corporate ERP & ledger (`DEBTOR_ID`, `CREDITOR_ID`).
3. **Fetch Columns (`fetch_columns`)**:
   - Dynamic tag/chip input allowing comma or Enter-separated column tokens (trimmed uppercase strings).
   - Empty state falls back to domain built-in default columns.
4. **Canonical Column Mapping (`column_mapping`)**:
   - Dynamic Key-Value pair list with interactive row removal and `+ Add Mapping Pair` action.
   - In CDR mode, targets display telecom canonical names (`CALLING_NO`, `CALLED_NO`, `DURATION`, `START_TIME`, `RECORD_ID`).
   - In Banking mode, targets display financial canonical names (`ACCOUNTNO`, `BENACCOUNTNO`, `AMOUNTINBIRR`, `TRANSACTIONDATE`, `TRANSACTIONID`).
5. **Template Pre-fill Shortcut**:
   - Dedicated `⚡ Load Template for [Domain]` button that automatically populates fetch columns and mappings with domain recommended defaults.

---

### B. CDR Telecom Intelligence Alignment (Interchangeable Build Profile)

When `theme.id === "cdr"` (via `VITE_THEME=cdr`), the UI switches from financial to telecom mode:

#### 1. Terminology Migration & Currency Suppression
* **Node & Edge Properties Inspection**:
  * `ACCOUNTNO` ➔ `Calling Number (MSISDN)`
  * `BENACCOUNTNO` ➔ `Called Number (Destination)`
  * `AMOUNTINBIRR` / `DURATION` ➔ `Call Duration` formatted as `120 sec (2m 0s)`
  * `TRANSACTIONDATE` ➔ `Call Start Time`
  * `BRANCH` / `LOCATION_ID` ➔ `Cell Tower ID / Location`
  * `HIGH_RISK_COUNTERPARTY` ➔ `High Risk Contact / Watchlist`
* **Dataframe Flow**: Selects `Calling Number` / `Called Number` with `CALLED` relationship placeholder.
* **Strict Currency Suppression**: In CDR mode, all currency symbols (`ETB`, `Birr`, `$`) are stripped from values and headers.

#### 2. CDR Detection Thresholds Screen (`RuleThresholdsPanel`)
Replaces banking AML thresholds with **18 telecom parameters** across 4 fieldsets:
* **Call Patterns & Relays**:
  * `frequent_contact_min_calls`: Min Frequent Call Count (`5 calls`)
  * `call_sequence_max_gap_seconds`: Max Gap Between Sequential Calls (`300 sec`)
  * `callback_max_gap_seconds`: Max Callback Window (`86400 sec / 24 hrs`)
  * `call_relay_max_gap_seconds`: Max Relay Window (`1800 sec / 30 min`)
  * `simultaneous_call_window_seconds`: Max Multi-Call Window (`15 sec`)
* **Durations & Night Activity**:
  * `short_duration_burst_seconds`: Burst Duration Threshold (`15 sec`)
  * `short_duration_burst_min_calls`: Min Burst Call Count (`3 calls`)
  * `long_duration_call_seconds`: Long Call Duration (`1800 sec / 30 min`)
  * `night_activity_start`: Night Window Start (`2300` / 23:00)
  * `night_activity_end`: Night Window End (`0500` / 05:00)
* **Network Dispersion & Towers**:
  * `star_pattern_min_contacts`: Star Hub Min Contacts (`5 distinct numbers`)
  * `fan_out_min_targets`: Min Fan-Out Outbound Numbers (`15 targets`)
  * `fan_in_min_sources`: Min Fan-In Inbound Callers (`15 sources`)
  * `location_jump_max_hours`: Max Hours for Cell Tower Jump (`2 hrs`)
* **Telecom Fraud & Telephony Exploits**:
  * `sim_box_min_calls`: SIM Box Min Outbound Calls (`10 calls`)
  * `sim_box_max_avg_duration`: SIM Box Max Avg Duration (`15 sec`)
  * `imei_swap_min_devices`: IMEI Swap Min Distinct Handsets (`3 devices`)
  * `wangiri_max_duration_seconds`: Wangiri Missed Call Max Ring (`3 sec`)
  * `wangiri_min_calls`: Wangiri Min Victim Calls (`3 calls`)
* **Direct Domain Endpoint**: Interacts directly with `/rule-thresholds?domain_id=cdr` (fallback to `/rule-thresholds`). Score Lineage interacts with `/config/score-lineage?domain_id=cdr` (fallback to `/config/score-lineage`). Prevents 404 errors from unmapped `/api/v1/rules/*` paths.

#### 3. CDR Risk Scoring & Typology Lineage (`ScoreLineagePanel`)
* **17 Telecom Typologies Grouped by Severity**:
  * 🚨 **Severe Telecom Fraud (35 - 50)**: `HIGH_RISK_CONTACT` (50), `SIM_BOX_DISTRIBUTION` (45), `WANGIRI_FRAUD` (40), `IMEI_SWAP_DETECTION` (35)
  * ⚡ **High-Risk Coordination (25 - 30)**: `STAR_PATTERN` (30), `SHORT_DURATION_BURST` (25), `LOCATION_JUMP` (25), `CALL_RELAY` (25)
  * 📡 **Anomalous Behavioral Signals (10 - 20)**: `SIMULTANEOUS_CALL` (20), `NIGHT_ACTIVITY` (20), `FREQUENT_CONTACT` (15), `CALLBACK_PATTERN` (15), `CALL_SEQUENCE` (10), `FAN_OUT` (10), `FAN_IN` (10), `MISSED_CALL_SIGNAL` (10), `LONG_DURATION_CALL` (10)
* **Cumulative Duration Volume Score Tiers** (replaces financial amount multipliers):
  * $\ge 7,200\text{ sec}$ (2 hrs) ➔ `+30 points`
  * $\ge 3,600\text{ sec}$ (1 hr) ➔ `+20 points`
  * $\ge 900\text{ sec}$ (15 min) ➔ `+10 points`
  * $\ge 300\text{ sec}$ (5 min) ➔ `+5 points`

#### 4. Classified Entities (Emergency Whitelists & Watchlists)
* Added **`⚡ Load Telecom Emergency Presets`** button to quickly register emergency service hotlines (`911`, `994`, `991`, `980`) with `Pass Through = true`.
* Added telecom datalist options: `Emergency / Service Hotlines`, `SIM_BOX`, `WANGIRI`, `HIGH_RISK`.
* Telecom table headers: `Subscriber / Contact Name`, `Identifier (MSISDN)`, `Phone / Contact Number`, `Telecom Classification`, `Pass Through (Suppress Alerts)`.

---

### C. Protected System Principal Security (xVigilance & Platform Daemons)
The backend designates internal platform daemons (such as `xvigilance`, ID `999`) as **Protected System Service Accounts** with `is_system: true`:

1. **Distinctive System Badge**: Accounts with `is_system === true` display `🛡 System` badge.
2. **Delete Protection**: Delete button permanently disabled with tooltip explanation. Client guard rejects deletion.
3. **Locked Active Status**: Status locked to `🔒 Active (Locked)`. Deactivation toggles disabled.
4. **Editable Coordinates & Rotation**: Admins can update storage coordinates, domain routing, and rotate secrets dynamically.

---

### D. Automated Zero-Config Deployment & Runtime Host Guard

To prevent multi-server deployment failures and cross-origin CORS errors:

1. **Smart Host Guard (`resolveApiUrl`)**:
   * If a bundle is loaded on a host that differs from the statically baked build URL (e.g. loaded on `172.21.13.73` but built with `172.27.23.21`), the client **automatically overrides the target with `window.location.origin`**.
   * Completely prevents `ERR_CERT_AUTHORITY_INVALID` and CORS preflight block errors.
2. **Automated Deploy Script ([`deploy.sh`](file:///var/www/linkx-frontend/deploy.sh))**:
   * Run as `node18` on any target host: `./deploy.sh [all|cdr|nbe]`.
   * Automatically takes ownership (`chown`), syncs git cleanly (`fetch + reset --hard`), detects `172.21.13.73` host to apply its `.env`, builds the theme bundle, and restores `www-data` ownership.

---

## 3. Multi-Server Build & Deployment Workflow

### Build Targets

| Host Server | Deployment Path | Theme (`VITE_THEME`) | Profile | Build Command |
|-------------|-----------------|---------------------|---------|---------------|
| `172.27.23.21` (NBE Host) | `/linkxDS2026/` | `nbe` | Banking (BDR) | `npm run build` |
| `172.27.23.21` (Local CDR) | `/linkxCDR2026/` | `cdr` | Telecom (CDR) | `npm run build:cdr` |
| `172.21.13.73` (Remote CDR) | `/linkxCDR2026/` | `cdr` | Telecom (CDR) | `npm run build:cdr` (or `./deploy.sh cdr`) |

### Deploying to Remote CDR (`172.21.13.73`) via `deploy.sh`
Run on `node18@node18` on the remote server:
```bash
cd /var/www/linkx-frontend
./deploy.sh cdr
```
*(Or `bash deploy.sh cdr`)*

---

## 4. Key Source Code References

- **Theme Resolver & Profile Detection**: [`src/themes/index.js`](file:///var/www/linkx-frontend/src/themes/index.js) and `isCdrDomain` in [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L90)
- **Domain Terminology & Formatter**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L92-L130)
- **Canonical Columns (Banking vs CDR)**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L3960-L3985)
- **CDR Detection Thresholds (`RuleThresholdsPanel`)**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L17840-L18145)
- **CDR Score Lineage & Typologies (`ScoreLineagePanel`)**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L17678-L17838)
- **Classified Entities Telecom Whitelist/Watchlist**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L1765-L1880)
- **Runtime Host Guard (`resolveApiUrl`)**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L71-L88)
- **Automated Deployment Script**: [`deploy.sh`](file:///var/www/linkx-frontend/deploy.sh)
- **Remote Host Config**: [`deploy_pkg_172.21.13.73/.env`](file:///var/www/linkx-frontend/deploy_pkg_172.21.13.73/.env)
