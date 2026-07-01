# Cytoscape React Handoff

## Purpose

This document is a handoff for the future frontend version of Linkx that should use:

- `Cytoscape.js`
- a React wrapper/component integration
- no iframe-based graph runtime

This is intended for the next frontend build effort, not as a retrofit plan for the current graph implementation.

---

## Executive Summary

For a national-scale banking analysis platform, `Cytoscape.js + React` is a credible and strong direction.

The goal is not just to replace a graph renderer. The goal is to build a better graph application architecture for:

- large investigative graphs
- controlled subgraph exploration
- stable incremental graph updates
- repeatable analyst workflows
- better maintainability
- better observability

The biggest benefits are expected in:

- architectural clarity
- interaction control
- stable graph updates
- subgraph operations
- analysis-focused workflows

It should not be assumed that Cytoscape will magically solve every scaling issue. Large-scale success will still depend on:

- server-driven scoping
- chunk-aware loading
- explicit graph states
- aggressive interaction budgeting
- layout discipline

---

## Why Cytoscape for the Future Version

### Architectural reasons

Compared with the current iframe-based graph setup, a React + Cytoscape design removes:

- iframe lifecycle overhead
- `postMessage` coordination complexity
- split graph state between parent and iframe
- duplicated runtime logic per graph window

This gives a more coherent application model:

- React owns app and window state
- Cytoscape owns rendered graph state
- backend owns data delivery and graph scope

### Product reasons

This platform is not a casual visualization tool. It is an analysis product.

Cytoscape is a better long-term fit for:

- neighborhood expansion
- path finding
- filtered investigation views
- evidence highlighting
- class-based styling
- deterministic layouts
- explicit graph state transitions

### Enterprise reasons

For a national-scale banking analysis workflow, priority should be given to:

- stability
- repeatability
- operator confidence
- safe performance degradation
- maintainability over years

That makes Cytoscape attractive even if it is not always the single fastest raw renderer in every isolated scenario.

---

## Performance Position

## Important framing

The main performance gain from `React + Cytoscape` should be expected from:

- removing architectural waste
- improving update stability
- reducing reset churn
- controlling visible graph scope
- improving graph interaction discipline

Not from blindly rendering all possible data at once.

### Likely performance improvements over the current iframe + vis setup

- faster graph window startup
- lower coordination overhead
- smoother incremental updates
- fewer graph resets during chunk arrival
- better UI responsiveness around graph controls
- more predictable cleanup and cancellation

### What will still require explicit engineering

- layout cost on large graphs
- label/title rendering cost
- expensive path/community algorithms
- huge node and edge counts
- memory pressure under many open graph windows

### Expected performance strategy

The future frontend should optimize for:

1. subgraph-first rendering
2. incremental updates
3. bounded interactions
4. layout reuse where possible
5. explicit loading and busy states
6. large-graph mode behavior

---

## Target Frontend Principles

The future graph frontend should follow these principles:

1. Never treat the full graph as the default visible graph.
2. The user should operate on a managed subgraph unless explicitly requesting more scope.
3. Graph fetch, chunk merge, and render states should be explicit.
4. Expensive operations should be gated and cancelable.
5. Styling should be class-driven and deterministic.
6. Layouts should favor repeatability over decorative motion.
7. Graph windows should stay aligned to exact session/window ids.
8. Analyst actions should remain responsive even when graph data is large.

---

## Recommended High-Level Architecture

### 1. App orchestration layer

React application state should own:

- authentication state
- source window state
- graph window state
- active session/window ids
- backend graph job polling
- socket subscriptions
- placeholder/loading/error states
- notifications
- permissions

### 2. Graph domain layer

Create a dedicated graph domain module that owns:

- graph data normalization
- graph chunk merge logic
- graph selection state
- graph filtering/search logic
- graph styling state
- graph algorithm orchestration
- graph export/report orchestration

This should be separated from React UI components.

### 3. Graph render layer

A React Cytoscape component should own:

- Cytoscape instance creation
- element updates
- local graph event wiring
- viewport control
- render-time optimizations

### 4. Window UI layer

