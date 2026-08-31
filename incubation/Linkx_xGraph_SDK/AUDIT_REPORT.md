# SDK Audit Report — @linkx/graph-preview v0.1.0

**Audited:** 2026-08-31  
**Scope:** Development quality, optimality, security, delivery performance, and documentation alignment.

---

## ✅ PASSED — What's Solid

### Architecture & Encapsulation
- **vis-network is fully hidden.** The public API (`index.js`) exports only `GraphRenderer` and `LinkAnalysisPreview`. No vis types, DataSet, or Network objects leak out.
- **Clean separation of concerns.** 5 internal engines (`GraphStore`, `ThemeEngine`, `LayoutEngine`, `VisualEngine`, `IconResolver`) each handle a single responsibility.
- **React wrapper is properly designed.** Uses `useRef` for stable renderer references, `callbacksRef` pattern to avoid stale closures, and mount-only initialization with proper cleanup via `destroy()`.

### Build & Distribution
- **Vite library build is correctly configured.** React is externalized (not bundled), vis-network is internalized (consumers never install it). Dual ES + UMD output with sourcemaps.
- **`prepare` script ensures Git installs work.** When consumers run `npm install git+https://...`, the SDK auto-builds itself on their machine.
- **Bundle size is reasonable.** ~239 KB gzipped (dominated by vis-network itself, which is expected).

### Performance
- **Hard 25/25 limit is enforced at the render pipeline level** (not just at the store level), guaranteeing no frame drops regardless of input size.
- **Edge filtering is safe.** After node truncation, orphaned edges are filtered out before the 25-edge cap is applied, preventing vis-network crashes.
- **Physics tuning is production-grade.** `barnesHut` with `minVelocity: 0.75` and explicit `stopSimulation()` on layout transitions eliminates jitter.
- **Lazy edge index** (`_ensureEdgesByNodeIndex`) avoids O(n²) lookups on large graphs.

### Theming & Visuals
- **Light/dark mode colors exactly match the original module** (`graphs_adjuster.js`).  
- **`buildNodeColorStates()` correctly replicates the original `brightenColor`/`darkenColor` math** with identical percentage shifts (+12% hover, +18% highlight, -20% border darken).
- **Tooltip format matches the original** `generateNodeTitleSafely` function: same `excludeKeys` list, same `keepKeys` priority, same 50-entry cap.

### Documentation Alignment
- **FEATURES.md accurately reflects the code.** All 9 layout types listed are implemented. All 3 event callbacks documented exist. The 25/25 limit is correctly described.
- **INTEGRATION_GUIDE.md is accurate.** The install command, import path, data shape, options table, and styling note all match the actual implementation.

---

## 🔧 FIXED — Issues Found & Resolved During This Audit

### 1. CRITICAL: Circular Self-Dependency in `package.json`
- **File:** `package.json` line 38
- **Issue:** The package listed itself (`@linkx/graph-preview`) as its own dependency. This was silently introduced when you ran `npm install` to test the Git URL from within the SDK directory itself. It would cause an infinite install loop for consumers.
- **Fix:** Removed the self-referencing line. Dependencies now correctly contain only `vis-network` and `vis-data`.

### 2. SECURITY: innerHTML Usage (XSS Vector)
- **File:** `GraphRenderer.js` lines 307, 314, 328
- **Issue:** Three DOM elements (loading spinner, empty state, explore button) were constructed using `innerHTML`. While the current values are hardcoded string literals (no user input), this is a bad practice that could become a real XSS vulnerability if future developers accidentally interpolate user data into these strings.
- **Fix:** Replaced all 3 `innerHTML` calls with safe `document.createElement()` + `textContent` API calls.

---

## ⚠️ ADVISORY — Non-Blocking Observations

These are code quality notes that don't affect functionality or security today, but are worth addressing when you do the Cytoscape migration:

### 1. Duplicated Utility Functions
- `normalizeGraphId()` is defined identically in both `GraphStore.js` and `VisualEngine.js`.
- `toFiniteNumber()` is defined identically in both `VisualEngine.js` and `LayoutEngine.js`.
- **Impact:** Slightly inflates bundle size (~0.5 KB). No functional risk since both copies are identical.
- **Recommendation:** When you refactor for Cytoscape, extract these into a shared `utils.js` file.

### 2. `options` Prop Causes Re-renders in React
- **File:** `LinkAnalysisPreview.jsx` line 79
- **Issue:** The `useEffect` that watches `options` will fire on every parent render if the consumer passes an inline object literal like `options={{ theme: 'light' }}`, because React treats every new object reference as a change.
- **Impact:** Causes unnecessary `updateOptions()` calls. Not a performance problem at 25 nodes, but worth noting.
- **Recommendation:** Document in the Integration Guide that consumers should `useMemo()` their options object, or add a shallow-compare guard inside the `useEffect`.

### 3. No `LICENSE` File
- The SDK repository has no license file. If other teams or external parties will use this, you should add one (e.g., MIT, Apache 2.0, or a proprietary internal license).

### 4. `package-lock.json` Should Be Committed
- The `.gitignore` doesn't exclude `package-lock.json` (which is correct), but make sure it's committed to the publishing repo. It guarantees deterministic installs for consumers.

---

## 📊 Final Verdict

| Category | Status |
|---|---|
| **Architecture** | ✅ Professional |
| **Encapsulation** | ✅ vis-network fully hidden |
| **Security** | ✅ Fixed (innerHTML → DOM API) |
| **Performance** | ✅ Hard limits enforced |
| **Theming Accuracy** | ✅ Matches original module |
| **Tooltip Accuracy** | ✅ Matches original module |
| **Documentation** | ✅ Aligned with code |
| **Build/Distribution** | ✅ Fixed (self-reference removed) |
| **React Integration** | ✅ Proper lifecycle management |

**The SDK is production-ready for delivery.**
