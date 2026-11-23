import React, { useState, useSyncExternalStore } from 'react';

import { Block, Masthead, Option, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { GPU_VERDICTS, getGpuCapability } from '../../../shared/device/gpuCapability.js';
import { getGpuPreference, isGpuAllowedBySystem, setGpuPreference, subscribeGpuPreference } from '../../graph/lib/rendererPreference.js';

// Libraries → Graph rendering (libraries-plan §3, graph-chart-plan §3.9).
// Scope: this device. GPU (WebGL) rendering is OFF by default and can only be
// turned on when the system allows it and this device is capable.

const VERDICT_TEXT = {
  [GPU_VERDICTS.CAPABLE]: 'This device can draw graphs with its GPU.',
  [GPU_VERDICTS.NOT_CAPABLE]: 'This device cannot draw graphs with its GPU.',
  [GPU_VERDICTS.UNKNOWN]: 'Hardware drawing is available, but the GPU could not be identified, so GPU rendering stays off.',
};

export default function GraphRenderingPanel({ configuration }) {
  const preferGpu = useSyncExternalStore(subscribeGpuPreference, getGpuPreference);
  // Probing creates a short-lived WebGL context; it is cached per browser.
  const [capability, setCapability] = useState(() => getGpuCapability());
  const allowedBySystem = isGpuAllowedBySystem(configuration);
  const capable = capability.verdict === GPU_VERDICTS.CAPABLE;
  const canEnable = allowedBySystem && capable;
  const active = preferGpu && canEnable;

  let reason = '';
  if (!allowedBySystem) reason = 'GPU rendering is turned off for everyone by the system configuration (graph_gpu_allowed).';
  else if (!capable) reason = VERDICT_TEXT[capability.verdict];

  const verdictWord = capable ? 'Capable' : capability.verdict === GPU_VERDICTS.NOT_CAPABLE ? 'Not capable' : 'Unknown';

  return (
    <SettingsPage className="config_page libraries_page libraries_rendering">
      <Masthead>
        <PageHero
          tone={active ? 'active' : ''}
          eyebrow="Graph rendering"
          title={active ? 'GPU drawing' : 'Standard drawing'}
          pill={<Pill tone={active ? 'active' : 'neutral'} dot>{active ? 'GPU on' : 'GPU off'}</Pill>}
          meta="How Graph windows are drawn on this device. Applies to this browser only."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
            </svg>
          )}
        />
        <Stats label="Rendering figures" columns={3}>
          <Stat text icon="bolt" label="This device" value={verdictWord} tone={capable ? 'success' : ''} note="GPU check" />
          <Stat text icon="shield" label="System setting" value={allowedBySystem ? 'Allowed' : 'Turned off'} note="graph_gpu_allowed" />
          <Stat text icon="clock" label="Last checked" value={capability.checkedAt ? new Date(capability.checkedAt).toLocaleString() : '—'} wrap note="cached per browser" />
        </Stats>
      </Masthead>

      <Block title="Drawing" description="GPU rendering is off by default, and can be turned on only when the system allows it and this device is capable.">
        <div className="settings_options libraries_gpu_option">
          <Option
            icon="motion"
            title="Use the GPU for graphs"
            description="Faster for large graphs (smooth up to about 1,000 shown nodes, usable up to 5,000; standard drawing is comfortable up to 300). If the GPU fails, graphs switch back to standard drawing on their own."
            checked={active}
            disabled={!canEnable}
            onChange={(checked) => setGpuPreference(checked)}
          />
        </div>
        {reason ? <p className="settings_hint" role="status">{reason}</p> : null}
        {preferGpu && !canEnable ? (
          <p className="settings_hint">GPU rendering was chosen on this device but is not available now, so standard drawing is used.</p>
        ) : null}
        <p className="libraries_current" role="status">
          Graphs are drawn with <strong>{active ? 'the GPU' : 'standard drawing'}</strong>.
        </p>
      </Block>

      <Block
        title="This device"
        description="Browsers do not report GPU memory; the check looks for real hardware drawing."
        actions={(
          <button type="button" className="settings_button" onClick={() => setCapability(getGpuCapability({ force: true }))}>
            Check again
          </button>
        )}
      >
        <div className="config_card">
          <p className={`libraries_verdict is-${capability.verdict}`}>{VERDICT_TEXT[capability.verdict]}</p>
          <ul className="libraries_reasons">
            {(capability.reasons || []).map((item) => <li key={item}>{item}</li>)}
          </ul>
          {capability.checkedAt ? <p className="settings_hint">Checked {new Date(capability.checkedAt).toLocaleString()}.</p> : null}
          {import.meta.env.DEV ? (
            <a className="libraries_link" href="?graph-bench" target="_blank" rel="noopener noreferrer">Open the graph benchmark (developer build only)</a>
          ) : null}
        </div>
      </Block>
    </SettingsPage>
  );
}