Graph window UI should wrap the graph renderer and provide:

- placeholder/info surface
- loading/progress surface
- controls and filters
- properties panel
- source/target mapping panels
- evidence and alerts panels

---

## Suggested Folder Structure

Example target structure:

```text
src/
  features/
    graph/
      components/
        GraphWindow.jsx
        GraphCanvas.jsx
        GraphPlaceholder.jsx
        GraphLoadingOverlay.jsx
        GraphControlsPanel.jsx
        GraphPropertiesPanel.jsx
      hooks/
        useGraphWindowState.js
        useGraphJobs.js
        useGraphSocketStatus.js
        useGraphSelection.js
        useGraphControls.js
      state/
        graphStore.js
        graphWindowStore.js
      services/
        graphApi.js
        graphJobPolling.js
        graphSocket.js
      domain/
        graphNormalizer.js
        graphChunkMerge.js
        graphFilters.js
        graphStyles.js
        graphSelection.js
        graphLayouts.js
        graphAlgorithms.js
        graphEvidence.js
        graphExport.js
      cytoscape/
        createCytoscapeInstance.js
        bindCytoscapeEvents.js
        applyCytoscapeElements.js
        applyCytoscapeStyles.js
        applyCytoscapeLayout.js
      utils/
        graphIds.js
        graphLogging.js
        graphLimits.js
```

---

## Graph Lifecycle Model

Use explicit graph lifecycle states.

Recommended state machine:

- `idle`
- `linked`
- `placeholder`
- `queued`
- `streaming_chunks`
- `rendering`
- `ready`
- `failed`
- `cancelled`

### Required UX rule

When a graph window is linked to a source:

- do show placeholder/info
- do not auto-fetch graph data
- wait for explicit user request from the relationship control area

---

## Backend Interaction Contract

The future frontend should preserve the existing graph fetch contract style unless backend contracts intentionally change.

### Core rules

1. Always use the exact active linked source/window session id.
2. Never silently downgrade to a parent session id for graph work.
3. Treat graph requests as asynchronous.
4. Support chunk merging progressively.
5. Render incrementally without resetting the graph on each chunk.

### Required graph fetch shape

Use the active linked source/window id as `source_id`.

Example request:

```json
{
  "id": "relationship",
  "source_id": "1_414935",
  "relationship": "*"
}
```

### Async job handling

The frontend should:

1. request graph
2. receive `job_id`
3. poll job status
4. request chunk updates
5. merge nodes and edges progressively
6. stop when job succeeds or fails

### Chunk merge expectations

The frontend should maintain:

- `afterEventId`
- a node map keyed by stable id
- an edge collection keyed by stable id or stable edge signature

Incremental merge must not destroy already rendered chunks.

---

## Cytoscape Integration Strategy

### Component model

Use a React component that mounts one Cytoscape instance into a container `div`.

Suggested component shape:

- `GraphCanvas`
- `forwardRef`
- `useRef`
- `useEffect`
- `useImperativeHandle`

### What the Cytoscape component should own

- Cytoscape instance
- current visible elements
- viewport state
- event listeners
- local render batching

### What React should own

- graph window state
- loading state
- controls state
- backend job state
- socket state
- selected relationship request state
- app-level notifications

### Do not make Cytoscape fully declarative

React should not re-create the graph instance on ordinary state changes.

Use:

- stable refs
- batched element updates
- imperative mutations where appropriate

The Cytoscape instance should live longer than the parent control panel rerenders.

---

## Feature Mapping from Current Frontend

These behaviors should be preserved conceptually in the future version.

### Core graph flow

- placeholder/info before fetch
- manual relationship-triggered fetch
- async job polling
- chunk merge
- incremental render
- error handling

### Graph controls

- node limits
- sort controls
- label controls
- title controls
- edge weighting
- physics substitute or equivalent interaction control
- layout selection
- fit/reset

### Analysis actions

- shortest path workflows
- find-all-paths workflows
- traversal
- community detection
- selective highlighting

### Investigation tools

- evidence pinning
- saved views
- node property inspection
- graph export
- graph report generation

### Chart integration

