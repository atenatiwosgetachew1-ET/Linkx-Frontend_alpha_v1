import React from 'react';

import { Section } from '../../../shared/components/form/FormFields.jsx';
import { REPORT_TEMPLATES } from '../../graph/report/reportTemplates.js';

// Libraries ▸ Report templates (analyst decision 2026-11-17): the report
// layouts, each with its preview image. The built-in NBE LinkX Graph Report
// is the default for graph reports; uploading or choosing other templates
// comes later. Libraries ▸ Charts lists the chart snaps' image templates in
// the same way (analyst decision 2026-11-18).
export default function ReportTemplatesPanel({
  templates = REPORT_TEMPLATES,
  title = 'Report templates',
  description = 'The layouts reports are drawn in. Built-in templates cannot be changed or removed.',
}) {
  return (
    <Section title={title} description={description}>
      <ul className="libraries_templates" aria-label={title}>
        {templates.map((template) => (
          <li key={template.id} className="libraries_template">
            <img className="libraries_template_thumbnail" src={template.thumbnail} alt={`${template.name} preview`} />
            <div className="libraries_template_body">
              <div className="libraries_template_title">
                <strong>{template.name}</strong>
                {template.isDefault ? <span className="libraries_badge is-active">Default</span> : null}
                <span className="libraries_badge is-builtin">{template.builtIn ? 'Built-in' : 'Uploaded'}</span>
              </div>
              <p>{template.description}</p>
              <dl className="libraries_template_facts">
                <dt>Kind</dt>
                <dd>{template.kind}</dd>
                <dt>Version</dt>
                <dd>{template.version}</dd>
                <dt>Used by</dt>
                <dd>{template.usedBy}</dd>
              </dl>
              <details className="libraries_template_sections">
                <summary>{template.sections.length} sections</summary>
                <ol>
                  {template.sections.map((name) => <li key={name}>{name}</li>)}
                </ol>
              </details>
            </div>
          </li>
        ))}
      </ul>
      <p className="settings_hint">Uploading your own templates and choosing one per kind are coming later.</p>
    </Section>
  );
}
