import React, { useState } from 'react';
import { useTheme } from '../shared/theme/ThemeContext.jsx';
import { useBackgroundAnimations } from '../utils/backgroundAnimations.js';

const workspaceBackgroundVideo = import.meta.env.BASE_URL + 'site_videos/background.mp4';
const fallbackWorkspaceBackgroundVideo = '/site_videos/background.mp4';
const workspaceBackgroundImage = import.meta.env.BASE_URL + 'site_images/Linkx_background_basic.webp';

export default function WorkspaceLockOverlay({
  user,
  isUnlocking,
  lockMinutes = 15,
  logoutMinutes = 30,
  onUnlock,
  onLogout,
  logoSrc,
}) {
  const displayName = user?.display_name || user?.username || user?.client_id || 'Analyst';
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || 'A';
  const { theme } = useTheme();
  const { areBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const [videoSrc, setVideoSrc] = useState(workspaceBackgroundVideo);
  const [isVideoUnavailable, setIsVideoUnavailable] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const handleVideoError = () => {
    if (videoSrc === workspaceBackgroundVideo) {
      setVideoSrc(fallbackWorkspaceBackgroundVideo);
      return;
    }
    setIsVideoUnavailable(true);
  };

  const handleUnlockSubmit = (event) => {
    event.preventDefault();
    setUnlockError('');
    onUnlock?.();
  };

  return (
    <div className="workspace_lock_overlay" role="dialog" aria-modal="true" aria-label="Workspace locked">
      {areBackgroundAnimationsEnabled && !isVideoUnavailable ? (
        <video
          key={videoSrc}
          className="workspace_lock_media workspace_lock_media_video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={handleVideoError}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : (
        <img
          className="workspace_lock_media workspace_lock_media_image"
          src={workspaceBackgroundImage}
          alt=""
          aria-hidden="true"
        />
      )}
      <div className="workspace_lock_scene_overlay" aria-hidden="true" />

      <div className="workspace_lock_panel">
        <div className="workspace_lock_brand">
          {logoSrc ? (
            <img className="workspace_lock_logo" src={logoSrc} alt="Linkx logo" />
          ) : (
            <div className="workspace_lock_avatar">{avatarLetter}</div>
          )}
          <h2>Workspace Locked</h2>
        </div>

        <p className="workspace_lock_subtitle">
          Welcome back, <strong>{displayName}</strong>. Your active windows and state are preserved.
        </p>

        <p className="workspace_lock_hint">
          Locked after {lockMinutes} minute{lockMinutes === 1 ? '' : 's'} of inactivity. Automatic logout occurs after {logoutMinutes} minute{logoutMinutes === 1 ? '' : 's'}.
        </p>

        {unlockError && <div className="workspace_lock_error_banner">{unlockError}</div>}

        <form className="workspace_lock_form" onSubmit={handleUnlockSubmit}>
          <div className="workspace_lock_actions">
            <button
              type="submit"
              className="workspace_lock_btn_primary"
              disabled={isUnlocking}
            >
              {isUnlocking ? 'Unlocking Workspace...' : 'Unlock Workspace'}
            </button>
            <button
              type="button"
              className="workspace_lock_btn_secondary"
              disabled={isUnlocking}
              onClick={onLogout}
            >
              Sign Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