- graph selection to chart updates
- graph component extraction for chart modules where needed

---

## National-Scale Banking Constraints

This future system should be designed under the assumption that:

- graph data can become very large
- analysts may open several windows
- operations can be long-running
- deterministic and reviewable behavior matters
- platform trust matters more than flashy motion

### Therefore

Prefer:

- controlled visible scope
- analyst-initiated expansion
- deterministic layouts
- stable highlighting
- clear failure states
- clear loading states

Avoid:

- automatic broad fetches
- uncontrolled physics by default
- full-graph eager rendering
- hidden background heavy recalculation

---

## Recommended Performance Guardrails

### 1. Subgraph-first policy

Never render the whole graph by default just because it exists.

Always start from:

- relationship type
- selected entity
- bounded neighborhood
- bounded path result
- bounded investigation set

### 2. Large graph mode

Add explicit thresholds where the UI changes behavior.

Examples:

- disable expensive labels above threshold
- disable live layout motion above threshold
- reduce edge styling complexity above threshold
- defer heavy algorithms until explicitly requested

### 3. Layout policy

Use deterministic layouts where possible.

For large investigation graphs:

- prefer repeatable layouts
- avoid expensive constantly animated layouts
- allow analyst refit/re-layout as an action, not default churn

### 4. Event throttling

Throttle:

- selection change handling
- hover-derived detail work
- filter recomputation
- expensive viewport reactions

### 5. Render batching

Chunk merges should batch Cytoscape updates instead of applying each node or edge one by one in a noisy way.

### 6. Busy-state gating

When expensive graph tasks are running:

- show clear local loading/busy overlay
- avoid allowing repeated conflicting actions
- support cancellation where feasible

---

## Observability Requirements

This future frontend should include development-grade graph instrumentation from the start.

Recommended logs:

- active graph window id
- active source/window session id
- graph request payload
- returned `job_id`
- poll status transitions
- chunk counts
- total nodes and edges merged
- active relationship filter
- layout chosen
- graph state transitions

Use development-only logging by default.

---

## Risks

### Risk 1: over-migrating too much at once

Do not try to port every advanced graph feature in phase one.

### Risk 2: treating Cytoscape like a magic performance fix

Cytoscape helps, but large-graph performance still depends on:

- scoping
- batching
- layout policy
- label policy
- algorithm discipline

### Risk 3: over-declarative React integration

Do not re-create graph elements from scratch on every minor state change.

### Risk 4: feature parity pressure

Do not block the future architecture on perfect one-shot parity with every current vis feature.

Build the core investigation graph workflow first.

---

## Recommended Delivery Phases

## Phase 1: foundation

Deliver:

- graph window shell
- placeholder/info state
- relationship-triggered graph fetch
- async job polling
- chunk merge
- Cytoscape render
- loading/error states

## Phase 2: operator workflow

Deliver:

- properties panel
- selection handling
- search/filter controls
- node/edge highlighting
- chart integration hooks

## Phase 3: analysis tools

Deliver:

- path finding
- traversal
- community styling
- saved views
- evidence pinning

## Phase 4: enterprise hardening

Deliver:

- large graph mode
- profiling and metrics
- aggressive cancellation rules
- deterministic layout presets
- audit-friendly interaction behavior

---

## First Milestone Definition

The first meaningful milestone for the Cytoscape future frontend should be:

1. open graph window
2. link source window
3. show placeholder with relationship list
4. user chooses relationship
5. frontend sends graph request using exact active source/window id
6. frontend polls graph job
7. frontend merges incoming chunks incrementally
8. graph renders without resetting on each chunk
9. local loading/progress is visible
10. graph becomes interactive when ready

If this milestone is solid, the rest of the migration becomes much safer.

---

## Final Recommendation

For the future serious version of Linkx intended for national-scale banking analysis:

- using `Cytoscape.js + React`
- with explicit graph-state architecture
- with subgraph-first rendering
- with chunk-aware update handling

is a valid and strong direction.

The right success condition is not:

- "match current vis behavior immediately"

The right success condition is:

- "deliver a more stable, scalable, investigation-grade graph frontend"

