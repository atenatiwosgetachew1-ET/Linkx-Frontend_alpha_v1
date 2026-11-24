import React, { useMemo, useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
import { useSession } from '../../shared/session/useSession.js';
import { resolveSourceDefaults } from '../../features/source/lib/sourceConfig.js';
import { quickReview } from '../lib/quickReview.js';
import { getTasksSnapshot, isTaskActive, subscribeTasks } from '../../features/tasks/lib/taskRegistry.js';

// The quick panel is not connected to the Service yet (analyst decision
// 2026-11-24: no simulated runs or findings). It shows what would be used and
// runs nothing: no task, no result. Plan: the formal analysis pipeline, with
// limits (docs/backend-requests.md B-35).
const footerLinks = ['Privacy Policy', 'Terms of Service', 'Contact Us', 'Help'];

function ChevronDownIcon() {
  return (
    <svg className="workspace_home_svg_icon workspace_home_scroll_down_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg className="workspace_home_svg_icon workspace_home_scroll_up_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function MockLineGraph() {
  return (
    <div className="workspace_home_graph_container" aria-label="Ingestion throughput line graph">
      <div className="workspace_home_graph_meta">
        <span className="workspace_home_graph_val">4.8 MB/s</span>
        <span className="workspace_home_graph_trend is-up">+14.2%</span>
      </div>
      <svg className="workspace_home_svg_graph" viewBox="0 0 280 64" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--central-graph-stroke, #FCC676)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--central-graph-stroke, #FCC676)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="18" x2="280" y2="18" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.18))" strokeDasharray="4 4" />
        <line x1="0" y1="42" x2="280" y2="42" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.18))" strokeDasharray="4 4" />
        <path d="M0,52 Q40,20 80,36 T160,12 T240,28 T280,8 L280,64 L0,64 Z" fill="url(#lineGrad)" />
        <path d="M0,52 Q40,20 80,36 T160,12 T240,28 T280,8" fill="none" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="80" cy="36" r="3" fill="var(--central-secondary-card-bg, #FFFFFF)" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="2" />
        <circle cx="160" cy="12" r="3" fill="var(--central-secondary-card-bg, #FFFFFF)" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="2" />
        <circle cx="280" cy="8" r="3" fill="var(--central-graph-stroke, #FCC676)" strokeWidth="2" />
      </svg>
    </div>
  );
}

function MockNetworkGraph() {
  return (
    <div className="workspace_home_graph_container" aria-label="Graph analytics network map">
      <div className="workspace_home_graph_meta">
        <span className="workspace_home_graph_val">1,248 Nodes</span>
        <span className="workspace_home_graph_badge">3 Clusters</span>
      </div>
      <svg className="workspace_home_svg_graph" viewBox="0 0 280 64">
        <line x1="40" y1="32" x2="90" y2="16" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="40" y1="32" x2="80" y2="48" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="90" y1="16" x2="140" y2="28" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="80" y1="48" x2="140" y2="28" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="140" y1="28" x2="200" y2="16" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="140" y1="28" x2="190" y2="48" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="200" y1="16" x2="250" y2="32" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />
        <line x1="190" y1="48" x2="250" y2="32" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.35))" strokeWidth="1.5" />

        <circle cx="40" cy="32" r="6" fill="var(--central-graph-stroke, #FCC676)" />
        <circle cx="90" cy="16" r="4.5" fill="var(--central-graph-node, #213447)" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="1.5" />
        <circle cx="80" cy="48" r="4.5" fill="var(--central-graph-node, #213447)" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="1.5" />
        <circle cx="140" cy="28" r="8" fill="var(--central-graph-stroke, #FCC676)" />
        <circle cx="200" cy="16" r="4.5" fill="var(--central-graph-node, #213447)" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="1.5" />
        <circle cx="190" cy="48" r="4.5" fill="var(--central-graph-node, #213447)" stroke="var(--central-graph-stroke, #FCC676)" strokeWidth="1.5" />
        <circle cx="250" cy="32" r="6" fill="var(--central-graph-stroke, #FCC676)" />
      </svg>
    </div>
  );
}

