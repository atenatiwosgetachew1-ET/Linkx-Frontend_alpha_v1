# Frontend hardening plan: Source, Settings and Configuration windows

**Date:** 2026-11-13. This plan comes from a three-part review covering the Source window, Settings + Configuration, and theme/CSS.

**How to run it:**
- **One phase at a time.** Each phase ends with lint, build and a manual check in the browser.
- **Backend dependencies:** items that need the backend are marked **[needs B-n]**; see `backend-requests.md`. Until the backend ships, the frontend keeps a safe interim behaviour.

---

## Phase 1: Wrong-behaviour bugs (small, contained)

**Status:** ✅ done on 2026-11-13. Lint and build pass; awaiting a manual check in the browser.

**Goal:** nothing in the three windows does the wrong thing.

| # | Fix | Files |
|---|---|---|
| 1.1 | Remove the global `window.confirm` override (it always returns `false`). Use `await requestConfirmation(...)` for the domain switch with unsaved edits, queue cleanup, delete user and service-account actions. | `NotificationContext.jsx`, `ConfigurationWindowBody.jsx`, `ActivityLogPanel.jsx`, `SettingsWindowBody.jsx`, `ServiceAccountsPanel.jsx` |
| 1.2 | Give each window its own upload input id (`useId`), so files never go to another Source window's session. | `SourceWindowBody.jsx` |
| 1.3 | Take `buildSourcePayload` `addressType` from its `state` argument (the domain-reconnect bug). | `SourceWindowBody.jsx` |
| 1.4 | Disable "Use Default" in the Storage step while busy or connected. | `SourceWindowBody.jsx` |
| 1.5 | Fix the global button rule so disabled and danger `.settings_button`s look disabled or destructive, and add hover. | `main.css` |
| 1.6 | Use the same radio-group name per window (`windowId`) for Elastic strict/fuzzy, so windows don't collide. | `SourceWindowBody.jsx` |

**Done when:** in the browser, domain switch with unsaved edits asks for confirmation and proceeds; queue cleanup works; uploads in two windows stay separate; disabled and danger buttons look right.

---

## Phase 2: Source window state integrity

**Status:** ✅ done on 2026-11-13. Lint and build pass; awaiting a manual check in the browser.

**Goal:** the window can't send requests that don't match its UI.

| # | Fix |
|---|---|
| 2.1 | Separate the connection state per connection type (upload / storage / broker / search share storage). Switching type disconnects or resets as needed. Readiness: upload requires staged files, broker requires a broker connection. **[backend guard: B-5]** |
| 2.2 | Make Cancel roll back every mode with a running request, and give each mode its own AbortController, so a domain reconnect never leaves the other mode stuck. |
| 2.3 | Pass `signal` to the domain switch. If its reply arrives after a cancel, still apply it, or reload the configuration, so the UI never shows a different domain from the backend. **[real cancel: B-7]** |
| 2.4 | Add a generation counter to both searches. Disconnect, a search-setup change or a domain change drops late "Load more" replies. Disable Connect/Disconnect while a search page is loading. |
| 2.5 | Track the raw `nextOffset` for paging (interim), and switch to the backend's `next_offset` when available. **[B-8]** |
| 2.6 | Route autofill through `updateSourceState` (the ref-safe path), and refresh the tool and broker defaults after a domain switch. |
| 2.7 | Show each error in one place only: inline for validation, a notification for async results. Tool errors are no longer shown three times. |

---

## Phase 3: Settings and Configuration correctness

**Status:** ✅ done on 2026-11-13. Lint and build pass; awaiting a manual check in the browser. This phase also covered parts of 4.1 (no passwords in persisted Users UI state) and 4.2 (role allow-list, no admin bypass for `superuser:manage`).

