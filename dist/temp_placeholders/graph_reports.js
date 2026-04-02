(function () {
  function numberValue(value) {
    const safe = Number(value);
    return Number.isFinite(safe) ? safe : 0;
  }

  function formatNumber(value) {
    return numberValue(value).toLocaleString();
  }

  function formatPercent(value) {
    const safe = numberValue(value);
    return `${safe.toFixed(2)}%`;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value == null ? "-" : String(value);
  }

  function identityColor(identity) {
    const normalized = String(identity || "Unspecified").toLowerCase();
    if (normalized === "source node") return "#0ea5e9";
    if (normalized === "target node") return "#f59e0b";
    if (normalized === "entity node") return "#4f46e5";
    if (normalized === "unspecified") return "#6b7280";

    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 60%, 45%)`;
  }

  function renderList(id, rows, emptyText, formatter) {
    const listEl = document.getElementById(id);
    if (!listEl) return;

    const safeRows = Array.isArray(rows) ? rows : [];
    if (safeRows.length === 0) {
      listEl.innerHTML = `<li>${emptyText}</li>`;
      return;
    }

    listEl.innerHTML = safeRows
      .map((row) => {
        const text = formatter ? formatter(row) : String(row);
        return `<li>${text}</li>`;
      })
      .join("");
  }

  function updateReport(payload) {
    const report = payload?.report || payload || {};

    setText("report_source_id", report.sourceWindowId);
    setText("report_generated_at", report.generatedAt);
    setText("report_visible_nodes", formatNumber(report.visibleNodes));
    setText("report_visible_edges", formatNumber(report.visibleEdges));
    setText("report_total_nodes", formatNumber(report.totalNodes));
    setText("report_total_edges", formatNumber(report.totalEdges));
    setText("report_selected_nodes", formatNumber(report.selectedNodes));
    setText("report_selected_edges", formatNumber(report.selectedEdges));
    setText("report_avg_degree", numberValue(report.averageDegree).toFixed(2));
    setText("report_density", formatPercent(report.densityPercent));

    renderList(
      "report_relationship_types",
      report.relationshipTypes,
      "No relationship types found.",
      (item) => `${item.type}: ${formatNumber(item.count)}`
    );

    renderList(
      "report_node_identity_distribution",
      report.nodeIdentityDistribution,
      "No node identities found.",
      (item) => `${item.identity}: ${formatNumber(item.count)}`
    );

    renderList(
      "report_top_degree_nodes",
      report.topNodesByDegree,
      "No nodes found.",
      (item) => {
        const label = item.label && String(item.label).trim() !== ""
          ? item.label
          : item.id;
        const identity = item.identity || "Unspecified";
        const color = identityColor(identity);
        return `
          <span style="margin-right:8px;">${label} (degree: ${formatNumber(item.degree)})</span>
          <span style="display:inline-block;color:#fff;background:${color};font-size:11px;border-radius:999px;padding:1px 8px;">
            ${identity}
          </span>
        `;
      }
    );
  }

  window.addEventListener("message", function (event) {
    const data = event?.data || {};
    if (data.action !== "graph_report") return;
    updateReport(data.payload);
  });
})();
