import React, { useState } from 'react';

import { sanitizeText } from '../../../../utils/inputSecurity.js';
import {
  DATAFRAME_STATUSES,
  formatFileDate,
  formatFileSize,
  getFileExtension,
  SOURCE_STATUSES,
  STALE_DATAFRAME_PATCH,
  UPLOAD_FILE_TYPES,
  UPLOAD_LIMITS,
  UPLOAD_STATUSES,
  uploadAcceptValue,
} from '../../lib/sourceModel.js';
import { getStagedFiles, setStagedFiles } from '../../lib/sourceRuntime.js';
import { SourceModeIcon } from '../sourceUi.jsx';

export function UploadStep({ state, windowId, validationMessage, toolPanel, onPatchModeState }) {
  // Unique per window: a shared id made the drop zone of one Source window
  // open (and stage files into) another window's input.
  const uploadInputId = `source-window-upload-input-${windowId}`;
  const selectedFiles = state.selectedFiles || [];
  const [uploadError, setUploadError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  // Per-file metadata; falls back to name-only rows for state staged before details were tracked.
  const fileRows = selectedFiles.map((name, index) => {
    const detail = (state.selectedFileDetails || [])[index];
    return detail && detail.name === name ? detail : { name, extension: getFileExtension(name), size: null, lastModified: 0 };
  });
  const totalStagedSize = fileRows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);

  // Any change to the staged set means a fresh upload + dataframe.
  const stagedChangePatch = { ...STALE_DATAFRAME_PATCH, uploadStatus: UPLOAD_STATUSES.IDLE, uploadedFiles: [] };

  const removeFileAt = (index) => {
    const remaining = fileRows.filter((_, rowIndex) => rowIndex !== index);
    setStagedFiles(windowId, getStagedFiles(windowId).filter((_, fileIndex) => fileIndex !== index));
    setUploadError('');
    if (remaining.length === 0) {
      onPatchModeState({
        ...stagedChangePatch,
        selectedFiles: [],
        selectedFileDetails: [],
        sourceStatus: SOURCE_STATUSES.IDLE,
        sourceMessage: 'Not connected.',
      });
      return;
    }
    onPatchModeState({
      ...stagedChangePatch,
      selectedFiles: remaining.map((row) => row.name),
      selectedFileDetails: remaining,
      sourceMessage: remaining.length === 1 ? '1 file staged for dataframe creation.' : remaining.length + ' files staged for dataframe creation.',
    });
  };

  const applyFiles = (fileList) => {
    if (state.preparing) return;
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (files.length > UPLOAD_LIMITS.maxFiles) {
      setUploadError('Select ' + UPLOAD_LIMITS.maxFiles + ' files or fewer.');
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (totalSize > UPLOAD_LIMITS.maxTotalSizeBytes) {
      setUploadError('Total staged upload size must be ' + formatFileSize(UPLOAD_LIMITS.maxTotalSizeBytes) + ' or less.');
      return;
    }

    const rejectedFile = files.find((file) => {
      const fileName = String(file.name || '');
      const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
      return !UPLOAD_LIMITS.allowedExtensions.has(extension) || Number(file.size || 0) > UPLOAD_LIMITS.maxFileSizeBytes;
    });

    if (rejectedFile) {
      setUploadError('Only supported files up to ' + formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes) + ' each can be staged.');
      return;
    }

    const staged = files
      .map((file) => {
        const name = sanitizeText(file.name, { maxLength: 160 });
        return {
          file,
          detail: {
            name,
            extension: getFileExtension(name),
            size: Number(file.size || 0),
            lastModified: Number(file.lastModified || 0),
          },
        };
      })
      .filter((item) => Boolean(item.detail.name));
    const nextDetails = staged.map((item) => item.detail);
    const nextFiles = nextDetails.map((detail) => detail.name);
    if (nextFiles.length === 0) return;
    setUploadError('');
    // The File objects stay in the runtime registry; state keeps plain data.
    setStagedFiles(windowId, staged.map((item) => item.file));
    onPatchModeState({
      ...stagedChangePatch,
      selectedFiles: nextFiles,
      selectedFileDetails: nextDetails,
      sourceStatus: SOURCE_STATUSES.UPLOADED,
      sourceMessage: nextFiles.length === 1 ? '1 file staged for dataframe creation.' : nextFiles.length + ' files staged for dataframe creation.',
    });
  };

  return (
    <div className="source_window_step_body source_window_step_body_single">
      <section className="source_window_section source_window_upload_page">
        <header>
          <h3>Upload source files</h3>
          <span className="source_window_hint">Drag and drop files, or browse from this workstation.</span>
        </header>
        <label
          className={`source_window_upload_drop${isDragOver ? ' is-drag-over' : ''}`}
          htmlFor={uploadInputId}
          onDragOver={(event) => {
            event.preventDefault();
            if (!isDragOver) setIsDragOver(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            // Moving over the zone's own children also fires dragleave.
            if (event.currentTarget.contains(event.relatedTarget)) return;
            setIsDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragOver(false);
            applyFiles(event.dataTransfer.files);
          }}
        >
          <input
            id={uploadInputId}
            type="file"
            multiple
            accept={uploadAcceptValue}
            disabled={Boolean(state.preparing)}
            onChange={(event) => {
              applyFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <span className="source_window_upload_mark">
            <SourceModeIcon type="upload" />
          </span>
          <span className="source_window_upload_text">
            <strong>{isDragOver ? 'Release to upload files' : 'File upload'}</strong>
            <small>{isDragOver ? 'Drop files now to stage them for dataframe creation.' : 'Drop source files here or browse to stage them for dataframe creation.'}</small>
          </span>
        </label>
        <div className="source_window_upload_summary">
          <div className="source_window_upload_summary_header">
            <span className="source_window_upload_summary_title">
              <strong>{selectedFiles.length ? selectedFiles.length + (selectedFiles.length === 1 ? ' file staged' : ' files staged') : 'No files selected yet'}</strong>
              {selectedFiles.length > 0 && totalStagedSize > 0 && (
                <small>{formatFileSize(totalStagedSize)} total · up to {UPLOAD_LIMITS.maxFiles} files, {formatFileSize(UPLOAD_LIMITS.maxFileSizeBytes)} each</small>
              )}
            </span>
            {selectedFiles.length > 0 && (
              <button
                type="button"
                className="source_window_upload_clear_btn linkx_tooltip_anchor"
                data-tooltip="Drop all staged files"
                aria-label="Drop all staged files"
                onClick={() => {
                  setUploadError('');
                  setStagedFiles(windowId, []);
                  onPatchModeState({
                    ...stagedChangePatch,
                    selectedFiles: [],
                    selectedFileDetails: [],
                    sourceStatus: SOURCE_STATUSES.IDLE,
                    sourceMessage: 'Not connected.',
                  });
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
          {uploadError && <p className="source_window_validation" role="status">{uploadError}</p>}
          {validationMessage && !uploadError && <p className="source_window_validation" role="alert">{validationMessage}</p>}
          {fileRows.length > 0 && (
            <ul className="source_window_upload_file_list">
              {fileRows.map((row, index) => {
                const typeLabel = UPLOAD_FILE_TYPES[row.extension] || 'File';
                const meta = [typeLabel, formatFileSize(row.size), formatFileDate(row.lastModified) && 'Modified ' + formatFileDate(row.lastModified)]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={row.name + '-' + index} className="source_window_upload_file_row">
                    <span className={'source_window_upload_file_badge is-' + (row.extension || 'file')} aria-hidden="true">
                      {(row.extension || 'file').toUpperCase()}
                    </span>
                    <span className="source_window_upload_file_info">
                      <strong title={row.name}>{row.name}</strong>
                      <small>{meta}</small>
                    </span>
                    <button
                      type="button"
                      className="source_window_upload_clear_btn source_window_upload_file_drop linkx_tooltip_anchor"
                      data-tooltip="Drop this file"
                      aria-label={'Drop ' + row.name}
                      onClick={() => removeFileAt(index)}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {state.uploadStatus === UPLOAD_STATUSES.UPLOADED && (
            <p className="source_window_status_text" role="status">Uploaded to this source session.</p>
          )}
          {state.uploadStatus === UPLOAD_STATUSES.FAILED && state.sourceMessage && (
            <p className="source_window_validation" role="status">{state.sourceMessage}</p>
          )}
          {state.dataframeStatus === DATAFRAME_STATUSES.FAILED && state.dataframeMessage && (
            <p className="source_window_validation" role="status">{state.dataframeMessage}</p>
          )}
        </div>
      </section>
      {toolPanel}
    </div>
  );
}
