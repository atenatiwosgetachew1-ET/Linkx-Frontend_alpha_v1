import React, { useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { Block } from '../../settings/components/SettingsPage.jsx';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { previewPreset, saveDomainSection } from '../../../services/domainConfigApi.js';
import useDomainSection from '../hooks/useDomainSection.js';
import { formatDomainPillarLabel } from '../lib/configModel.js';
import { listChanges, valueText, wordKey } from '../lib/domainFields.js';
import { HistoryBlock } from './DomainHistory.jsx';
import { SectionMissing } from './DomainSection.jsx';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// How strict a preset is, from its name (the Service sends no such figure):
// 0 relaxed … 3 strictest; null for a name not known here (a neutral tone).
const STRICTNESS = [
  [3, /(very|extra|ultra)[_ -]?strict|aggressive|maximum|max|paranoid|critical/],
  [0, /lenient|relaxed|loose|permissive|low|light|minimal|min/],
  [2, /strict|high|tight|sensitive|heightened|elevated/],
  [1, /baseline|balanced|standard|default|normal|medium|moderate/],
];
const STRICTNESS_LABELS = ['Relaxed', 'Balanced', 'Strict', 'Strictest'];
const presetStrictness = (name) => {
  const text = String(name || '').toLowerCase();
  const found = STRICTNESS.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : null;
};

// A gauge whose needle leans further right the stricter the preset.
function StrictnessGauge({ level }) {
  const angle = ((level ?? 1.5) / 3) * 150 - 75;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16V9.5" transform={`rotate(${angle} 12 16)`} />
      <circle cx="12" cy="16" r="1.3" fill="currentColor" />
    </svg>
  );
}

// Configuration ▸ Domains ▸ Sensitivity: a domain's preset, which sets many
// thresholds at once. What it would change is always shown first.
export default function DomainSensitivity({ apiFetch, domain, canManage, notify, requestConfirmation, thresholdsDirty }) {
  const { state, status, error, history, reload, save } = useDomainSection({ apiFetch, domain, section: 'sensitivity', canManage });
  const [busy, setBusy] = useState('');
  const label = formatDomainPillarLabel(domain);

  if (status === 'loading') return <WindowLoadScreen className="is-block" label="Loading the domain’s sensitivity…" />;
  if (status !== 'ready') return <SectionMissing title="Sensitivity" status={status} error={error} onRetry={reload} />;

  const names = Object.keys(state.presets);
  // Asked of the Service where it answers a dry run; a Service from before
  // would apply it instead, so there it is worked out from the preset's values.
  const changesOf = async (name) => {
    if (state.versioned) return previewPreset(apiFetch, domain, name);
    const values = state.presets[name];
    return values && typeof values === 'object'
      ? Object.entries(values).filter(([key, value]) => !same(state.thresholds[key], value)).map(([key, value]) => ({ key, from: state.thresholds[key], to: value }))
      : null;
  };

  const apply = async (name) => {
    setBusy(name);
    try {
      const changes = await changesOf(name);
      if (changes && !changes.length && name === state.preset && !state.modified.length) {
        notify({ title: 'Nothing to change', message: `${label} is on the preset “${name}” already.`, level: 'info', source: 'Configuration' });
        return;
      }
      const what = changes === null
        ? 'The Service did not say which thresholds it changes.'
        : changes.length
          ? `It changes ${changes.length} threshold${changes.length === 1 ? '' : 's'}, those set by hand too: ${listChanges(changes.map(({ key, from, to }) => ({ label: wordKey(key), from: valueText(from), to: valueText(to) })))}`
          : 'No threshold changes value.';
      const confirmed = await requestConfirmation({
        title: `Apply “${name}” to ${label}?`,
        icon: 'warning',
        message: `Everyone working in ${label} gets this from their next run. ${what}`,
        confirmText: 'Apply',
      });
      if (!confirmed) return;
      const result = await save(() => saveDomainSection(apiFetch, domain, 'sensitivity', { preset: name }, state.versionId));
      if (!result.ok) {
        notify({ title: 'Not applied: changed meanwhile', message: `${result.conflict.updatedBy || 'Someone else'} changed ${label} meanwhile. It is shown now; apply the preset again if you still want it.`, level: 'warning', source: 'Configuration' });
        return;
      }
      notify({ title: 'Preset applied', message: `${label} uses “${name}” from the next run.`, level: 'success', source: 'Configuration' });
    } catch (failure) {
      notify({ title: 'Preset not applied', message: getServiceRefusalMessage(failure) || failure?.message || 'The preset could not be applied.', level: 'error', source: 'Configuration' });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Block title="Sensitivity" description={canManage ? 'A preset sets many thresholds at once, for everyone in this domain. What it changes is listed before it is applied.' : 'You need users:manage to apply a preset.'}>
        {state.enforced ? null : <div className="settings_error" role="alert">Saved, but the Service does not apply it at the moment.</div>}
        {state.modified.length ? (
          <div className="config_domain_notice" role="status">
            Changed by hand since the preset was applied: {state.modified.slice(0, 12).map(wordKey).join(', ')}{state.modified.length > 12 ? ` and ${state.modified.length - 12} more` : ''}.
          </div>
        ) : null}
        {thresholdsDirty ? <div className="config_domain_notice" role="status">You have unsaved thresholds in this domain. A preset does not include them, and they stay unsaved.</div> : null}
        {names.length ? (
          <ul className="config_domain_presets" aria-label="Presets">
            {names.map((name) => {
              const values = state.presets[name];
              const count = values && typeof values === 'object' ? Object.keys(values).length : 0;
              const active = name === state.preset;
              const level = presetStrictness(name);
              return (
                <li key={name} className={`config_preset is-level-${level ?? 'unknown'}${active ? ' is-on' : ''}`}>
                  <span className="config_preset_icon"><StrictnessGauge level={level} /></span>
                  <span className="config_preset_text">
                    <small>{level == null ? 'Preset' : STRICTNESS_LABELS[level]}</small>
                    <strong title={name}>{wordKey(name)}</strong>
                    <span className="config_preset_tags">
                      {active ? <em>{state.modified.length ? 'In use, changed by hand' : 'In use'}</em> : null}
                      {count ? <em>{count} thresholds</em> : null}
                    </span>
                  </span>
                  {canManage ? (
                    <button type="button" className="settings_button" aria-label={`Apply ${name}`} disabled={Boolean(busy) || (active && !state.modified.length)} onClick={() => apply(name)}>{busy === name ? 'Checking…' : active ? 'Apply again' : 'Apply…'}</button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : <p className="settings_hint">This domain has no presets. Set its thresholds one by one.</p>}
      </Block>
      {canManage ? <HistoryBlock label="Sensitivity history" description="Every preset applied, newest first." items={history} heading="Preset" describe={(item) => [item.preset, item.threshold_version_id != null ? `thresholds v${item.threshold_version_id}` : ''].filter(Boolean).join(' · ')} /> : null}
    </>
  );
}
