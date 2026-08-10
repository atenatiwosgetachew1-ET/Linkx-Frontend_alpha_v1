import React from 'react';

export default function GraphFilterTab() {
  return (
    <section className="workspace_context_section" aria-label="Graph filters">
      <h2>Graph filters</h2>
      <div className="workspace_context_form_stack">
        <label>
          <span>Property</span>
          <input type="text" placeholder="Select a graph first" disabled />
        </label>
        <label>
          <span>Condition</span>
          <select disabled defaultValue="contains">
            <option value="contains">Contains</option>
          </select>
        </label>
        <button type="button" disabled>Apply filter</button>
      </div>
    </section>
  );
}
