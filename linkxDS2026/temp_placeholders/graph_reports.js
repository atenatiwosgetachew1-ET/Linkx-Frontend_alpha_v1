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

  function normalizeIdentity(identity) {
    const raw = String(identity || "").trim();
    const normalized = raw.toLowerCase();
    if (normalized === "source node" || normalized === "source") return "Source";
    if (normalized === "target node" || normalized === "target") return "Target";
    if (normalized === "entity node" || normalized === "entity") return "Entity";
    if (!raw) return "Unspecified";
    return raw;
  }

  function identityColor(identity) {
    const normalized = normalizeIdentity(identity).toLowerCase();
    if (normalized === "source") return "#0ea5e9";
    if (normalized === "target") return "#f59e0b";
    if (normalized === "entity") return "#4f46e5";
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

  function setGraphSnapshot(dataUrl) {
    const imageEl = document.getElementById("report_graph_snapshot");
    const emptyEl = document.getElementById("report_graph_empty");
    if (!imageEl) return;

    if (dataUrl) {
      imageEl.src = String(dataUrl);
      imageEl.style.display = "block";
      if (emptyEl) emptyEl.style.display = "none";
      return;
    }

    imageEl.removeAttribute("src");
    imageEl.style.display = "none";
    if (emptyEl) emptyEl.style.display = "block";
  }

  function deriveCaseStatus(report) {
    const visibleNodes = numberValue(report.visibleNodes);
    const visibleEdges = numberValue(report.visibleEdges);
    const selectedNodes = numberValue(report.selectedNodes);

    if (visibleNodes <= 0) return "No Observable Activity";
    if (visibleEdges <= 0) return "Entity-Only Activity";
    if (selectedNodes > 0) return "Focused Examination";

    const ratio = visibleNodes > 0 ? (visibleEdges / visibleNodes) : 0;
    if (ratio >= 2.5) return "High Relationship Density";
    if (ratio >= 1.2) return "Moderate Relationship Density";
    return "Low Relationship Density";
  }

  function buildKeyFindings(report) {
    const findings = [];

    findings.push(
      `Observed ${formatNumber(report.visibleNodes)} entities and ${formatNumber(report.visibleEdges)} relationships in the active scope.`
    );

    const topRel = (Array.isArray(report.relationshipTypes) ? report.relationshipTypes : [])
      .slice()
      .sort((a, b) => numberValue(b.count) - numberValue(a.count))[0];
    if (topRel) {
      findings.push(
        `Dominant relationship pattern: ${topRel.type} (${formatNumber(topRel.count)} links).`
      );
    }

    const topIdentity = (Array.isArray(report.nodeIdentityDistribution) ? report.nodeIdentityDistribution : [])
      .slice()
      .sort((a, b) => numberValue(b.count) - numberValue(a.count))[0];
    if (topIdentity) {
      findings.push(
        `Most common entity category: ${normalizeIdentity(topIdentity.identity)} (${formatNumber(topIdentity.count)} entities).`
      );
    }

    const topNode = (Array.isArray(report.topNodesByDegree) ? report.topNodesByDegree : [])[0];
    if (topNode) {
      const label = topNode.label && String(topNode.label).trim() !== ""
        ? topNode.label
        : topNode.id;
      findings.push(
        `Highest connected entity in current view: ${label} (degree: ${formatNumber(topNode.degree)}).`
      );
    }

    return findings;
  }

  function buildRemarkParagraph(report) {
    const entities = formatNumber(report.visibleNodes);
    const relations = formatNumber(report.visibleEdges);
    const density = formatPercent(report.densityPercent);
    const connectivity = numberValue(report.averageDegree).toFixed(2);
    const selectedNodes = formatNumber(report.selectedNodes);
    const status = deriveCaseStatus(report);

    return `Based on the current graph scope, the investigation indicates ${entities} observed entities connected through ${relations} relationships. The network shows a density of ${density} with a connectivity index of ${connectivity}. Current focus includes ${selectedNodes} selected entities. Overall assessment status: ${status}. This remark is generated from the active analytical snapshot and should be reviewed together with the detailed findings above before final case submission.`;
  }

  function updateReport(payload) {
    const report = payload?.report || payload || {};
    const normalizedIdentities = (Array.isArray(report.nodeIdentityDistribution) ? report.nodeIdentityDistribution : [])
      .map((item) => ({ ...item, identity: normalizeIdentity(item.identity) }));
    const normalizedTopNodes = (Array.isArray(report.topNodesByDegree) ? report.topNodesByDegree : [])
      .map((item) => ({ ...item, identity: normalizeIdentity(item.identity) }));
    const caseRef = report.sourceWindowId == null
      ? "INV-UNASSIGNED"
      : `INV-${String(report.sourceWindowId)}`;
    const caseStatus = deriveCaseStatus(report);

    setText("report_source_id", report.sourceWindowId);
    setText("report_case_reference", caseRef);
    setText("report_case_status", caseStatus);
    setText("report_generated_at", report.generatedAt);
    setText("report_visible_nodes", formatNumber(report.visibleNodes));
    setText("report_visible_edges", formatNumber(report.visibleEdges));
    setText("report_total_nodes", formatNumber(report.totalNodes));
    setText("report_total_edges", formatNumber(report.totalEdges));
    setText("report_selected_nodes", formatNumber(report.selectedNodes));
    setText("report_selected_edges", formatNumber(report.selectedEdges));
    setText("report_avg_degree", numberValue(report.averageDegree).toFixed(2));
    setText("report_density", formatPercent(report.densityPercent));
    setGraphSnapshot(report.graphSnapshotDataUrl || "");

    renderList(
      "report_key_findings",
      buildKeyFindings(report),
      "No findings generated.",
      (item) => item
    );
    setText("report_summary_text", buildRemarkParagraph(report));
    setText("report_signature_dash", "-");

    renderList(
      "report_relationship_types",
      report.relationshipTypes,
      "No relationship types found.",
      (item) => `${item.type}: ${formatNumber(item.count)}`
    );

    renderList(
      "report_node_identity_distribution",
      normalizedIdentities,
      "No node identities found.",
      (item) => `${item.identity}: ${formatNumber(item.count)}`
    );

    renderList(
      "report_top_degree_nodes",
      normalizedTopNodes,
      "No nodes found.",
      (item) => {
        const label = item.label && String(item.label).trim() !== ""
          ? item.label
          : item.id;
        const identity = normalizeIdentity(item.identity || "Unspecified");
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
