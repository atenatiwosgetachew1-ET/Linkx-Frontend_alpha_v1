import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { BenchmarkCard, BenchmarkFrame } from '../../graph/components/BenchmarkFrame.jsx';
import { BENCH_OUTCOMES, BENCH_SIZES, SMOOTH_FPS, USABLE_FPS, clearBenchmarkRunning, saveGpuBenchmark } from '../../graph/lib/gpuBenchmark.js';
import { setGpuPreference } from '../../graph/lib/rendererPreference.js';
import { benchStepVerdict } from '../lib/benchmarkView.js';
import { gpuNameOf } from '../../../shared/device/gpuCapability.js';

// The GPU benchmark (Libraries ▸ Graph rendering), over the whole page so the
// sample graphs are drawn at the size of a large Graph window. `turnOn`: GPU
// drawing is turned on once it ends with a usable limit.

const STOPPED = {
  cancelled: 'The benchmark was cancelled. Nothing was changed.',
  hidden: 'The benchmark stopped because this tab was not visible, which would make the result wrong. Keep it in front and run it again.',
  throttled: 'The browser is holding frames back (a battery saver, or a very busy computer), so nothing could be measured. Plug the computer in, close other heavy programs, and run it again.',
  error: 'The benchmark could not run. Nothing was changed.',
};

const format = (value) => value.toLocaleString();

