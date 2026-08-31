# Linkx Graph Preview SDK — Feature List

Here is the current feature set built into the `@linkx/graph-preview` SDK. Please review this list and let me know which features you would like to **keep**, **remove**, or **add** before we finalize the package!

### 1. Core Graph Capabilities
* **Strict Preview Limits:** Hardcoded safety limit of exactly **25 nodes** and **25 edges** max, ensuring the preview never tanks the parent page's performance.
* **Intelligent Data Parsing:** Accepts raw node/edge data and automatically filters out invalid edge connections.
* **Self-Contained Rendering:** The heavy `vis-network` engine is completely hidden inside the SDK. Sibling apps just drop in the React component and pass JSON data.

### 2. Layout Engine (9 Modes)
* **Physics / Force-Directed (`default`):** Simulates gravity and springs. Tuned with a `0.75` minVelocity for smooth, jitter-free settling.
* **Hierarchical:** Automatically structures data into top-down or bottom-up trees.
* **Geometric (Manual):** Instantly plots data into math-based formations:
  * `circle`, `star`, `radial`, `grid`, `spiral`, `concentric`, `layered`
* **Auto-Fitting Camera:** Instantly and perfectly centers the graph within the frame as soon as the layout stabilizes.

### 3. Visuals & Theming
* **Light & Dark Mode:** Fully supports both themes, mirroring the main application's exact colors, canvas backgrounds, and text contrast.
* **Dynamic Node Coloring:** Uses the original `brightenColor`/`darkenColor` math to automatically synthesize accurate `hover` (+12%) and `highlight` (+18%) states if the parent app only provides a base hex color.
* **Edge Weight Scaling:** Automatically calculates edge line thickness based on the relative `weight` values.
* **Self-Hosted Icons:** Contains the original 100+ SVG icons bundled directly in the code (converted to data URIs) so sibling apps don't need to host external assets.

### 4. Interactivity
* **Node Dragging:** Users can click and freely drag nodes around (now fully decoupled from rigid layout constraints).
* **Multi-line Tooltips:** Hovering over nodes or edges displays a clean, multi-line list of properties (`Key: Value`) identical to the main module's UI.
* **Event Callbacks:** Provides `onNodeClick`, `onEdgeClick`, and `onExplore` hooks so the embedding application can trigger navigation (e.g., opening the full Link Analysis app) when a user interacts with the preview.

