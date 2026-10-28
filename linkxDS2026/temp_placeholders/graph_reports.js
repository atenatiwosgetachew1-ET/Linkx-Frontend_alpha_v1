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
    const info = report.reportInfo;
    const payloadObj = typeof info?.payload === "string"
      ? (() => { try { return JSON.parse(info.payload); } catch(e) { return {}; } })()
      : (info?.payload || {});

    if (report.visibleNodes > 0 || report.visibleEdges > 0) {
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
    } else {
      findings.push("Graph topology payload was excluded or archived for this service evidence report.");
      if (payloadObj?.account_no || payloadObj?.entity_id) {
        findings.push(`Target Subject: Entity/Account ${payloadObj.account_no || payloadObj.entity_id} (${payloadObj.domain || payloadObj.resolved_domain || "Universal"}).`);
      }
      if (payloadObj?.flagged_rules && payloadObj.flagged_rules.length > 0) {
        findings.push(`Flagged Typology Rules: ${Array.isArray(payloadObj.flagged_rules) ? payloadObj.flagged_rules.join(", ") : payloadObj.flagged_rules}.`);
      }
      if (payloadObj?.linked_accounts_count != null || payloadObj?.all_relationships != null) {
        findings.push(`Analytical Scope: ${formatNumber(payloadObj.linked_accounts_count ?? 0)} linked accounts across ${formatNumber(payloadObj.all_relationships ?? 0)} total relationships.`);
      }
      if (payloadObj?.network_centrality_score != null) {
        findings.push(`Network Centrality Index: ${payloadObj.network_centrality_score} (Max Path Depth: ${payloadObj.max_path_length ?? "N/A"}).`);
      }
      const fraudScore = info?.fraud_score ?? payloadObj?.fraud_score ?? info?.score ?? payloadObj?.score;
      const scoreBand = info?.score_band ?? payloadObj?.score_band;
      if (fraudScore !== undefined && fraudScore !== null && fraudScore !== "") {
        findings.push(`Computed evaluation score: ${fraudScore} (Score Band: ${scoreBand || "Standard"}).`);
      }
      const reason = payloadObj?.reason || info?.reason;
      if (reason) {
        findings.push(`Flagged trigger reason: ${reason}`);
      }
      const typology = payloadObj?.anomaly_type || payloadObj?.typology || info?.typology;
      if (typology && !payloadObj?.flagged_rules) {
        findings.push(`Investigative typology category: ${typology}`);
      }
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

    if (report.visibleNodes <= 0 && report.visibleEdges <= 0) {
      const info = report.reportInfo;
      const payloadObj = typeof info?.payload === "string"
        ? (() => { try { return JSON.parse(info.payload); } catch(e) { return {}; } })()
        : (info?.payload || {});
      const score = info?.fraud_score ?? payloadObj?.fraud_score ?? info?.score ?? payloadObj?.score ?? (payloadObj?.network_centrality_score != null ? `${(payloadObj.network_centrality_score * 100).toFixed(0)}%` : "-");
      const band = info?.score_band ?? payloadObj?.score_band ?? (payloadObj?.is_flagged ? "Flagged" : "Standard");
      const repStatus = info?.status || status;
      if (payloadObj?.account_no || payloadObj?.entity_id) {
        return `This service evidence report for account ${payloadObj.account_no || payloadObj.entity_id} was generated without an embedded graph topology payload. Analysis identified ${formatNumber(payloadObj.linked_accounts_count ?? 0)} linked accounts and ${formatNumber(payloadObj.all_relationships ?? 0)} total relationships with a network centrality score of ${payloadObj.network_centrality_score ?? "N/A"}. Flagged typologies: ${Array.isArray(payloadObj.flagged_rules) ? payloadObj.flagged_rules.join(", ") : (payloadObj.flagged_rules || "None")}. Please review the detailed analytical metrics above.`;
      }
      return `This evidence report was generated without an embedded graph topology payload. The recorded assessment indicates an evaluation score of ${score} (${band}) with status ${repStatus}. Detailed evidence metrics and investigative findings are summarized in the evidence profile above.`;
    }

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
    const caseStatus = report.reportInfo?.status || deriveCaseStatus(report);

    setText("report_case_reference", caseRef);
    setText("report_case_status", caseStatus);
    setText("report_type_value", report.reportInfo?.report_type || "Graph Evidence");
    setText("report_source_system", report.reportInfo?.source_system || "System Generated");
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

    // Populate Evidence Information section
    const evSection = document.getElementById("evidence_section");
    const info = report.reportInfo;
    if (info && typeof info === "object") {
      const payloadObj = typeof info.payload === "string"
        ? (() => { try { return JSON.parse(info.payload); } catch(e) { return {}; } })()
        : (info.payload || {});

      const fraudScore = info.fraud_score ?? payloadObj.fraud_score ?? info.score ?? payloadObj.score ?? (payloadObj.network_centrality_score != null ? `${(payloadObj.network_centrality_score * 100).toFixed(0)}%` : "-");
      let band = info.score_band ?? payloadObj.score_band ?? (payloadObj.is_flagged ? "Flagged" : "-");
      if (Number(fraudScore) >= 90) band = "Fatal";
      const statusVal = info.status ?? payloadObj.status ?? "-";
      const typologyVal = info.typology ?? payloadObj.typology ?? payloadObj.anomaly_type ?? (Array.isArray(payloadObj.flagged_rules) ? payloadObj.flagged_rules.join(", ") : payloadObj.flagged_rules) ?? "-";
      const reasonVal = payloadObj.reason || info.reason;

      setText("ev_fraud_score", fraudScore);
      setText("ev_score_band", band);
      setText("ev_status", statusVal);
      setText("ev_typology", typologyVal);

      const evList = [];
      if (payloadObj.account_no || payloadObj.entity_id) evList.push(`Account / Entity: ${payloadObj.account_no || payloadObj.entity_id}`);
      if (payloadObj.domain || payloadObj.resolved_domain) evList.push(`Domain: ${payloadObj.domain || payloadObj.resolved_domain}`);
      if (payloadObj.is_flagged !== undefined) evList.push(`Flagged: ${payloadObj.is_flagged ? "Yes" : "No"}`);
      if (payloadObj.beneficiary_blacklisted !== undefined) evList.push(`Beneficiary Blacklisted: ${payloadObj.beneficiary_blacklisted ? "Yes" : "No"}`);
      if (payloadObj.flagged_rules && Array.isArray(payloadObj.flagged_rules) && payloadObj.flagged_rules.length > 0) {
        evList.push(`Flagged Rules: ${payloadObj.flagged_rules.join(", ")}`);
      }
      if (payloadObj.linked_accounts_count != null) evList.push(`Linked Accounts: ${formatNumber(payloadObj.linked_accounts_count)}`);
      if (payloadObj.all_relationships != null) evList.push(`All Relationships: ${formatNumber(payloadObj.all_relationships)}`);
      if (payloadObj.network_centrality_score != null) evList.push(`Network Centrality: ${payloadObj.network_centrality_score}`);
      if (payloadObj.max_path_length != null) evList.push(`Max Path Length: ${payloadObj.max_path_length}`);
      if (payloadObj.duration_ms != null) evList.push(`Analysis Duration: ${(payloadObj.duration_ms / 1000).toFixed(2)}s`);
      if (reasonVal) evList.push(`Reason: ${reasonVal}`);

      const scoreEvidence = info.score_evidence || payloadObj.score_evidence;
      if (scoreEvidence && typeof scoreEvidence === "object") {
        if (scoreEvidence.config_version) evList.push(`Config Version: ${scoreEvidence.config_version}`);
        if (scoreEvidence.base_score_applied != null) evList.push(`Base Score: ${scoreEvidence.base_score_applied}`);
        if (scoreEvidence.node_count_bonus != null) evList.push(`Node Count Bonus: ${scoreEvidence.node_count_bonus}`);
        if (scoreEvidence.financial_bonus != null) {
          const isCdr = typeof window.isCdrDomain === "function" ? window.isCdrDomain() : false;
          evList.push(`${isCdr ? "Volume Bonus" : "Financial Bonus"}: ${scoreEvidence.financial_bonus}`);
        }
      }
      
      renderList("ev_evidence_list", evList, "No additional evidence parameters recorded.", (item) => item);

      if (evSection) {
        evSection.style.display = "block";
      }
    } else if (evSection) {
      evSection.style.display = "none";
    }

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

  const LINKX_REPORT_PARENT_ORIGIN = (() => {
    try {
      const direct = new URLSearchParams(window.location.search).get("parent_origin");
      if (direct) return direct;
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (_err) {}
    return "";
  })();

  window.addEventListener("message", function (event) {
  if (LINKX_REPORT_PARENT_ORIGIN && String(event.origin || "") !== LINKX_REPORT_PARENT_ORIGIN) return;
    const data = event?.data || {};
    if (data.action !== "graph_report") return;
    updateReport(data.payload);
  });
})();