function MockBarGraph() {
  return (
    <div className="workspace_home_graph_container" aria-label="Security compliance bar graph">
      <div className="workspace_home_graph_meta">
        <span className="workspace_home_graph_val">99.98%</span>
        <span className="workspace_home_graph_trend is-neutral">0 Violations</span>
      </div>
      <svg className="workspace_home_svg_graph" viewBox="0 0 280 64">
        <line x1="0" y1="56" x2="280" y2="56" stroke="var(--central-graph-grid, rgba(174, 135, 79, 0.25))" />
        <rect x="20" y="24" width="22" height="32" rx="3" fill="var(--central-graph-fill, rgba(174, 135, 79, 0.35))" />
        <rect x="60" y="16" width="22" height="40" rx="3" fill="var(--central-graph-fill, rgba(174, 135, 79, 0.35))" />
        <rect x="100" y="36" width="22" height="20" rx="3" fill="var(--central-graph-fill, rgba(174, 135, 79, 0.35))" />
        <rect x="140" y="12" width="22" height="44" rx="3" fill="var(--central-graph-stroke, #FCC676)" />
        <rect x="180" y="20" width="22" height="36" rx="3" fill="var(--central-graph-fill, rgba(174, 135, 79, 0.35))" />
        <rect x="220" y="8" width="22" height="48" rx="3" fill="var(--central-graph-stroke, #FCC676)" />
      </svg>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="workspace_home_upload_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16V4m0 0-4 4m4-4 4 4" />
      <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

function ShockIcon() {
  return (
    <svg className="workspace_home_analyze_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M13 1L5.5 13H11L9.5 23L18.5 11H13L13 1z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function KafkaIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

function RestApiIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  );
}

function HadoopIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <rect x="2" y="10" width="20" height="5" rx="1" />
      <rect x="2" y="17" width="20" height="5" rx="1" />
      <line x1="6" y1="5.5" x2="6.01" y2="5.5" />
      <line x1="6" y1="12.5" x2="6.01" y2="12.5" />
      <line x1="6" y1="19.5" x2="6.01" y2="19.5" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function WorkspaceHome({ openWindowsCount = 0, onOpenWindow, onOpenTask, unseenTasks = 0, unseenReports = 0 }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedSourceMode, setSelectedSourceMode] = useState(null); // Options: null, 'realtime', 'batch', 'tasks', 'reports'
  const [selectedSubOption, setSelectedSubOption] = useState(null); // Options: null, 'kafka', 'rest_api', 'batch_kafka', 'batch_rest_api', 'batch_hadoop'
  const { tasks: allTasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const activeTasksCount = allTasks.filter(isTaskActive).length;
  const { configuration } = useSession();
  const sourceDefaults = useMemo(() => resolveSourceDefaults(configuration), [configuration]);
  const [isResetSpinning, setIsResetSpinning] = useState(false);
  const [isSecondaryResetSpinning, setIsSecondaryResetSpinning] = useState(false);
  const [analyzeButtonLabelText, setAnalyzeButtonLabelText] = useState('Analyze');

  const handleResetSecondaryPanel = () => {
    if (isSecondaryResetSpinning) return;
    setIsSecondaryResetSpinning(true);
    setTimeout(() => {
      setIsSecondaryResetSpinning(false);
    }, 650);
  };

  const [isScrolledToSecondary, setIsScrolledToSecondary] = useState(false);
  const workspaceHomeRef = useRef(null);
  const secondaryBoxRef = useRef(null);
  const panelsContainerRef = useRef(null);

  const handleToggleScroll = () => {
    setIsScrolledToSecondary((prev) => !prev);
  };

  const handleScrollTop = () => {
    setIsScrolledToSecondary(false);
  };

  const handleScrollBottom = () => {
    setIsScrolledToSecondary(true);
  };

  useEffect(() => {
    const container = panelsContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const isBottom = container.scrollTop > container.clientHeight * 0.35;
      setIsScrolledToSecondary(isBottom);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const updateLabels = () => {
      const customAnalyze = getComputedStyle(document.documentElement)
        .getPropertyValue('--central-analyze-btn-label')
        .trim();
      if (customAnalyze) {
        setAnalyzeButtonLabelText(customAnalyze.replace(/^['"]|['"]$/g, ''));
      }
    };
    updateLabels();
    let frame = null;
    const observer = new MutationObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateLabels();
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleFiles = (newFiles) => {
    const fileArray = Array.from(newFiles).map((file) => ({
      id: Math.random().toString(36).substring(2, 9),
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type || 'Document',
    }));
    setSelectedSourceMode(null);
    setSelectedSubOption(null);
    setUploadedFiles((prev) => [...prev, ...fileArray]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const removeFile = (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleResetPanel = () => {
    setIsResetSpinning(true);
    setTimeout(() => setIsResetSpinning(false), 650); // full-turn spin duration (600ms) + buffer
    setUploadedFiles([]);
    setSelectedSourceMode(null);
    setSelectedSubOption(null);
  };

  const handleOptionClick = (option, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (option.id === 'tasks') {
      if (allTasks.length > 0) {
        if (onOpenTask) onOpenTask(null);
        else if (onOpenWindow) onOpenWindow(WORKSPACE_WINDOW_TYPES.TASKS);
      }
      return;
    }
    if (option.id === 'reports') {
      if (onOpenWindow) onOpenWindow(WORKSPACE_WINDOW_TYPES.REPORTS);
      return;
    }
    if (!option.disabled) {
      if (selectedSourceMode === option.id) {
        setSelectedSourceMode(null);
        setSelectedSubOption(null);
      } else {
        setSelectedSourceMode(option.id);
        setSelectedSubOption(null);
        setUploadedFiles([]);
      }
    }
  };

  const sourceOptions = [
    { id: 'realtime', label: 'Real-time Source', disabled: false },
    { id: 'batch', label: 'Batch Source (1hr)', disabled: false },
    {
      id: 'tasks',
      label: activeTasksCount > 0 ? `Tasks (${activeTasksCount})` : 'Tasks',
      disabled: allTasks.length === 0,
      badge: unseenTasks > 0 ? unseenTasks : null,
    },
    {
      id: 'reports',
      label: 'Reports',
      disabled: false,
      badge: unseenReports > 0 ? unseenReports : null,
    },
  ];

  const showExpandedReview = uploadedFiles.length > 0 || selectedSourceMode === 'realtime' || selectedSourceMode === 'batch';
  const reviewItems = quickReview({
    defaults: sourceDefaults,
    input: uploadedFiles.length ? 'upload' : selectedSubOption,
  });

  return (
    <div className="workspace_home" ref={workspaceHomeRef} aria-label="Workspace start">
      {/* Vertical Page Dots Indicator (Left-Middle, High Z-Index Level) */}
      <nav className="workspace_home_page_dots" aria-label="Central panel page navigation">
        <button
          type="button"
          className={`workspace_home_page_dot linkx_tooltip_anchor${!isScrolledToSecondary ? ' is-active' : ''}`}
          data-tooltip="Quick Analysis Panel"
          aria-label="Navigate to Quick Analysis Panel"
          onClick={handleScrollTop}
        />
        <button
          type="button"
          className={`workspace_home_page_dot linkx_tooltip_anchor${isScrolledToSecondary ? ' is-active' : ''}`}
          data-tooltip="System Overview Panel"
          aria-label="Navigate to System Overview Panel"
          onClick={handleScrollBottom}
        />
      </nav>

      {/* Container holding the sliding full-page panels track */}
      <div className="workspace_home_panels_container" ref={panelsContainerRef}>
        <div
          className="workspace_home_panels_track"
          style={{ transform: `translateY(${isScrolledToSecondary ? '-100%' : '0%'})` }}
        >
        {/* Full-Page Viewport Section 1: Quick Analysis Panel */}
        <div className="workspace_home_viewport_section workspace_home_section_primary">
        <section
          className={`workspace_home_panel${showExpandedReview ? ' is-expanded' : ''}`}
          aria-label="Quick analysis"
        >
        {/* Panel Header: Badge + Subtitle on Left, Reset Button Side-by-Side on Right */}
          <header className="workspace_home_panel_header">
            <div className="workspace_home_header_left">
              <div className="workspace_home_panel_badge">Quick analysis panel</div>
              <div className="workspace_home_panel_subtitle" role="note">
                Not connected to the Service yet: nothing here is sent or analysed. Use a Source window to run an analysis.
              </div>
            </div>
            <button
              type="button"
              className={`workspace_home_panel_reset_btn linkx_tooltip_anchor${isResetSpinning ? ' is-spinning' : ''}`}
              data-tooltip="Reset quick analysis panel"
              aria-label="Reset quick analysis panel"
              onClick={handleResetPanel}
            >
              <ResetIcon />
            </button>
          </header>

        <div className={`workspace_home_panel_body${showExpandedReview ? ' is-fill' : ''}`}>
        <div className="workspace_home_panel_inputs">
        {/* Dropzone at top */}
          <>
            <label
              className={`workspace_home_upload${isDragOver ? ' is-dragover' : ''}`}
              htmlFor="workspace-home-file-input"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                id="workspace-home-file-input"
                type="file"
                multiple
                onChange={handleFileInputChange}
              />
              <span className="workspace_home_upload_mark">
                <UploadIcon />
              </span>
              <span className="workspace_home_upload_text">
                <strong>File upload</strong>
                <small>
                  {uploadedFiles.length > 0
                    ? `${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''} selected (not uploaded).`
                    : openWindowsCount
                    ? `${openWindowsCount} workspace window active.`
                    : 'Drop source files here or click to browse.'}
                </small>
              </span>
            </label>

            {uploadedFiles.length > 0 && (
              <div className="workspace_home_file_list" aria-label="Uploaded file list">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="workspace_home_file_item">
                    <span className="workspace_home_file_icon"><FileIcon /></span>
                    <span className="workspace_home_file_name" title={file.name}>{file.name}</span>
                    <span className="workspace_home_file_size">{file.size}</span>
                    <button
                      type="button"
                      className="workspace_home_file_remove"
                      title="Remove file"
                      onClick={(e) => removeFile(file.id, e)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Source Options Radio Buttons Bar */}
            <div className="workspace_home_options" aria-label="Source options">
              {sourceOptions.map((option) => (
                <label
                  key={option.id}
                  className={`workspace_home_option${option.disabled ? ' is-disabled' : ''}${selectedSourceMode === option.id ? ' is-selected' : ''}`}
                  onClick={(e) => handleOptionClick(option, e)}
                >
                  <input
                    type="radio"
                    name="workspace-source-mode"
                    checked={selectedSourceMode === option.id}
                    disabled={option.disabled}
                    onChange={() => {}}
                  />
                  <span>{option.label}</span>
                  {option.badge && (
                    <span className={`workspace_home_option_badge is-${option.id}`}>{option.badge}</span>
                  )}
                </label>
              ))}
            </div>
          </>

        {/* Real-time Source Sub-Menu Container */}
        {selectedSourceMode === 'realtime' && (
          <div className="workspace_home_realtime_container" aria-label="Real-time source options">
            <div className="workspace_home_realtime_header">
              <strong>Real-time Stream Ingestion</strong>
              <span>Select stream protocol for real-time analysis</span>
            </div>
            <div className="workspace_home_realtime_grid">
              <button
                type="button"
                className={`workspace_home_realtime_card${selectedSubOption === 'kafka' ? ' is-selected' : ''}`}
                onClick={() => setSelectedSubOption((prev) => (prev === 'kafka' ? null : 'kafka'))}
              >
                <div className="workspace_home_realtime_icon">
                  <KafkaIcon />
                </div>
                <div className="workspace_home_realtime_info">
                  <strong>Kafka broker</strong>
                  <p>Event streaming cluster ingestion for real-time telemetry.</p>
                </div>
              </button>

              <button
                type="button"
                className={`workspace_home_realtime_card${selectedSubOption === 'rest_api' ? ' is-selected' : ''}`}
                onClick={() => setSelectedSubOption((prev) => (prev === 'rest_api' ? null : 'rest_api'))}
              >
                <div className="workspace_home_realtime_icon">
                  <RestApiIcon />
                </div>
                <div className="workspace_home_realtime_info">
                  <strong>REST API</strong>
                  <p>HTTP endpoint webhook & streaming JSON payload ingestion.</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Batch Source Sub-Menu Container */}
        {selectedSourceMode === 'batch' && (
          <div className="workspace_home_realtime_container" aria-label="Batch source options">
            <div className="workspace_home_realtime_header">
              <strong>Batch Scheduled Ingestion (1hr Window)</strong>
              <span>Select batch data source protocol for 1-hour window analysis</span>
            </div>
            <div className="workspace_home_realtime_grid is-batch">
              <button
                type="button"
                className={`workspace_home_realtime_card${selectedSubOption === 'batch_kafka' ? ' is-selected' : ''}`}
                onClick={() => setSelectedSubOption((prev) => (prev === 'batch_kafka' ? null : 'batch_kafka'))}
              >
                <div className="workspace_home_realtime_icon">
                  <KafkaIcon />
                </div>
                <div className="workspace_home_realtime_info">
                  <strong>Kafka Broker</strong>
                  <p>Hourly batch consumer window from Kafka topic logs.</p>
                </div>
              </button>

              <button
                type="button"
                className={`workspace_home_realtime_card${selectedSubOption === 'batch_rest_api' ? ' is-selected' : ''}`}
                onClick={() => setSelectedSubOption((prev) => (prev === 'batch_rest_api' ? null : 'batch_rest_api'))}
              >
                <div className="workspace_home_realtime_icon">
                  <RestApiIcon />
                </div>
                <div className="workspace_home_realtime_info">
                  <strong>REST API</strong>
                  <p>Hourly batch polling from external REST endpoints.</p>
                </div>
              </button>

              <button
                type="button"
                className={`workspace_home_realtime_card${selectedSubOption === 'batch_hadoop' ? ' is-selected' : ''}`}
                onClick={() => setSelectedSubOption((prev) => (prev === 'batch_hadoop' ? null : 'batch_hadoop'))}
              >
                <div className="workspace_home_realtime_icon">
                  <HadoopIcon />
                </div>
                <div className="workspace_home_realtime_info">
                  <strong>Hadoop Cluster</strong>
                  <p>Distributed HDFS batch dump from Hadoop storage cluster.</p>
                </div>
              </button>
            </div>
          </div>
        )}

        </div>

        {/* Pre-Analysis Review Section (right column when expanded) */}
        {showExpandedReview && (
          <div className="workspace_home_review_section">
            <div className="workspace_home_configs_review">
              <div className="workspace_home_configs_header">
                <strong>Session configuration</strong>
                <span className="workspace_home_configs_tag">Read only</span>
              </div>
              <div className="workspace_home_configs_grid">
                {reviewItems.map((cfg) => (
                  <div key={cfg.label} className="workspace_home_config_item">
                    <span className="workspace_home_config_label">{cfg.label}</span>
                    <span className="workspace_home_config_val">{cfg.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="workspace_home_analyze_bar">
              <button
                type="button"
                className="workspace_home_analyze_btn is-disabled"
                disabled
                title="Quick analysis is not connected to the Service yet."
              >
                <ShockIcon /> {analyzeButtonLabelText}
              </button>
              <p className="workspace_home_session_limit" role="status">
                Not available yet. Use a Source window to run this analysis.
              </p>
            </div>
          </div>
        )}
        </div>

      </section>
      </div>

      {/* Full-Page Viewport Section 2: Secondary Central Box */}
      <div className="workspace_home_viewport_section workspace_home_section_secondary" ref={secondaryBoxRef}>
        <section className="workspace_home_secondary_box" aria-label="Central workspace overview">
          <header className="workspace_home_secondary_header">
            <div className="workspace_home_secondary_title_group">
              <div className="workspace_home_panel_badge">Central workspace overview</div>
              <h3>Overview & System Status</h3>
              <p>Detailed analysis telemetry, pipeline logs, and resource allocation overview.</p>
            </div>
            <button
              type="button"
              className={`workspace_home_panel_reset_btn linkx_tooltip_anchor${isSecondaryResetSpinning ? ' is-spinning' : ''}`}
              data-tooltip="Refresh system overview"
              aria-label="Refresh system overview"
              onClick={handleResetSecondaryPanel}
            >
              <ResetIcon />
            </button>
          </header>

          <div className="workspace_home_secondary_content">
            <div className="workspace_home_secondary_grid">
              <div className="workspace_home_secondary_card">
                <div className="workspace_home_secondary_card_header">
                  <span className="workspace_home_secondary_card_icon">⚡</span>
                  <strong>Pipeline Ingestion Engine</strong>
                </div>
                <p>Auto-detect ingestion engine initialized for real-time streaming & batch workloads.</p>
                <MockLineGraph />
                <div className="workspace_home_secondary_pill">Engine: Active</div>
              </div>

              <div className="workspace_home_secondary_card">
                <div className="workspace_home_secondary_card_header">
                  <span className="workspace_home_secondary_card_icon">📊</span>
                  <strong>Graph Analytics Engine</strong>
                </div>
                <p>GDS centrality algorithms and Louvain community detection pre-configured for graph queries.</p>
                <MockNetworkGraph />
                <div className="workspace_home_secondary_pill">Algorithms: Ready</div>
              </div>

              <div className="workspace_home_secondary_card">
                <div className="workspace_home_secondary_card_header">
                  <span className="workspace_home_secondary_card_icon">🛡️</span>
                  <strong>Security & Compliance</strong>
                </div>
                <p>Encrypted multi-tenant workspace pipeline with automated privilege validation and session logs.</p>
                <MockBarGraph />
                <div className="workspace_home_secondary_pill">Status: Protected</div>
              </div>
            </div>
          </div>
        </section>
      </div>
      </div>
      </div>

      {/* Static Footer (Anchored statically at default central bottom position) */}
      <footer className="workspace_home_footer" aria-label="Workspace footer">
        <p>© 2026 Linkx. All rights reserved. Authorized use only.</p>
        <button
          type="button"
          className={`workspace_home_footer_round_btn linkx_tooltip_anchor${isScrolledToSecondary ? ' is-active-up' : ''}`}
          data-tooltip={isScrolledToSecondary ? 'Scroll to quick panel' : 'Scroll to system panel'}
          aria-label="Scroll workspace panel"
          onClick={handleToggleScroll}
        >
          {isScrolledToSecondary ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </button>
        <nav aria-label="Footer links">
          {footerLinks.map((label) => (
            <button type="button" key={label}>{label}</button>
          ))}
        </nav>
      </footer>
    </div>
  );
}

export default React.memo(WorkspaceHome);
