import React from 'react';

export default function GraphInfoTab() {
  return (
    <section className="workspace_context_section" aria-label="Graph information">
      <h2>Graph info</h2>
      <dl className="workspace_context_pairs">
        <div>
          <dt>Selected graph</dt>
          <dd>None</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>0</dd>
        </div>
        <div>
          <dt>Edges</dt>
          <dd>0</dd>
        </div>
      </dl>
    </section>
  );
}
