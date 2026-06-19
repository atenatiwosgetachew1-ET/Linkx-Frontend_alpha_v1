import React, { useEffect, useState } from 'react';

import { useBackgroundAnimations } from '../../utils/backgroundAnimations.js';
import WorkspaceHome from './WorkspaceHome.jsx';
import WorkspaceContextPanel from './WorkspaceContextPanel.jsx';
import WindowManager from './WindowManager.jsx';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

const workspaceBackgroundVideo = import.meta.env.BASE_URL + 'site_videos/background.mp4';
const fallbackWorkspaceBackgroundVideo = '/site_videos/background.mp4';
const workspaceBackgroundImage = import.meta.env.BASE_URL + 'site_images/Linkx_background_basic.webp';
const fallbackWorkspaceBackgroundImage = '/site_images/Linkx_background_basic.webp';

const launcherItems = [
  {
    id: 'source',
    label: 'Source',
    windowType: WORKSPACE_WINDOW_TYPES.SOURCE,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm4 2h8M8 12h8M8 16h5',
  },
  {
    id: 'graph',
    label: 'Graph',
    windowType: WORKSPACE_WINDOW_TYPES.GRAPH,
    contextTab: WORKSPACE_CONTEXT_TABS.INFO,
    path: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  },
  {
    id: 'chart',
    label: 'Chart',
    windowType: WORKSPACE_WINDOW_TYPES.CHART,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M5 20V10m7 10V4m7 16v-7M3 20h18',
  },
  {
    id: 'configuration',
    label: 'Configuration',
    windowType: WORKSPACE_WINDOW_TYPES.CONFIGURATION,
    contextTab: WORKSPACE_CONTEXT_TABS.SETTINGS,
    path: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2M12 18.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  },
  {
    id: 'settings',
    label: 'Settings',
    windowType: WORKSPACE_WINDOW_TYPES.SETTINGS,
    contextTab: WORKSPACE_CONTEXT_TABS.SETTINGS,
    path: 'M5 7h14M5 12h14M5 17h14M8 7v0M16 12v0M11 17v0',
  },
];

const signOutItem = {
  id: 'sign-out',
  label: 'Sign out',
  path: 'M10 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H10m4-8 4 4-4 4m4-4H9',
};

function LauncherIcon({ path }) {
  return (
    <svg className="workspace_launcher_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export default function WorkspaceFrame({ user, onSignOut, logoSrc }) {
  const displayName = user?.display_name || user?.username || user?.client_id || 'Analyst';
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || 'A';
  const videoRef = React.useRef(null);
  const [videoSrc, setVideoSrc] = useState(workspaceBackgroundVideo);
  const [isVideoUnavailable, setIsVideoUnavailable] = useState(false);
  const [imageSrc, setImageSrc] = useState(workspaceBackgroundImage);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isLauncherExpanded, setIsLauncherExpanded] = useState(false);
  const { areBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const workspace = useWorkspace();

  const playBackgroundVideo = (videoElement = videoRef.current) => {
    if (!videoElement) return;
    videoElement.play?.().catch(() => {});
  };

  const handleVideoError = () => {
    if (videoSrc === workspaceBackgroundVideo) {
      setVideoSrc(fallbackWorkspaceBackgroundVideo);
      return;
    }
    setIsVideoUnavailable(true);
  };

  const handleImageError = () => {
    if (imageSrc === workspaceBackgroundImage) {
      setIsImageLoaded(false);
      setImageSrc(fallbackWorkspaceBackgroundImage);
    }
  };


  const handleLauncherAction = (item) => {
    workspace.openWindow(item.windowType, {
      contextTab: item.contextTab,
      title: item.label,
    });
    workspace.setContextTab(item.contextTab);
  };

  useEffect(() => {
    if (!areBackgroundAnimationsEnabled) return;
    setIsVideoUnavailable(false);
    setVideoSrc(workspaceBackgroundVideo);
    videoRef.current?.load?.();
    playBackgroundVideo();
  }, [areBackgroundAnimationsEnabled]);

  return (
    <main className="workspace_shell">
      {areBackgroundAnimationsEnabled && !isVideoUnavailable ? (
        <video
          key={videoSrc}
          ref={videoRef}
          className="workspace_background_media"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          onCanPlay={(event) => playBackgroundVideo(event.currentTarget)}
          onError={handleVideoError}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : (
        <img
          key={imageSrc}
          className={`workspace_background_media workspace_background_image${isImageLoaded ? ' is-loaded' : ''}`}
          src={imageSrc}
          alt=""
          aria-hidden="true"
          decoding="async"
          fetchPriority="high"
          loading="eager"
          onLoad={() => setIsImageLoaded(true)}
          onError={handleImageError}
        />
      )}
      <div className="workspace_background_overlay" aria-hidden="true" />
      <div className={`workspace_frame${isLauncherExpanded ? ' is-launcher-expanded' : ''}`}>
        <aside className="workspace_zone workspace_zone_left" aria-label="Workspace launcher">
          <nav className="workspace_launcher" aria-label="Workspace launcher">
            <div className="workspace_launcher_main">
              <button
                className="workspace_launcher_brand"
                type="button"
                aria-label={isLauncherExpanded ? 'Collapse launcher' : 'Expand launcher'}
                aria-expanded={isLauncherExpanded}
                onClick={() => setIsLauncherExpanded((current) => !current)}
              >
                <img src={logoSrc} alt="Linkx logo" />
                <span className="workspace_launcher_brand_label">
                  <span>Linkx</span>
                  <small>Web analyzer</small>
                </span>
              </button>
              {launcherItems.map((item) => (
                <button
                  key={item.id}
                  className="workspace_launcher_button"
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => handleLauncherAction(item)}
                >
                  <LauncherIcon path={item.path} />
                  <span className="workspace_launcher_label">{item.label}</span>
                </button>
              ))}
            </div>
            <button
              className="workspace_launcher_button workspace_launcher_signout"
              type="button"
              title={signOutItem.label}
              aria-label={signOutItem.label}
              onClick={onSignOut}
            >
              <LauncherIcon path={signOutItem.path} />
              <span className="workspace_launcher_label">{signOutItem.label}</span>
            </button>
          </nav>
        </aside>
        <div className="workspace_work_area">
          <section className="workspace_canvas" aria-label="Workspace canvas">
            <div className="workspace_identity" aria-label="Current user">
              <span className="workspace_avatar" aria-hidden="true">{avatarLetter}</span>
              <span>{displayName}</span>
            </div>
            {workspace.windows.length === 0 && <WorkspaceHome openWindowsCount={workspace.windows.length} />}
          </section>
          <aside className="workspace_zone workspace_zone_right" aria-label="Workspace context">
            <WorkspaceContextPanel
              displayName={displayName}
              workspace={workspace}
            />
          </aside>
          <WindowManager workspace={workspace} />
        </div>
      </div>
    </main>
  );
}
