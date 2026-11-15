import React, { useState, useSyncExternalStore } from 'react';

import { Section } from '../../../shared/components/form/FormFields.jsx';
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

  return (
    <>
      <Section title="Graph rendering" description="How Graph windows are drawn on this device. Applies to this browser only.">
        <label className="libraries_switch">
          <input
            type="checkbox"
            checked={active}
            disabled={!canEnable}
            onChange={(event) => setGpuPreference(event.target.checked)}
          />
          <span>
            <strong>Use the GPU for graphs</strong>
            <small>
              Faster for large graphs (smooth up to about 1,000 shown nodes, usable up to 5,000; standard drawing is comfortable up to 300).
              Off by default. If the GPU fails, graphs switch back to standard drawing on their own.
            </small>
          </span>
        </label>
        {reason ? <p className="settings_hint" role="status">{reason}</p> : null}
        {preferGpu && !canEnable ? (
          <p className="settings_hint">GPU rendering was chosen on this device but is not available now, so standard drawing is used.</p>
        ) : null}
        <p className="libraries_current" role="status">
          Graphs are drawn with <strong>{active ? 'the GPU' : 'standard drawing'}</strong>.
        </p>
      </Section>

      <Section
        title="This device"
        description="Browsers do not report GPU memory; the check looks for real hardware drawing."
        actions={(
          <button type="button" className="settings_button" onClick={() => setCapability(getGpuCapability({ force: true }))}>
            Check again
          </button>
        )}
      >
        <p className={`libraries_verdict is-${capability.verdict}`}>{VERDICT_TEXT[capability.verdict]}</p>
        <ul className="libraries_reasons">
          {(capability.reasons || []).map((item) => <li key={item}>{item}</li>)}
        </ul>
        {capability.checkedAt ? <p className="settings_hint">Checked {new Date(capability.checkedAt).toLocaleString()}.</p> : null}
        {import.meta.env.DEV ? (
          <a className="settings_link" href="?graph-bench" target="_blank" rel="noopener noreferrer">Open the graph benchmark (developer build only)</a>
        ) : null}
      </Section>
    </>
  );
}
