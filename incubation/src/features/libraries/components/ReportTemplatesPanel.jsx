import React from 'react';

import { Block, Masthead, PageHero, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { REPORT_TEMPLATES } from '../../graph/report/reportTemplates.js';
import { IMAGE_TEMPLATES } from '../../chart/lib/chartSnapTemplates.js';

// Every template reports are drawn in: the graph and tabular reports, then
// the frame of chart snaps (moved here from Libraries ▸ Charts, analyst
// request 2026-11-23: that is where reports belong).
const ALL_TEMPLATES = Object.freeze([...REPORT_TEMPLATES, ...IMAGE_TEMPLATES]);

// Libraries ▸ Report templates (analyst decision 2026-11-17): the report
// layouts, each with its preview image. The built-in NBE LinkX Graph Report
// is the default for graph reports; uploading or choosing other templates
// comes later. The chart snaps' image templates are listed here too.
export default function ReportTemplatesPanel({
  templates = ALL_TEMPLATES,
  title = 'Report templates',
  eyebrow = 'Reports',
  description = 'The layouts graph reports, tabular reports and chart snaps are drawn in. Built-in templates cannot be changed or removed.',
}) {
  const builtIn = templates.filter((template) => template.builtIn).length;
  const standards = templates.filter((template) => template.isDefault);
  const kinds = [...new Set(templates.map((template) => template.kind).filter(Boolean))];
  return (
    <SettingsPage className="config_page libraries_page">
      <Masthead>
        <PageHero
          eyebrow={eyebrow}
          title={title}
          meta={description}
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 9h18M9 9v12" />
            </svg>
          )}
        />
        <Stats label="Template figures" columns={4}>
          <Stat lead icon="layers" label="Templates" value={templates.length.toLocaleString()} note="available" />
          <Stat icon="lock" label="Built-in" value={builtIn.toLocaleString()} note="cannot be changed" />
          <Stat icon="check" label="Defaults" value={standards.length.toLocaleString()} note="one per kind of report" />
          <Stat text icon="list" label="Kinds" value={kinds.length ? kinds.join(', ') : '—'} note={`${kinds.length} kind${kinds.length === 1 ? '' : 's'}`} />
        </Stats>
      </Masthead>
      <Block title="Available templates" description="Each with a preview of a page drawn in it.">
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
      </Block>
    </SettingsPage>
  );
}
