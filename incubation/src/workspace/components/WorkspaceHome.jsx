import React, { useState, useRef, useEffect } from 'react';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

const defaultConfigItems = [
  { label: 'Ingestion Engine', value: 'Auto-detect Pipeline' },
  { label: 'Deep Scan Depth', value: 'Entity & Relationship Extraction' },
  { label: 'Confidence Threshold', value: '95.8% Validation' },
  { label: 'Output Stream', value: 'Unified Graph & Analysis' },
];

const mockFindingsData = {
  status: 'Flagged!',
  statusType: 'danger', // danger, warning, success
  anomalies: ['Dormant to Active', 'Smurfing', 'Rapid Velocity Flow', 'High-Degree Hub'],
  gdsMetrics: [
    { label: 'Most centrality', value: '4.85' },
    { label: 'Highest PageRank', value: '0.924' },
    { label: 'Louvain Clusters', value: '7 Communities' },
    { label: 'Graph Density', value: '0.642' },
  ],
  influencers: [
    { id: 'ACC-8892', gds: 'Centrality: 4.85 | PageRank: 0.924 | Community: C-12' },
    { id: 'TX-4019', gds: 'Centrality: 4.62 | PageRank: 0.887 | Community: C-12' },
    { id: 'HUB-1044', gds: 'Centrality: 4.15 | PageRank: 0.812 | Community: C-04' },
    { id: 'NODE-7721', gds: 'Centrality: 3.98 | PageRank: 0.765 | Community: C-09' },
    { id: 'ENTITY-302', gds: 'Centrality: 3.74 | PageRank: 0.721 | Community: C-04' },
  ],
};

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

