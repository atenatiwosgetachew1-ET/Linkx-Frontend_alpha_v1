import React from 'react';

import {
  SOURCE_MODES,
  SOURCE_STATUSES,
  TOOL_STATUSES,
  UPLOAD_STATUSES,
} from '../../lib/sourceModel.js';
import { SOURCE_FLOW } from '../../lib/sourceFrame.js';
import { BrokerFlowStep } from './BrokerFlowStep.jsx';
import { BrokerStep } from './BrokerStep.jsx';
import { ConnectStep } from './ConnectStep.jsx';
import { DataframeStep } from './DataframeStep.jsx';
import { ElasticSearchStep } from './ElasticSearchStep.jsx';
import { StorageStep } from './StorageStep.jsx';
import { StreamStep } from './StreamStep.jsx';
import { ToolConnectionPanel } from './ToolConnectionPanel.jsx';
import { UploadStep } from './UploadStep.jsx';

export function WorkflowBody({ mode, modeState, windowId, sessionId, streamLogLines, defaults, validationMessage, toolValidationMessage, toolOptions, handlers, onPatchModeState, onOpenConfiguration, onOpenLibrary, onOpenFilter, onOpenMapping = null, keepRunning, dataframeNotice = '' }) {
  // Upload flow connects the tool automatically; the panel only appears when
  // that failed so the analyst can correct the details.
  const uploadToolPanel = modeState.uploadStatus === UPLOAD_STATUSES.UPLOADED && modeState.toolStatus !== TOOL_STATUSES.CONNECTED ? (
    <ToolConnectionPanel
      state={modeState}
      windowId={windowId}
      mode={mode}
      toolOptions={toolOptions}
      validationMessage={toolValidationMessage}
      onPatchModeState={onPatchModeState}
      onToolAction={handlers.onToolAction}
    />
  ) : null;
  // Storage and Elastic search: the tool is connected automatically on
  // Continue; show the panel only when that failed so it can be corrected.
  const storageToolPanel = modeState.sourceStatus === SOURCE_STATUSES.CONNECTED &&
      [TOOL_STATUSES.FAILED, TOOL_STATUSES.DISCONNECTED].includes(modeState.toolStatus) ? (
        <ToolConnectionPanel
          state={modeState}
          windowId={windowId}
          mode={mode}
          toolOptions={toolOptions}
          validationMessage={toolValidationMessage}
          onPatchModeState={onPatchModeState}
          onToolAction={handlers.onToolAction}
        />
      ) : null;
  // The broker page works the same way.
  const brokerStep = SOURCE_FLOW ? (
    <BrokerFlowStep
      state={modeState}
      defaults={defaults}
      windowId={windowId}
      validationMessage={validationMessage}
      toolPanel={storageToolPanel}
      onPatchModeState={onPatchModeState}
      onSourceAction={handlers.onSourceAction}
    />
  ) : (
    <BrokerStep
      mode={mode}
      state={modeState}
      windowId={windowId}
      toolOptions={toolOptions}
      validationMessage={validationMessage}
      toolValidationMessage={toolValidationMessage}
      onPatchModeState={onPatchModeState}
      onSourceAction={handlers.onSourceAction}
      onToolAction={handlers.onToolAction}
    />
  );
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload' && modeState.selectedConnectionType === 'storage') {
    return (
      <StorageStep
        state={modeState}
        defaults={defaults}
        windowId={windowId}
        validationMessage={validationMessage}
        toolPanel={storageToolPanel}
        onPatchModeState={onPatchModeState}
        onSourceAction={handlers.onSourceAction}
        onSearch={handlers.onStorageSearch}
        onSwitchDomain={handlers.onSwitchDomain}
      />
    );
  }
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload' && modeState.selectedConnectionType === 'broker') {
    return brokerStep;
  }
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload' && modeState.selectedConnectionType === 'search') {
    return (
      <ElasticSearchStep
        state={modeState}
        defaults={defaults}
        windowId={windowId}
        validationMessage={validationMessage}
        toolPanel={storageToolPanel}
        onPatchModeState={onPatchModeState}
        onSourceAction={handlers.onSourceAction}
        onSearch={handlers.onElasticSearch}
      />
    );
  }
  if (mode === SOURCE_MODES.REALTIME && modeState.step === 'connect') {
    return brokerStep;
  }
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload') {
    return <UploadStep state={modeState} windowId={windowId} validationMessage={validationMessage} toolPanel={uploadToolPanel} onPatchModeState={onPatchModeState} />;
  }
  if (modeState.step === 'dataframe') return <DataframeStep mode={mode} state={modeState} defaults={defaults} validationMessage={validationMessage || dataframeNotice} onPatchModeState={onPatchModeState} onOpenConfiguration={onOpenConfiguration} onOpenLibrary={onOpenLibrary} onOpenFilter={onOpenFilter} onOpenMapping={onOpenMapping} />;
  if (modeState.step === 'stream') return <StreamStep state={modeState} sessionId={sessionId} windowId={windowId} logLines={streamLogLines} validationMessage={validationMessage} keepRunning={keepRunning} />;
  return (
    <ConnectStep
      mode={mode}
      state={modeState}
      windowId={windowId}
      toolOptions={toolOptions}
      validationMessage={validationMessage}
      onPatchModeState={onPatchModeState}
      onSourceAction={handlers.onSourceAction}
      onToolAction={handlers.onToolAction}
    />
  );
}
