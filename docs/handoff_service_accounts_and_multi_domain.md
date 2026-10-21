# Linkx Service Accounts, Multi-Domain & System Principal Protection — Handoff Document

**Document Version:** 1.0  
**Date:** 2026-10-21  
**Scope:** Service Account Management, Custom Storage Schemas, Protected System Daemons, Multi-Domain Routing & Deployment

---

## 1. Overview & Context

This handoff document details the implementation of **Service Account Management**, **Custom Storage & Domain Schema Mappings**, and **Protected System Principal Security** within the Linkx frontend, along with multi-server build and deployment considerations across domains (BDR, CDR, Insurance, etc.).

All features were integrated into the unified production codebase (`/var/www/linkx-frontend`), supporting both the default golden bank theme (`linkxDS2026`) and the sky-blue CDR theme (`linkxCDR2026`).

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
   - Maps raw Elasticsearch source columns to LinkX canonical target fields:
     - `ACCOUNTNO` (Source Account / Sender / Policy No)
     - `BENACCOUNTNO` (Destination Account / Receiver / Claimant)
     - `AMOUNTINBIRR` (Transaction Amount / Claim Amount)
     - `TRANSACTIONDATE` (Timestamp / Date)
     - `TRANSACTIONID` (Unique Transaction ID / Claim ID)
     - `ACCOWNERNAME` (Sender / Insured Name)
     - `BENFULLNAME` (Beneficiary / Claimant Name)
5. **Template Pre-fill Shortcut**:
   - Dedicated `⚡ Load Template for [Domain]` button that automatically populates fetch columns and mappings with domain recommended defaults.

---

### B. Protected System Principal Security (xVigilance & Platform Daemons)
The backend designates internal platform daemons (such as `xvigilance`, ID `999`) as **Protected System Service Accounts** with `is_system: true`. The frontend enforces strict safeguards:

1. **Distinctive System Badge**:
   - Accounts with `is_system === true` display a gradient violet/blue pill badge: `🛡 System` next to the client ID.
2. **Delete Protection**:
   - The Delete button is permanently disabled (`opacity: 0.45; cursor: not-allowed;`) with tooltip: `"System service accounts cannot be deleted."`.
   - Client-side validation guard in `deleteAccount()` blocks deletion attempts before any network call.
3. **Locked Active Status**:
   - Status is locked permanently to `🔒 Active (Locked)`. Deactivation toggles are disabled with explanatory tooltips.
   - `saveAccount()` never passes `is_active: false` for system principals.
4. **Editable Config Settings & Secret Rotation**:
   - Admins can freely update Elasticsearch coordinates, domain routing, and column mappings in the drawer.
   - Runtime changes dynamically synchronize to the daemon engine on Server 4 without process restarts.
   - Secret rotation remains fully enabled.

---

### C. UI & Styling Alignment
1. **Expandable Fieldsets**:
   - "Create User" and "Create Service Account" fieldsets are collapsible with an arrow-only badge toggle (`▲` when expanded, `▼` when collapsed).
   - Collapsed state displays a summary bar with a `▼ Expand Form` call-to-action button.
   - Collapse button height inside action bars matches sibling `.action_btns` (`height: 3.2vh; min-height: 30px;`).
2. **Modal & Container Constraints**:
   - `.configurations_tab_form`: Border `1px solid #e7e7e7`, border-radius `5px`, margin-bottom `2vh`, padding `1vh 1vw`.
   - Modals and settings containers constrained to `max-height: 99vh; top: 1.5vh;`.

---

## 3. Multi-Server Build & Deployment Workflow

### Build Targets & Environment Configuration
Vite bakes `VITE_API_URL` and `VITE_THEME` into JavaScript bundles at build time.

| Host Server | Deployment Path | Theme (`VITE_THEME`) | API Target (`VITE_API_URL`) | Build Command |
|-------------|-----------------|---------------------|----------------------------|---------------|
| `172.27.23.21` (NBE Host) | `/linkxDS2026/` | `nbe` | `https://172.27.23.21` | `npm run build` |
| `172.27.23.21` (Local CDR) | `/linkxCDR2026/` | `cdr` | `https://172.27.23.21` | `npm run build:cdr` |
| `172.21.13.73` (Remote CDR) | `/linkxCDR2026/` | `cdr` | `https://172.21.13.73` | `npm run build:cdr` (with target `.env`) |

### Deploying via Git to Remote CDR (`172.21.13.73`)
When deploying to `172.21.13.73` via Git:
```bash
cd /var/www/linkx-frontend

# 1. Ensure node18 owns directory before git operations:
sudo chown -R node18:node18 /var/www/linkx-frontend

# 2. Sync to latest origin/main:
git fetch origin main
git reset --hard origin/main

# 3. Ensure .env points to local server IP (prevents ERR_CERT_AUTHORITY_INVALID):
cp deploy_pkg_172.21.13.73/.env .env

# 4. Compile the CDR theme:
npm run build:cdr

# 5. Restore Nginx read permissions:
sudo chown -R www-data:www-data linkxCDR2026
```

---

## 4. Key Source Code References

- **Domain Constants & Schema Templates**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L3880-L4040)
- **Domain Selector Radio Pills**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L4110-L4155)
- **Storage Target & Column Mapping Editor**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L4160-L4490)
- **Service Accounts Management Panel**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L5230-L5890)
- **Protected System Principal Badges & Styles**: [`src/main.css`](file:///var/www/linkx-frontend/src/main.css#L8325-L8370) and [`src/main.css`](file:///var/www/linkx-frontend/src/main.css#L8890-L8915)
- **Expandable Form & Action Bar Styles**: [`src/main.css`](file:///var/www/linkx-frontend/src/main.css#L7410-L7470) and [`src/main.css`](file:///var/www/linkx-frontend/src/main.css#L8050-L8070)
- **Standalone Remote Package Config**: [`deploy_pkg_172.21.13.73/.env`](file:///var/www/linkx-frontend/deploy_pkg_172.21.13.73/.env)
