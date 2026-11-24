import React, { useState, useSyncExternalStore } from 'react';

import { Block, Masthead, Option, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { GPU_STATUS, GPU_VERDICTS, getGpuCapability, gpuNameOf, recheckGpuCapability, subscribeGpuCapability } from '../../../shared/device/gpuCapability.js';
import { BENCH_OUTCOMES, benchmarkChanges, getGpuBenchmark, getGpuLimits, getUnfinishedBenchmark, subscribeGpuBenchmark } from '../../graph/lib/gpuBenchmark.js';
import { getGpuPreference, getSystemGpuSetting, isGpuAllowedBySystem, setGpuPreference, subscribeGpuPreference } from '../../graph/lib/rendererPreference.js';
import { benchStepVerdict } from '../lib/benchmarkView.js';
import GpuBenchmarkPage from './GpuBenchmarkPage.jsx';

// Libraries → Graph rendering (libraries-plan §3, graph-chart-plan §3.9).
// Scope: this device. GPU (WebGL) rendering is OFF by default and can only be
// turned on when the system allows it and the browser can use the graphics
// card now, after a benchmark that sets this computer's limit
// (gpuBenchmark.js). A choice already made can always be turned off. The page never
// says a graphics card is missing: the browser does not tell.

const BROWSER_STEPS = [
  'In the browser settings, turn on graphics (hardware) acceleration, then restart the browser.',
  'Update the graphics driver.',
  'A remote desktop or virtual machine often cannot use the computer\'s graphics card.',
  'To see what the browser uses, open chrome://gpu, edge://gpu or about:support (Firefox).',
];
const RETRY_STEPS = ['Restart the browser, then press Check again.', ...BROWSER_STEPS];

const STATUS = {
  [GPU_STATUS.HARDWARE]: { word: 'Available', text: 'The browser draws with the graphics card.' },
  [GPU_STATUS.UNNAMED]: { word: 'Available', text: 'The browser draws with graphics hardware, but hides which card.' },
  [GPU_STATUS.CAVEAT]: { word: 'Available, may be slow', text: 'The browser can draw with the graphics card, but expects it to be slow.' },
  [GPU_STATUS.SOFTWARE]: {
    word: 'Not in use',
    text: 'The browser is drawing in software, without the graphics card. This does not mean the computer has none.',
    steps: BROWSER_STEPS,
  },
  [GPU_STATUS.UNCONFIRMED]: {
    word: 'Not confirmed',
    text: 'The browser will not confirm that it draws with a graphics card. This does not mean the computer has none.',
    steps: BROWSER_STEPS,
  },
  [GPU_STATUS.UNAVAILABLE]: {
    word: 'Not available now',
    text: 'The browser is not offering WebGL 2 to this page. It may be turned off, blocked after a fault, or not supported. This does not mean the computer has no graphics card.',
    steps: RETRY_STEPS,
  },
  [GPU_STATUS.TEST_FAILED]: {
    word: 'Test failed',
    text: 'The browser offers the graphics card, but the draw test did not finish.',
    steps: RETRY_STEPS,
  },
  [GPU_STATUS.GRAPH_FAILED]: {
    word: 'Paused',
    text: 'A graph could not be drawn with the GPU, so GPU drawing is paused in this browser tab. This can follow sleep, a driver restart or a browser fault.',
    steps: ['Press Check again to try once more.', 'If it keeps happening, turn GPU drawing off or update the graphics driver.'],
  },
};
// A result without a known status (never shown as a missing card).
const statusOf = (capability) => STATUS[capability.status]
  || STATUS[capability.verdict === GPU_VERDICTS.CAPABLE ? GPU_STATUS.UNNAMED : GPU_STATUS.UNCONFIRMED];

const SYSTEM_SETTING = {
  off: { value: 'Turned off', note: 'graph_gpu_allowed' },
  allowed: { value: 'Allowed', note: 'graph_gpu_allowed' },
  not_set: { value: 'Not set', note: 'Not restricted' },
};

const formatTime = (value) => new Date(value).toLocaleString();

export default function GraphRenderingPanel({ configuration }) {
  const preferGpu = useSyncExternalStore(subscribeGpuPreference, getGpuPreference);
  // Checking creates a short-lived WebGL context; the result is kept for this
  // browser tab. A failure in a graph shows here at once.
  const capability = useSyncExternalStore(subscribeGpuCapability, getGpuCapability);
  const allowedBySystem = isGpuAllowedBySystem(configuration);
  const usable = capability.verdict === GPU_VERDICTS.CAPABLE;
  const canEnable = allowedBySystem && usable;
  const active = preferGpu && canEnable;
  const status = statusOf(capability);
  const system = SYSTEM_SETTING[getSystemGpuSetting(configuration)];
  const cautions = capability.cautions || [];
  const benchmark = useSyncExternalStore(subscribeGpuBenchmark, getGpuBenchmark);
  const limits = useSyncExternalStore(subscribeGpuBenchmark, getGpuLimits);
  const unfinishedAt = useSyncExternalStore(subscribeGpuBenchmark, getUnfinishedBenchmark);
  const [benchmarking, setBenchmarking] = useState(null); // { turnOn }
  const measured = benchmark?.outcome === BENCH_OUTCOMES.OK;
  const changes = benchmark ? benchmarkChanges(benchmark, { renderer: gpuNameOf(capability) }) : [];
  const choose = (checked) => {
    if (checked && !measured) setBenchmarking({ turnOn: true });
    else setGpuPreference(checked);
  };

  let reason = '';
  if (!allowedBySystem) reason = 'GPU rendering is turned off for everyone by the system configuration (graph_gpu_allowed).';
  else if (!usable) reason = status.text;

  let pill = 'GPU off';
  if (active) pill = 'GPU on';
  else if (preferGpu) pill = 'GPU chosen, not in use';

  return (
    <SettingsPage className="config_page libraries_page libraries_rendering">
      <Masthead>
        <PageHero
          tone={active ? 'active' : ''}
          eyebrow="Graph rendering"
          title={active ? 'GPU drawing' : 'Standard drawing'}
          pill={<Pill tone={active ? 'active' : 'neutral'} dot>{pill}</Pill>}
          meta="How Graph windows are drawn. The choice applies to this browser only."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
            </svg>
          )}
        />
        <Stats label="Rendering figures" columns={3}>
          <Stat text icon="bolt" label="GPU drawing" value={status.word} wrap tone={usable && !cautions.length ? 'success' : ''} note="in this browser" />
          <Stat text icon="shield" label="System setting" value={system.value} note={system.note} />
          <Stat text icon="clock" label="Last checked" value={capability.checkedAt ? formatTime(capability.checkedAt) : '—'} wrap note="kept for this browser tab" />
        </Stats>
      </Masthead>

      <Block title="Drawing" description="GPU drawing is off by default. It can be turned on when the system does not forbid it and the browser can use the graphics card.">
        <div className="settings_options libraries_gpu_option">
          <Option
            icon="motion"
            title="Use the GPU for graphs"
            description={`Can be faster for large graphs. ${measured ? '' : 'Turning it on first runs a short benchmark that sets how many nodes this computer can show. '}If the GPU fails, graphs switch back to standard drawing on their own.`}
            checked={preferGpu}
            disabled={!preferGpu && !canEnable}
            onChange={choose}
          />
        </div>
        {reason ? <p className="settings_hint" role="status">{reason}</p> : null}
        {preferGpu && !canEnable ? (
          <p className="settings_hint">You chose GPU drawing, but it cannot be used now, so standard drawing is used. You can leave the choice on or turn it off.</p>
        ) : null}
        <p className="libraries_current" role="status">
          Graphs are drawn with <strong>{active ? 'the GPU' : 'standard drawing'}</strong>.
        </p>
        {active && !measured ? (
          <p className="settings_hint" role="status">
            GPU graphs use a temporary limit of {limits.cap.toLocaleString()} nodes until the benchmark is run.
          </p>
        ) : null}
      </Block>

      <Block
        title="Benchmark"
        description="Sets how many nodes a GPU graph may show on this computer. Kept in this browser; run it again whenever you like."
        actions={(
          <button type="button" className="settings_button" disabled={!canEnable} onClick={() => setBenchmarking({ turnOn: false })}>
            {benchmark ? 'Run again' : 'Run benchmark'}
          </button>
        )}
      >
        <div className="config_card">
          {unfinishedAt ? (
            <p className="libraries_verdict is-not_capable" role="status">
              The last benchmark did not finish: the browser stopped at {unfinishedAt.toLocaleString()} nodes.{benchmark ? ' The result below is from before.' : ''}
            </p>
          ) : null}
          {measured ? (
            <p className="libraries_verdict is-capable">
              Up to {benchmark.limit.toLocaleString()} nodes{benchmark.warnAt < benchmark.limit ? `; may be slow above ${benchmark.warnAt.toLocaleString()}` : ''}.
            </p>
          ) : null}
          {benchmark && !measured ? (
            <p className="libraries_verdict">Standard drawing suits this computer better: 2,000 nodes were too slow with the GPU.</p>
          ) : null}
          {!benchmark ? <p className="libraries_current">Not run yet.</p> : null}
          {changes.length ? <p className="settings_hint" role="status">This result may be out of date: {changes.join(', and ')}.</p> : null}
          {benchmark ? (
            <>
              <ul className="libraries_reasons">
                {benchmark.steps.map((step) => (
                  <li key={step.nodes}>
                    {step.nodes.toLocaleString()} nodes: {step.error || `${Math.round(step.fps)} frames a second`} ({benchStepVerdict(step).word.toLowerCase()})
                  </li>
                ))}
              </ul>
              <p className="settings_hint">
                Run {formatTime(benchmark.at)}{benchmark.renderer ? ` with ${benchmark.renderer}` : ''}{benchmark.browser ? ` in ${benchmark.browser}` : ''}. A guide: graphs with many labels, icons or links run slower.
              </p>
            </>
          ) : null}
        </div>
      </Block>

      <Block
        title="This browser"
        description="A web page cannot see the computer's graphics card, only what the browser lets it use."
        actions={(
          <button type="button" className="settings_button" onClick={recheckGpuCapability}>
            Check again
          </button>
        )}
      >
        <div className="config_card">
          <p className={`libraries_verdict is-${capability.verdict}`}>{status.text}</p>
          <ul className="libraries_reasons">
            {[...(capability.reasons || []), ...cautions].map((item) => <li key={item}>{item}</li>)}
          </ul>
          {status.steps ? (
            <>
              <p className="settings_hint">What you can try:</p>
              <ul className="libraries_reasons">
                {status.steps.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          ) : null}
          {capability.failedAt ? <p className="settings_hint">Stopped {formatTime(capability.failedAt)}.</p> : null}
          {capability.checkedAt ? <p className="settings_hint">Checked {formatTime(capability.checkedAt)}.</p> : null}
          {import.meta.env.DEV ? (
            <a className="libraries_link" href="?graph-bench" target="_blank" rel="noopener noreferrer">Open the graph benchmark (developer build only)</a>
          ) : null}
        </div>
      </Block>
      {benchmarking ? (
        <GpuBenchmarkPage capability={capability} turnOn={benchmarking.turnOn} onClose={() => setBenchmarking(null)} />
      ) : null}
    </SettingsPage>
  );
}