| # | Fix |
|---|---|
| 3.1 | Users: edit `roles` as a list (no more collapsing to one role). Reset drafts from the server on load and on Cancel. Rows show saved values plus a "modified" marker. |
| 3.2 | Configuration: replace the delayed `setTimeout(reload)` with an awaited reload that never overwrites a dirty draft. When a save returns no configuration, update the session configuration from the saved payload. **[B-10 removes the need]** |
| 3.3 | Reset needs `config:write` and asks for confirmation when there are unsaved edits. Import also asks when there are unsaved edits. |
| 3.4 | Detection sensitivity: if the load fails, show an error state and disable Save, so defaults never overwrite server values. |
| 3.5 | `withFallback` falls back only on 404/405 and only for GETs. Service-account `config` falls back only on an explicit `unknown_field` code, and never PUT-on-404. **[B-9 removes the fallbacks]** |
| 3.6 | Add one shared `useCan()` permission hook with a documented permission per action. Pass `canWrite` to every Configuration field and to the idle policy. Classified entities use `config:write` instead of the admin role. |
| 3.7 | Mark mutating busy actions as non-cancellable (save, switch, remove), or reload after an abort, so "Cancelled" never hides a change already committed on the server. |
| 3.8 | LXAC: don't trim the password on either side, and add a minimum-strength hint for export. **[B-17]** |
| 3.9 | Vigilance: pause polling when the window is hidden or inactive, chain timeouts instead of `setInterval`, and skip unchanged payloads. **[B-14]** |

---

## Phase 4: Security hardening

**Status:** ✅ done on 2026-11-13. Lint and build pass; awaiting a manual check in the browser.

**Deferred: whitespace in `sanitizeSecret` (part of 4.7).** The production login and user-creation paths strip all whitespace from passwords, so existing accounts were stored without spaces. Keeping spaces only in incubation would break those logins. Change it in both apps together, ideally with the backend defining the password policy.

| # | Fix |
|---|---|
| 4.1 | Move passwords out of workspace window state. The Source tool password and the Users create/reset passwords live in component refs or local state, are never persisted in UI state, and are cleared on failure, unmount and close. |
| 4.2 | Users: build an allow-list of roles from the actor's capabilities, drop the admin bypass for `superuser:manage`, and block self-deactivation and self-de-permissioning in the UI. **[authoritative: B-1]** |
| 4.3 | Service-account `auth_token`: show "set / not set". Send it only when edited, never send the mask, and offer an explicit "Clear". **[B-2]** |
| 4.4 | Masked tool password field: show it empty with a "saved" placeholder plus a "Clear password" action. Typing never appends to `***`. |
| 4.5 | Sanitise all backend text shown to users. Non-JSON bodies are never used as messages, and network errors map to a fixed string. Search diagnostics are hidden from non-admins. **[B-6]** |
| 4.6 | Client secret generation fails closed if crypto is unavailable. Use the backend secret generation once it exists. **[B-3]** |
| 4.7 | Set `autoComplete="off"` / `"new-password"` on the create-user and credential fields. `sanitizeSecret` strips only control characters, not spaces. |

---

## Phase 5: Theme, accessibility and visual consistency

**Status:** ✅ done on 2026-11-13. Lint and build pass; awaiting a visual check in Daylight plus one dark theme.

| # | Fix |
|---|---|
| 5.1 | Replace the hard-coded status colours, dialog backdrop and shadow with semantic tokens (`--linkx-success-*`, `--linkx-danger-*`, `--linkx-overlay-bg`). The loader uses `--settings-accent`. |
| 5.2 | Add danger and success tokens to the cyberpunk, emerald-dark, solarized-dark and nbe-darknight themes. |
| 5.3 | Contrast: add an `--settings-accent-text` token for gold text. Darken the muted text token. Raise the opacity of the loader's Cancel link. Fix the white-on-colour vigilance status pills. |
| 5.4 | Add focus-visible and hover patterns to every new control, a 24px minimum hit area for "×" buttons, a focus ring for the search inputs, and disabled styles for `.settings_input`. |
| 5.5 | Build one shared modal primitive (focus trap, focus restore, labelled title, a single Escape stack) and use it for LXAC, rewind and error-trace. The load-screen overlay makes the content behind it `inert` and focuses Cancel. |
| 5.6 | Add type-scale tokens (11/12/13/15), set the Storage toolbar to 12px, and add radius tokens. |
| 5.7 | Add a responsive Storage/Elastic toolbar using a container query (wraps to two columns). |
| 5.8 | Register the theme-picker categories `configuration_window` and `settings_status`, and sync their defaults with Daylight. |
| 5.9 | Accessibility labels: aria-label on the search inputs, `role="alert"` / `aria-live` on validation messages, `aria-hidden` lock icons (no emoji inside labels), keyboard-accessible vigilance rows. |

---

## Phase 6: Structure and maintainability

