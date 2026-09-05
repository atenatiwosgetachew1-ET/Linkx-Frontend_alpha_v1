  const requestRelationshipGraph = (windowId, payload, options = {}) => {
    const iframe = payload?.iframe || null;
    const relationship = sanitizeGraphRelationshipValue(payload?.relationship, { maxLength: 128 });
    const sourceId = String(payload?.sourceId || "").trim();
    const requestOrigin = options.requestOrigin || "manual";
    const graphWindowId = String(windowId || "").trim();

    if (!graphWindowId || !sourceId || !relationship) {
      logGraphWindowDebug("graph fetch skipped", {
        reason: "missing_required_payload",
        graph_window_id: graphWindowId,
        session_id: sourceId,
        relationship,
        request_origin: requestOrigin,
      });
      return;
    }

    const newPayload = {
      id: "relationship",
      source_id: sourceId,
      relationship,
    };

    if (graphFetchAbortControllersRef.current[graphWindowId]) {
      graphFetchAbortControllersRef.current[graphWindowId].abort();
      delete graphFetchAbortControllersRef.current[graphWindowId];
    }
    const controller = new AbortController();
    graphFetchAbortControllersRef.current[graphWindowId] = controller;
    delete graphProgressRenderedRef.current[graphWindowId];
    graphAutoRequestedRef.current[graphWindowId] = requestOrigin === "auto_relationships";

    setWindows((prev) =>
      prev.map((windowState) =>
        String(windowState.id) === graphWindowId
          ? { ...windowState, loadscreenState: true, loadscreenText: "Fetching graph..." }
          : windowState
      )
    );

    logGraphWindowDebug("graph fetch request", {
      graph_window_id: graphWindowId,
      session_id: sourceId,
      request_origin: requestOrigin,
      payload: newPayload,
    });

    const buildGraphProgressPayload = (response, complete = false) => {
      const responseResults = response?.results && typeof response.results === "object" ? response.results : {};
      const summary = responseResults?.result && typeof responseResults.result === "object" ? responseResults.result : {};
      const currentNodes = Array.isArray(responseResults.nodes) ? responseResults.nodes.length : 0;
      const currentEdges = Array.isArray(responseResults.edges) ? responseResults.edges.length : 0;
      const totalNodes = Number(summary.total_nodes);
      const totalEdges = Number(summary.total_edges);
      const total = Number.isFinite(totalNodes) && Number.isFinite(totalEdges)
        ? Math.max(1, totalNodes + totalEdges)
        : null;
      return {
        title: "Fetching graph data...",
        current: currentNodes + currentEdges,
        total,
        complete,
      };
    };

    requestGraphFetch(apiFetch, newPayload, controller.signal, {
      onQueued: (queuedData) => {
        const jobId = getQueuedJobId(queuedData);
        const status = getJobStatus(queuedData);
        if (jobId) {
          activeGraphJobsRef.current[graphWindowId] = jobId;
        }
        logGraphWindowDebug("graph fetch queued", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          request_origin: requestOrigin,
          job_id: jobId || null,
          status: status || null,
        });
      },
      onProgress: (partialData, progressMeta) => {
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const partialResults = partialData?.results || {};
        const nodes = Array.isArray(partialResults.nodes) ? partialResults.nodes : [];
        const edges = Array.isArray(partialResults.edges) ? partialResults.edges : [];
        console.log('[graph fetch progress]', {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          relationship,
          request_origin: requestOrigin,
          status: progressMeta?.status || null,
          after_event_id: progressMeta?.afterEventId ?? null,
          chunk_count: progressMeta?.chunkCount ?? null,
          node_count: nodes.length,
          edge_count: edges.length,
          data: partialData,
        });
        if (nodes.length === 0 && edges.length === 0) return;

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? { ...windowState, loadscreenState: false, loadscreenText: null, activeGraph: 'graphs_basic', selectedContent: 'graph_content' }
              : windowState
          )
        );

        const progress = buildGraphProgressPayload(partialData, false);

        const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
        const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
        const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
        const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
        if (!hasRenderedGraph) {
          settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
          updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
        }
        sendGraphMessageToIframe(iframe, messageAction, {
          id: graphWindowId,
          nodes,
          edges,
          settings: settingsToApply,
          progress,
        });
        graphProgressRenderedRef.current[graphWindowId] = true;
      }
    })
      .then((data) => {
        console.log("[graph relationship fetch received raw]", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          relationship,
          request_origin: requestOrigin,
          data,
        });
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const normalizedResults = data?.results || {};
        const nodes = Array.isArray(normalizedResults.nodes) ? normalizedResults.nodes : [];
        const edges = Array.isArray(normalizedResults.edges) ? normalizedResults.edges : [];

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? {
                  ...windowState,
                  loadscreenState: false,
                  loadscreenText: null,
                  activeGraph: isSuccessResponse(data) ? "graphs_basic" : null,
                  selectedContent: isSuccessResponse(data) ? "graph_content" : windowState.selectedContent
                }
              : windowState
          )
        );

        logGraphWindowDebug("graph fetch response", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          request_origin: requestOrigin,
          node_count: nodes.length,
          edge_count: edges.length,
          ok: isSuccessResponse(data),
        });

        if (isSuccessResponse(data)) {
          delete activeGraphJobsRef.current[graphWindowId];
          const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
          const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
          const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
          const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
          if (!hasRenderedGraph) {
            settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
            updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
          }
          sendGraphMessageToIframe(iframe, messageAction, {
            id: graphWindowId,
            nodes,
            edges,
            settings: settingsToApply,
            progress: buildGraphProgressPayload(data, true),
          });
          graphProgressRenderedRef.current[graphWindowId] = true;
        } else {
          delete graphAutoRequestedRef.current[graphWindowId];
          alert(getGraphFetchErrorMessage(data));
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        delete activeGraphJobsRef.current[graphWindowId];
        delete graphProgressRenderedRef.current[graphWindowId];
        delete graphAutoRequestedRef.current[graphWindowId];
        console.error("[relationship graph request catch]", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          relationship,
          request_origin: requestOrigin,
          error: err,
        });
        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? { ...windowState, windowResponseI: "Connection failed!", loadscreenState: false, loadscreenText: null }
              : windowState
          )
        );
        alert(getGraphFetchErrorMessage(err, getJobFailureMessage(err, "Graph fetch failed. Please retry.")));
      })
      .finally(() => {
        if (graphFetchAbortControllersRef.current[graphWindowId] === controller) {
          delete graphFetchAbortControllersRef.current[graphWindowId];
