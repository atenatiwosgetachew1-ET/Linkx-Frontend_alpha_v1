const fs = require('fs');
const path = './linkxDS2026/temp_placeholders/graphs_adjuster.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
  /iframe\.src = "\.\.\/temp_placeholders\/graph_reports\.html\?t="\s*\+\s*Date\.now\(\)\s*\+\s*"\\iframe\.src = "\\.\\.\/temp_placeholders\/graph_reports\.html\?parent_origin="\s*\+\s*encodeURIComponent\(window\.location\.origin \|\| "null"\);parent_origin="\s*\+\s*encodeURIComponent\(window\.location\.origin \|\| "null"\);/,
  'iframe.src = "../temp_placeholders/graph_reports.html?t=" + Date.now() + "&parent_origin=" + encodeURIComponent(window.location.origin || "null");'
);
fs.writeFileSync(path, content);
