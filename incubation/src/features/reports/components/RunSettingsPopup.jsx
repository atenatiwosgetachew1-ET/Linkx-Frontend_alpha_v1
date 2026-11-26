// What a record's run was made with, in a popup: the Settings ▸ Users
// "Create user" popup (SettingsPopup), over the Reports window. Opened from
// the Run settings mark in the table or in the record's details.
//
// record: a Reports record with runRemark ({ kind, label, text }) and, when
// the Service recorded them, runSettings (shared/runSettings.js
// readSettingsUsed).
import React from 'react';

import { SettingsPopup } from '../../settings/components/SettingsPage.jsx';
import { formatDomainPillarLabel } from '../../configuration/lib/configModel.js';
import { formatReportDate } from '../lib/reportModel.js';

const LIST_NAMES = { fetch_columns: 'Fetch columns', search_columns_strict: 'Strict search columns', search_columns_fuzzy: 'Fuzzy search columns' };
const VERSION_NAMES = { thresholds: 'Thresholds', preset: 'Preset', mapping: 'Mapping', columns: 'Columns', profile: 'Profile' };
const KIND_NOTES = {
  overridden: 'The analyst used settings of their own for this run, so its findings may differ from the domain’s.',
  unknown: 'The Service did not record what this run was made with: it is not known whether own columns or an own column mapping were used.',
  domain: 'The run used the domain’s settings, unchanged.',
};

function Section({ title, count, children }) {
  return (
    <section className="users_section reports_settings_section">
      <h5 className="graph_customize_section_head">{title}{count !== undefined ? <small>{count}</small> : null}</h5>
      {children}
    </section>
  );
}

const Names = ({ names }) => (names.length ? <span className="reports_settings_names">{names.join(', ')}</span> : <span className="reports_settings_none">None</span>);

export default function RunSettingsPopup({ record, onClose }) {
  const remark = record.runRemark;
  const settings = record.runSettings;
  const pairs = settings ? Object.entries(settings.mapping) : [];
  const lists = settings ? Object.entries(settings.columns) : [];
  const versions = settings ? Object.entries(settings.versions).filter(([key]) => VERSION_NAMES[key]) : [];
  return (
    <SettingsPopup
      narrow
      hostSelector=".reports_window"
      title="Run settings"
      subtitle={[record.reportType, formatReportDate(record.createdAt)].filter(Boolean).join(' · ')}
      hint="As the Service recorded it when the run was queued."
      onClose={onClose}
      footer={<button type="button" className="graph_customize_button is-primary" onClick={onClose}>Done</button>}
    >
      {/* The narrow popup's body has no padding of its own (Create user
          lays out its pages itself), so the run settings bring theirs. */}
      <div className="reports_settings_body">
      <div className={`reports_settings_lead is-${remark.kind}`}>
        <span className={`reports_run_settings is-${remark.kind}`}><span aria-hidden="true" />{remark.marked ? remark.label : 'Domain’s settings'}</span>
        <p>{KIND_NOTES[remark.kind] || remark.text}</p>
      </div>

      {settings ? (
        <>
          <Section title="Run">
            <dl className="reports_settings_rows">
              <div><dt>Domain</dt><dd>{settings.domain ? formatDomainPillarLabel(settings.domain) : '—'}</dd></div>
              {settings.by ? <div><dt>Changed by</dt><dd>{settings.by}</dd></div> : null}
              {versions.map(([key, value]) => <div key={key}><dt>{VERSION_NAMES[key]} version</dt><dd>{value ?? '—'}</dd></div>)}
            </dl>
          </Section>

          {pairs.length ? (
            <Section title="Own column mapping" count={`${pairs.length} ${pairs.length === 1 ? 'column' : 'columns'}`}>
              <table className="reports_settings_table">
                <thead><tr><th scope="col">Data column</th><th scope="col">Read as</th></tr></thead>
                <tbody>{pairs.map(([source, target]) => <tr key={source}><td>{source}</td><td>{target}</td></tr>)}</tbody>
              </table>
            </Section>
          ) : null}

          {lists.length ? (
            <Section title="Own columns" count={`${lists.length} ${lists.length === 1 ? 'list' : 'lists'}`}>
              <dl className="reports_settings_rows">
                {lists.map(([key, change]) => (
                  <React.Fragment key={key}>
                    <div><dt>{LIST_NAMES[key] || key}: added</dt><dd><Names names={change.added} /></dd></div>
                    <div><dt>{LIST_NAMES[key] || key}: removed</dt><dd><Names names={change.removed} /></dd></div>
                  </React.Fragment>
                ))}
              </dl>
            </Section>
          ) : null}

          {settings.missingFields?.length ? (
            <Section title="Fields missing in the data" count={settings.missingFields.length}>
              <span className="reports_settings_names">{settings.missingFields.join(', ')}</span>
            </Section>
          ) : null}
        </>
      ) : null}
      </div>
    </SettingsPopup>
  );
}
