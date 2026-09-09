const fs = require('fs');
const content = fs.readFileSync('linkxDS2026/temp_placeholders/graph_reports.html', 'utf8');
const match = content.match(/id="report_logo"[^>]*src="data:image\/svg\+xml;base64,([^"]+)"/);
if (match) {
  const base64 = match[1];
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  console.log(decoded.substring(0, 300));
}