function WarningIcon() {
  return (
    <svg className="workspace_home_svg_icon is-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="12" cy="18" r="3" />
      <line x1="8.5" y1="7.5" x2="15.5" y2="7.5" />
      <line x1="7.5" y1="8.5" x2="10.5" y2="15.5" />
      <line x1="16.5" y1="8.5" x2="13.5" y2="15.5" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="workspace_home_svg_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
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

function LockIcon() {
  return (
    <svg className="workspace_home_svg_icon is-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function WorkspaceHome({ openWindowsCount = 0, onOpenWindow }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [selectedSourceMode, setSelectedSourceMode] = useState(null); // Options: null, 'realtime', 'batch', 'tasks', 'reports'
  const [selectedSubOption, setSelectedSubOption] = useState(null); // Options: null, 'kafka', 'rest_api', 'batch_kafka', 'batch_rest_api', 'batch_hadoop'
  const [lockedSubOptions, setLockedSubOptions] = useState([]); // Sub-option IDs currently locked due to active/background task
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTasksCount, setActiveTasksCount] = useState(0);
  const [reportsCount, setReportsCount] = useState(0);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showDropConfirmModal, setShowDropConfirmModal] = useState(false);
  const [isResetSpinning, setIsResetSpinning] = useState(false);
  const [isSecondaryResetSpinning, setIsSecondaryResetSpinning] = useState(false);
  const [analyzeButtonLabelText, setAnalyzeButtonLabelText] = useState('Analyze');
  const [analyzingActiveLabelText, setAnalyzingActiveLabelText] = useState('Analyzing');

  const handleResetSecondaryPanel = () => {
    if (isSecondaryResetSpinning) return;
    setIsSecondaryResetSpinning(true);
    setTimeout(() => {
      setIsSecondaryResetSpinning(false);
    }, 700);
  };

  const [isScrolledToSecondary, setIsScrolledToSecondary] = useState(false);
  const liveTimeoutsRef = useRef([]); // Only tracks live progress overlay timeouts
  const activeAnalysisSubRef = useRef(null);
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

      const customAnalyzing = getComputedStyle(document.documentElement)
        .getPropertyValue('--central-analyzing-active-label')
        .trim();
      if (customAnalyzing) {
        setAnalyzingActiveLabelText(customAnalyzing.replace(/^['"]|['"]$/g, ''));
      }
    };
    updateLabels();
    const observer = new MutationObserver(updateLabels);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  const clearLiveAnalysisTimeouts = () => {
    liveTimeoutsRef.current.forEach((t) => clearTimeout(t));
    liveTimeoutsRef.current = [];
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleFiles = (newFiles) => {
    if (isAnalyzing) return;
    const fileArray = Array.from(newFiles).map((file) => ({
      id: Math.random().toString(36).substring(2, 9),
      name: file.name,
      size: formatFileSize(file.size),
      type: file.type || 'Document',
    }));
    setSelectedSourceMode(null);
    setSelectedSubOption(null);
    setUploadedFiles((prev) => [...prev, ...fileArray]);
    setAnalysisResult(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAnalyzing) setIsDragOver(true);
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
    if (!isAnalyzing && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e) => {
    if (!isAnalyzing && e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const removeFile = (id, e) => {
    e.stopPropagation();
    e.preventDefault();
    if (isAnalyzing) return;
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
    if (uploadedFiles.length <= 1) {
      setAnalysisResult(null);
    }
  };

  // Analyze CTA button is active by default for workspace quick analysis
  const isCanAnalyze = true;
  const isAnalyzeDisabled = isAnalyzing;

  const handleStartAnalysis = () => {
    if (isAnalyzeDisabled) return;
    clearLiveAnalysisTimeouts();

    // Capture current sub-option protocol locally for this task instance
    const currentSub = selectedSubOption || 'realtime';
    activeAnalysisSubRef.current = currentSub;
    if (currentSub && !lockedSubOptions.includes(currentSub)) {
      setLockedSubOptions((prev) => [...prev, currentSub]);
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisProgress(5);
    setAnalysisStatus('Initalizing services...');

    const t1 = setTimeout(() => {
      setAnalysisProgress(20);
      setAnalysisStatus('Establizhing connections');
    }, 450);

    const t2 = setTimeout(() => {
      setAnalysisProgress(38);
      setAnalysisStatus('Prepairing dataframe');
    }, 900);

    const t3 = setTimeout(() => {
      setAnalysisProgress(55);
      setAnalysisStatus('Ingesting...');
    }, 1350);

    const t4 = setTimeout(() => {
      setAnalysisProgress(72);
      setAnalysisStatus('Analyzing...');
    }, 1800);

    const t5 = setTimeout(() => {
      setAnalysisProgress(88);
      setAnalysisStatus('Collecting results');
    }, 2250);

    const t6 = setTimeout(() => {
      setAnalysisProgress(100);
      setAnalysisStatus('Finalizing...');
      const t7 = setTimeout(() => {
        setIsAnalyzing(false);
        setAnalysisStatus('');
        setAnalysisProgress(0);
        setAnalysisResult(mockFindingsData);

        // Live task complete: unlock sub-option protocol
        if (currentSub) {
          setLockedSubOptions((prev) => prev.filter((item) => item !== currentSub));
        }
        if (activeAnalysisSubRef.current === currentSub) {
          activeAnalysisSubRef.current = null;
        }
      }, 1000);
      liveTimeoutsRef.current.push(t7);
    }, 2700);

    liveTimeoutsRef.current.push(t1, t2, t3, t4, t5, t6);
  };

  const handleMinimizeToTask = () => {
    clearLiveAnalysisTimeouts();

    // Capture the exact sub-option protocol running for this specific background task
    const taskSub = activeAnalysisSubRef.current;
    activeAnalysisSubRef.current = null;

    setActiveTasksCount((prev) => prev + 1);
    setIsAnalyzing(false);

    // Keep source option mode active (e.g. 'batch' or 'realtime'), but unselect specific sub-option card
    setUploadedFiles([]);
    setSelectedSubOption(null); // Sub-option unselected -> Analyze button becomes disabled!
    setAnalysisResult(null);
    setAnalysisProgress(0);
    setAnalysisStatus('');

    // Independent background timer: does NOT get cleared when new live tasks start
    setTimeout(() => {
      setActiveTasksCount((prev) => Math.max(0, prev - 1));
      setReportsCount((prev) => prev + 1);
      // Unlock this specific task's protocol upon background completion
      if (taskSub) {
        setLockedSubOptions((prev) => prev.filter((item) => item !== taskSub));
      }
    }, 6000);
  };

  const handleCancelAnalysis = () => {
    clearLiveAnalysisTimeouts();
    const currentSub = activeAnalysisSubRef.current;
    if (currentSub) {
      setLockedSubOptions((prev) => prev.filter((item) => item !== currentSub));
    }
    activeAnalysisSubRef.current = null;
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setAnalysisStatus('Analysis job cancelled.');
    const t = setTimeout(() => setAnalysisStatus(''), 2000);
    liveTimeoutsRef.current.push(t);
  };

  const handlePromptDropAnalysis = () => {
    setShowDropConfirmModal(true);
  };

  const handleConfirmDropAnalysis = () => {
    clearLiveAnalysisTimeouts();
    setIsAnalyzing(false);
    setUploadedFiles([]);
    setSelectedSourceMode(null);
    setSelectedSubOption(null);
    setAnalysisResult(null);
    setAnalysisProgress(0);
    setAnalysisStatus('');
    setShowDropConfirmModal(false);
  };

  const handleResetPanel = () => {
    if (isAnalyzing) return;
    setIsResetSpinning(true);
    setTimeout(() => setIsResetSpinning(false), 750); // 2-round rotation duration
    clearLiveAnalysisTimeouts();
    setUploadedFiles([]);
    setSelectedSourceMode(null);
    setSelectedSubOption(null);
    setAnalysisResult(null);
    setIsAnalyzing(false);
    setAnalysisProgress(0);
    setAnalysisStatus('');
    setShowDropConfirmModal(false);
  };

  const handleOptionClick = (option, e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isAnalyzing) return;
    if (option.id === 'tasks') {
      if (activeTasksCount > 0 && onOpenWindow) {
        onOpenWindow(WORKSPACE_WINDOW_TYPES.TASKS);
      }
      return;
    }
    if (option.id === 'reports') {
      if (reportsCount > 0 && onOpenWindow) {
        onOpenWindow(WORKSPACE_WINDOW_TYPES.REPORTS);
      }
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
      setAnalysisResult(null);
    }
  };

  const sourceOptions = [
    { id: 'realtime', label: 'Real-time Source', disabled: false },
    { id: 'batch', label: 'Batch Source (1hr)', disabled: false },
    {
      id: 'tasks',
      label: activeTasksCount > 0 ? `Tasks (${activeTasksCount})` : 'Tasks',
      disabled: activeTasksCount === 0,
      badge: activeTasksCount > 0 ? activeTasksCount : null,
    },
    {
      id: 'reports',
      label: reportsCount > 0 ? `Reports (${reportsCount})` : 'Reports',
      disabled: reportsCount === 0,
      badge: reportsCount > 0 ? reportsCount : null,
    },
  ];

  const showExpandedReview = (uploadedFiles.length > 0 || selectedSourceMode === 'realtime' || selectedSourceMode === 'batch') && !analysisResult;
  const isOverlayVisible = isAnalyzing;

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
          className={`workspace_home_panel${showExpandedReview || analysisResult ? ' is-expanded' : ''}`}
          aria-label="Quick analysis"
        >
        {/* Semi-transparent Full-Panel Cover Overlay during Analysis */}
        {isOverlayVisible && (
          <div className="workspace_home_analysis_overlay" aria-label="Analysis overlay">
            <div className="workspace_home_overlay_controls">
              <button
                type="button"
                className="workspace_home_overlay_btn is-minimize linkx_tooltip_anchor"
                data-tooltip="Run in background"
                title="Run in background (minimizes & adds to Tasks)"
                onClick={handleMinimizeToTask}
              >
                −
              </button>
              <button
                type="button"
                className="workspace_home_overlay_btn is-close linkx_tooltip_anchor"
                data-tooltip="Cancel analysis"
                title="Cancel analysis"
                onClick={handleCancelAnalysis}
              >
                ✕
              </button>
            </div>

            <div className="workspace_home_overlay_center">
              <div className="workspace_home_overlay_title">
                <ShockIcon /> {analyzingActiveLabelText}... {analysisProgress}%
              </div>

              <div className="workspace_home_analysis_progress_large">
                <div className="workspace_home_progress_bar" style={{ width: `${analysisProgress}%` }} />
              </div>

              {analysisStatus && (
                <div className="workspace_home_analysis_status_large">
                  {analysisStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Panel Header: Badge + Subtitle on Left, Reset Button Side-by-Side on Right */}
        {!analysisResult && (
          <header className="workspace_home_panel_header">
            <div className="workspace_home_header_left">
              <div className="workspace_home_panel_badge">Quick analysis panel</div>
              <div className="workspace_home_panel_subtitle">
                Saved configurations are used for quick analysis activities.
              </div>
            </div>
            {!isOverlayVisible && (
              <button
                type="button"
                className={`workspace_home_panel_reset_btn linkx_tooltip_anchor${isResetSpinning ? ' is-spinning' : ''}`}
                data-tooltip="Reset quick analysis panel"
                aria-label="Reset quick analysis panel"
                onClick={handleResetPanel}
              >
                <ResetIcon />
              </button>
            )}
          </header>
        )}

        {/* Original Panel Layout: Dropzone at top */}
        {!analysisResult && (
          <>
            <label
              className={`workspace_home_upload${isDragOver ? ' is-dragover' : ''}${isOverlayVisible ? ' is-disabled' : ''}`}
              htmlFor="workspace-home-file-input"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                id="workspace-home-file-input"
                type="file"
                multiple
                disabled={isOverlayVisible}
                onChange={handleFileInputChange}
              />
              <span className="workspace_home_upload_mark">
                <UploadIcon />
              </span>
              <span className="workspace_home_upload_text">
                <strong>File upload</strong>
                <small>
                  {isAnalyzing
                    ? 'Analysis in progress...'
                    : activeTasksCount > 0
                    ? `${activeTasksCount} background task${activeTasksCount > 1 ? 's' : ''} running.`
                    : uploadedFiles.length > 0
                    ? `${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''} attached to quick session.`
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
                      disabled={isOverlayVisible}
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
        )}

        {/* Real-time Source Sub-Menu Container */}
        {selectedSourceMode === 'realtime' && !isOverlayVisible && !analysisResult && (
          <div className="workspace_home_realtime_container" aria-label="Real-time source options">
            <div className="workspace_home_realtime_header">
              <strong>Real-time Stream Ingestion</strong>
              <span>Select stream protocol for real-time analysis</span>
            </div>
            <div className="workspace_home_realtime_grid">
              {(() => {
                const isLocked = lockedSubOptions.includes('kafka');
                return (
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`workspace_home_realtime_card${isLocked ? ' is-disabled linkx_tooltip_anchor' : ''}${selectedSubOption === 'kafka' ? ' is-selected' : ''}`}
                    data-tooltip={isLocked ? 'Task running for Kafka broker' : undefined}
                    onClick={() => !isLocked && setSelectedSubOption((prev) => (prev === 'kafka' ? null : 'kafka'))}
                  >
                    <div className="workspace_home_realtime_icon">
                      {isLocked ? <LockIcon /> : <KafkaIcon />}
                    </div>
                    <div className="workspace_home_realtime_info">
                      <strong>Kafka broker {isLocked ? '(Task running...)' : ''}</strong>
                      <p>Event streaming cluster ingestion for real-time telemetry.</p>
                    </div>
                  </button>
                );
              })()}

              {(() => {
                const isLocked = lockedSubOptions.includes('rest_api');
                return (
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`workspace_home_realtime_card${isLocked ? ' is-disabled linkx_tooltip_anchor' : ''}${selectedSubOption === 'rest_api' ? ' is-selected' : ''}`}
                    data-tooltip={isLocked ? 'Task running for REST API' : undefined}
                    onClick={() => !isLocked && setSelectedSubOption((prev) => (prev === 'rest_api' ? null : 'rest_api'))}
                  >
                    <div className="workspace_home_realtime_icon">
                      {isLocked ? <LockIcon /> : <RestApiIcon />}
                    </div>
                    <div className="workspace_home_realtime_info">
                      <strong>REST API {isLocked ? '(Task running...)' : ''}</strong>
                      <p>HTTP endpoint webhook & streaming JSON payload ingestion.</p>
                    </div>
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {/* Batch Source Sub-Menu Container */}
        {selectedSourceMode === 'batch' && !isOverlayVisible && !analysisResult && (
          <div className="workspace_home_realtime_container" aria-label="Batch source options">
            <div className="workspace_home_realtime_header">
              <strong>Batch Scheduled Ingestion (1hr Window)</strong>
              <span>Select batch data source protocol for 1-hour window analysis</span>
            </div>
            <div className="workspace_home_realtime_grid is-batch">
              {(() => {
                const isLocked = lockedSubOptions.includes('batch_kafka');
                return (
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`workspace_home_realtime_card${isLocked ? ' is-disabled linkx_tooltip_anchor' : ''}${selectedSubOption === 'batch_kafka' ? ' is-selected' : ''}`}
                    data-tooltip={isLocked ? 'Task running for Kafka Broker' : undefined}
                    onClick={() => !isLocked && setSelectedSubOption((prev) => (prev === 'batch_kafka' ? null : 'batch_kafka'))}
                  >
                    <div className="workspace_home_realtime_icon">
                      {isLocked ? <LockIcon /> : <KafkaIcon />}
                    </div>
                    <div className="workspace_home_realtime_info">
                      <strong>Kafka Broker {isLocked ? '(Task running...)' : ''}</strong>
                      <p>Hourly batch consumer window from Kafka topic logs.</p>
                    </div>
                  </button>
                );
              })()}

              {(() => {
                const isLocked = lockedSubOptions.includes('batch_rest_api');
                return (
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`workspace_home_realtime_card${isLocked ? ' is-disabled linkx_tooltip_anchor' : ''}${selectedSubOption === 'batch_rest_api' ? ' is-selected' : ''}`}
                    data-tooltip={isLocked ? 'Task running for REST API' : undefined}
                    onClick={() => !isLocked && setSelectedSubOption((prev) => (prev === 'batch_rest_api' ? null : 'batch_rest_api'))}
                  >
                    <div className="workspace_home_realtime_icon">
                      {isLocked ? <LockIcon /> : <RestApiIcon />}
                    </div>
                    <div className="workspace_home_realtime_info">
                      <strong>REST API {isLocked ? '(Task running...)' : ''}</strong>
                      <p>Hourly batch polling from external REST endpoints.</p>
                    </div>
                  </button>
                );
              })()}

              {(() => {
                const isLocked = lockedSubOptions.includes('batch_hadoop');
                return (
                  <button
                    type="button"
                    disabled={isLocked}
                    className={`workspace_home_realtime_card${isLocked ? ' is-disabled linkx_tooltip_anchor' : ''}${selectedSubOption === 'batch_hadoop' ? ' is-selected' : ''}`}
                    data-tooltip={isLocked ? 'Task running for Hadoop Cluster' : undefined}
                    onClick={() => !isLocked && setSelectedSubOption((prev) => (prev === 'batch_hadoop' ? null : 'batch_hadoop'))}
                  >
                    <div className="workspace_home_realtime_icon">
                      {isLocked ? <LockIcon /> : <HadoopIcon />}
                    </div>
                    <div className="workspace_home_realtime_info">
                      <strong>Hadoop Cluster {isLocked ? '(Task running...)' : ''}</strong>
                      <p>Distributed HDFS batch dump from Hadoop storage cluster.</p>
                    </div>
                  </button>
                );
              })()}
            </div>
          </div>
        )}

        {/* Pre-Analysis Review Section */}
        {showExpandedReview && !isOverlayVisible && !analysisResult && (
          <div className="workspace_home_review_section">
            <div className="workspace_home_configs_review">
              <div className="workspace_home_configs_header">
                <strong>Default Configurations Review</strong>
                <span className="workspace_home_configs_tag">Preset Active</span>
              </div>
              <div className="workspace_home_configs_grid">
                {defaultConfigItems.map((cfg) => (
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
                className={`workspace_home_analyze_btn${isAnalyzeDisabled ? ' is-disabled' : ''}${isAnalyzing ? ' is-analyzing' : ''}`}
                disabled={isAnalyzeDisabled}
                onClick={handleStartAnalysis}
              >
                {isAnalyzing ? (
                  <><ShockIcon /> {analyzingActiveLabelText}... {analysisProgress}%</>
                ) : (
                  <><ShockIcon /> {analyzeButtonLabelText}{uploadedFiles.length > 0 ? ` (${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''})` : ''}</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Completed Analysis Findings Container */}
        {analysisResult && !isOverlayVisible && (
          <div className="workspace_home_findings" aria-label="Analysis findings">
            <div className="workspace_home_findings_header">
              <h3>Analysis findings</h3>
              <span className="workspace_home_findings_badge">Session #8492 — Completed</span>
            </div>

            {/* Status Section */}
            <div className="workspace_home_findings_section">
              <span className="workspace_home_findings_subtitle">Status</span>
              <div className={`workspace_home_status_tag is-${analysisResult.statusType}`}>
                <span className="workspace_home_status_dot" />
                <strong>{analysisResult.status}</strong>
              </div>
            </div>

            {/* Anomalies Detected Section */}
            <div className="workspace_home_findings_section">
              <span className="workspace_home_findings_subtitle">Anomalies detected</span>
              <div className="workspace_home_anomalies_list">
                {analysisResult.anomalies.map((item) => (
                  <span key={item} className="workspace_home_anomaly_chip">
                    <WarningIcon /> {item}
                  </span>
                ))}
              </div>
            </div>

            {/* GDS Metric Values Subtitle & Grid */}
            <div className="workspace_home_findings_section">
              <span className="workspace_home_findings_subtitle">GDS metric values</span>
              <div className="workspace_home_gds_grid">
                {analysisResult.gdsMetrics.map((m) => (
                  <div key={m.label} className="workspace_home_gds_card">
                    <span className="workspace_home_gds_label">{m.label}</span>
                    <strong className="workspace_home_gds_val">{m.value}</strong>
                  </div>
                ))}
              </div>
            </div>

            {/* Highest-Influencers Subtitle & Node Tooltip Buttons */}
            <div className="workspace_home_findings_section">
              <span className="workspace_home_findings_subtitle">Highest-Influencers</span>
              <div className="workspace_home_influencers_list">
                {analysisResult.influencers.map((inf) => (
                  <button
                    type="button"
                    key={inf.id}
                    className="workspace_home_influencer_btn linkx_tooltip_anchor"
                    data-tooltip={inf.gds}
                    aria-label={`Node ${inf.id}`}
                  >
                    <ShockIcon /> {inf.id}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons Bar */}
            <div className="workspace_home_findings_actions">
              <button
                type="button"
                className="workspace_home_findings_btn is-reanalyze"
                disabled={isAnalyzeDisabled}
                onClick={handleStartAnalysis}
              >
                <ShockIcon /> Re-analyze
              </button>
              <button
                type="button"
                className="workspace_home_findings_btn is-network"
                onClick={() => onOpenWindow && onOpenWindow(WORKSPACE_WINDOW_TYPES.GRAPH)}
              >
                <GraphIcon /> Explore network
              </button>
              <button
                type="button"
                className="workspace_home_findings_btn is-chart"
                onClick={() => onOpenWindow && onOpenWindow(WORKSPACE_WINDOW_TYPES.CHART)}
              >
                <ChartIcon /> Explore chart
              </button>
              <button
                type="button"
                className="workspace_home_findings_btn is-drop"
                onClick={handlePromptDropAnalysis}
              >
                <TrashIcon /> Drop analysis
              </button>
            </div>
          </div>
        )}
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

      {/* Confirmation Window Modal for Dropping Analysis */}
      {showDropConfirmModal && (
        <div className="workspace_home_modal_backdrop" aria-label="Drop analysis confirmation modal">
          <div className="workspace_home_confirm_modal">
            <header className="workspace_home_modal_header">
              <div className="workspace_home_modal_title">
                <TrashIcon /> Drop analysis session?
              </div>
              <button
                type="button"
                className="workspace_home_modal_close"
                title="Cancel"
                onClick={() => setShowDropConfirmModal(false)}
              >
                ✕
              </button>
            </header>
            <div className="workspace_home_modal_body">
              <p>
                Are you sure you want to drop this analysis session? All findings, telemetry, and metrics for this session will be cleared.
              </p>
            </div>
            <footer className="workspace_home_modal_footer">
              <button
                type="button"
                className="workspace_home_modal_btn is-cancel"
                onClick={() => setShowDropConfirmModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="workspace_home_modal_btn is-confirm"
                onClick={handleConfirmDropAnalysis}
              >
                <TrashIcon /> Confirm Drop
              </button>
            </footer>
          </div>
        </div>
      )}

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