**Status:** ✅ done on 2026-11-13 (core). Lint and build pass; awaiting a manual check in the browser.
- **Remaining 1 — further Source split:** pulling `useSourceConnection` / `useDataframePipeline` / `useDomainReconnect` out of `SourceWindowBody.jsx` (now about 1,180 lines). It's riskier without tests, so it waits for the Phase 7 test setup.
- **Remaining 2 — notification helper:** a shared notification-message helper.
- **Remaining 3 — dead preference toggles:** "Remember layout" and "Enable notifications" need a product decision: wire them up or remove them.

| # | Fix |
|---|---|
| 6.1 | Split `SourceWindowBody.jsx` (about 3,200 lines) into:<br>• `sourceStateModel.js` (defaults, readiness, blockers, steps)<br>• `icons.jsx`<br>• `steps/*.jsx`<br>• `useSourceConnection`, `useDataframePipeline`, `useDomainReconnect`, `usePagedSearch`<br>The reducer imports the single `defaultSourceState`. |
| 6.2 | Use one `<SearchResultBrowser>` and one paged-search runner for both Storage and Elastic. |
| 6.3 | Split `SettingsWindowBody.jsx` into `panels/*.jsx` and `theme/ThemeStudio.jsx`. Persist UI state debounced and without secrets. |
| 6.4 | Move `Section`, `Field` and `OptionField` to `shared/components/form/` (labelled). Add one permission catalog module and one notification-message helper (consistent `source` and level). |
| 6.5 | Fix re-renders: memoise `mergeSourceState`, make `patchModeState` and the handlers stable, keep draft text local and commit it on blur. |
| 6.6 | Remove dead code:<br>• the `'pending'` dataframe flow<br>• unused state fields<br>• `ConnectStep`<br>• the duplicate `formatBytes`<br>• the unused `upload` slice<br>• the unused `getActiveJob` path<br>• the old demo CSS (`.config_form/section/grid/...`)<br>• the duplicate `.settings_window_body` / `.settings_button` blocks<br>• the dead preference toggles (wire them up or remove them) |
| 6.7 | Split `main.css` into `styles/features/{source,settings,configuration,loader}.css`, and reduce `!important` in the new blocks. |
| 6.8 | Fix the abort-listener leak in `jobs.js` `delay`. |

---

## Phase 7: Quality and readiness

**Status:** 7.1–7.3 ✅ done on 2026-11-13.
- **7.1 Tests:** Vitest with 45 unit tests, run with `npm test`.
- **7.2 Logger:** `shared/logger.js`.
- **7.3 Translation scaffold:** `shared/i18n` (`t` / `tn`). The first plural strings are converted.

7.4 (streaming) ✅ done on 2026-11-13.
- **Requests:** start (`/live_batch_files {id:'stream'}`) with queued-job follow-up, and Terminate (`end_session`).
- **Live log:** the `log_stream_plug` / `stream_logs` / `unplug` socket protocol, buffered in `features/source/lib/streamLogs.js`.
- **Realtime guard:** credentials are saved to the source session.
- **Show results:** opens a Graph window carrying `graphLinkSource`. The `/graph_link` call belongs to the Graph window port.
- **Pending:** confirmation of the contract (B-18). 7.5 follows as the backend items land.

| # | Fix |
|---|---|
| 7.1 | Set up Vitest and unit tests for the readiness, blockers, accessible steps and payload builders, plus `configModel` and `serviceAccounts`. Add component tests for cancel/abort and the domain reconnect. |
| 7.2 | Add a shared logger with a level switch to replace `console.error`. |
| 7.3 | Scaffold i18n: a string catalog, `t()` and `Intl.PluralRules` for counts. Read status from backend `code`s instead of English text. **[B-6]** |
| 7.4 | Wire streaming (stream / end_session / logs / graph_link / close window), or feature-flag it until wired. **[B-18]** |
| 7.5 | Adopt the backend features as they land: job cancel (B-7), socket configuration and connection events (B-11), connection status resync (B-12), version/409 handling (B-4), audit request ids (B-13). |

---

### Suggested sequencing
- **Phases 1–3** before anything else; these are correctness.
- **Phase 4** next; it is security.
- **Phases 5 and 6** can be interleaved. Doing 6.1–6.4 before 5.5 makes the shared modal easier.
- **Phase 7** runs continuously. Its tests are most valuable right after Phase 6.