export default function GpuBenchmarkPage({ capability, turnOn = false, onClose }) {
  const titleId = useId();
  const stageRef = useRef(null);
  const overlayRef = useRef(null);
  const controllerRef = useRef(null);
  const [phase, setPhase] = useState('intro'); // intro | running | done | stopped
  const [current, setCurrent] = useState(null);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const [stopReason, setStopReason] = useState('');
  const name = gpuNameOf(capability);

  useEffect(() => {
    const opener = document.activeElement;
    const onHidden = () => {
      if (document.hidden) controllerRef.current?.abort('hidden');
    };
    // Leaving the page on purpose is not a crash.
    const onLeave = () => {
      if (controllerRef.current) clearBenchmarkRunning();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onLeave);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onLeave);
      controllerRef.current?.abort('closed');
      opener?.focus?.();
    };
  }, []);

  const run = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setSteps([]);
    setResult(null);
    setCurrent(null);
    setPhase('running');
    try {
      const { runGpuBenchmark } = await import('../../graph/lib/gpuBenchmarkRun.js');
      const measured = await runGpuBenchmark({
        container: stageRef.current,
        signal: controller.signal,
        gpuName: name,
        onProgress: (progress) => {
          if (controllerRef.current !== controller) return;
          if (progress.step) setSteps((list) => [...list, progress.step]);
          setCurrent(progress);
        },
      });
      if (controllerRef.current !== controller) return;
      controllerRef.current = null;
      if (measured.outcome !== BENCH_OUTCOMES.FAILED) saveGpuBenchmark(measured);
      if (measured.outcome === BENCH_OUTCOMES.OK && turnOn) setGpuPreference(true);
      if (measured.outcome === BENCH_OUTCOMES.UNSUITABLE) setGpuPreference(false);
      setResult(measured);
      setPhase('done');
    } catch (error) {
      if (controllerRef.current !== controller) return;
      controllerRef.current = null;
      setStopReason(STOPPED[error?.reason] ? error.reason : 'error');
      setPhase('stopped');
    }
  }, [name, turnOn]);

  // The button just used is gone after a step: keys stay in the page.
  useEffect(() => {
    const target = phase === 'running' ? null : overlayRef.current?.querySelector('.linkx_bench_side button');
    (target || overlayRef.current)?.focus();
  }, [phase]);

  const running = phase === 'running';
  const cancelOrClose = useCallback(() => {
    if (controllerRef.current) controllerRef.current.abort('cancelled');
    else onClose();
  }, [onClose]);

  // Escape cancels the run, then closes; Tab stays in the page.
  const onKeyDown = (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelOrClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };

  let message = null;
  if (phase === 'done' && result.outcome === BENCH_OUTCOMES.OK) {
    message = (
      <>
        <p className="linkx_bench_result">Up to <strong>{format(result.limit)}</strong> nodes</p>
        <p>GPU graphs on this computer can show up to {format(result.limit)} nodes at once. {result.warnAt < result.limit ? `Above ${format(result.warnAt)}, they are marked “may be slow”.` : 'All of them ran smoothly.'}</p>
        {turnOn ? <p>GPU drawing is now on.</p> : null}
      </>
    );
  } else if (phase === 'done' && result.outcome === BENCH_OUTCOMES.UNSUITABLE) {
    message = (
      <>
        <p className="linkx_bench_result">Standard drawing suits this computer better</p>
        <p>With the GPU, 2,000 nodes ran below {USABLE_FPS} frames a second. Standard drawing already allows 2,000, so GPU drawing is off.</p>
      </>
    );
  } else if (phase === 'done') {
    message = <p>The smallest graph could not be drawn with the GPU, so there is no result and nothing was changed.</p>;
  } else if (phase === 'stopped') {
    message = <p>{STOPPED[stopReason]}</p>;
  }

  return createPortal(
    <div ref={overlayRef} tabIndex={-1} className="linkx_bench_overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <BenchmarkFrame
        title={<span id={titleId}>GPU benchmark</span>}
        subtitle={name || 'The browser hides the name of the graphics card'}
        actions={(
          <button type="button" className="linkx_bench_button" onClick={cancelOrClose}>{running ? 'Cancel' : 'Close'}</button>
        )}
        side={(
          <>
            {phase === 'intro' ? (
              <BenchmarkCard title="Before you start">
                <p>Sample graphs are drawn at growing sizes and moved, to find how many nodes this computer can show. It usually takes 15 to 30 seconds and stops at the first size that is too slow.</p>
                <ul>
                  <li>Keep this tab in front.</li>
                  <li>Close other heavy programs, and plug a laptop in.</li>
                  <li>The page may pause for a few seconds on the larger sizes.</li>
                </ul>
                <button type="button" className="linkx_bench_button" onClick={run}>Start benchmark</button>
              </BenchmarkCard>
            ) : null}
            <BenchmarkCard title="Sizes">
              <ol className="linkx_bench_steps">
                {BENCH_SIZES.map((nodes) => {
                  const step = steps.find((item) => item.nodes === nodes);
                  const active = running && current?.nodes === nodes && !step;
                  const verdict = step ? benchStepVerdict(step) : null;
                  let note = phase === 'done' || phase === 'stopped' ? 'Not run' : 'Waiting';
                  if (active) note = current.phase === 'measuring' ? 'Measuring…' : 'Drawing…';
                  if (step) note = step.error || `${format(Math.round(step.fps))} frames a second`;
                  return (
                    <li key={nodes} className={`${active ? 'is-active' : ''}${verdict ? ` is-${verdict.tone}` : ''}`}>
                      <strong>{format(nodes)} nodes</strong>
                      <small>{note}</small>
                      {verdict ? <em>{verdict.word}</em> : null}
                    </li>
                  );
                })}
              </ol>
              <p className="linkx_bench_note">Smooth: {SMOOTH_FPS} frames a second or more. Usable: {USABLE_FPS} or more.</p>
            </BenchmarkCard>
            <div role="status" className="linkx_bench_status">
              {running && current ? <span className="linkx_bench_sr">Testing {format(current.nodes)} nodes</span> : null}
              {message ? <BenchmarkCard title={phase === 'done' ? 'Result' : 'Stopped'}>{message}</BenchmarkCard> : null}
            </div>
            {phase === 'done' || phase === 'stopped' ? (
              <div className="linkx_bench_row">
                <button type="button" className="linkx_bench_button" onClick={run}>Run again</button>
                <button type="button" className="linkx_bench_button" onClick={onClose}>Done</button>
              </div>
            ) : null}
            <p className="linkx_bench_note">A guide, not a promise: graphs with many labels, icons or links run slower than the sample.</p>
          </>
        )}
      >
        <div className="linkx_bench_stage" aria-hidden="true">
          <div ref={stageRef} className="linkx_bench_canvas" />
          {!running ? <span className="linkx_bench_stage_note">{phase === 'intro' ? 'The sample graphs are drawn here.' : 'Finished.'}</span> : null}
        </div>
      </BenchmarkFrame>
    </div>,
    document.body,
  );
}
