import React, { useEffect, useState } from "react";
import {
  compactValidationErrors,
  sanitizeIdentifier,
  sanitizeSecret,
  validateLoginPassword,
  validateRequiredIdentifier,
} from "../utils/inputSecurity.js";

const loginBackgroundVideo = import.meta.env.BASE_URL + "site_videos/background.mp4";
const fallbackLoginBackgroundVideo = "/site_videos/background.mp4";
const loginBackgroundImage = import.meta.env.BASE_URL + "site_images/Linkx_background_basic.webp";
const fallbackLoginBackgroundImage = "/site_images/Linkx_background_basic.webp";
const backgroundAnimationPreferenceKey = "linkx_enable_background_animations";
const backgroundAnimationPreferenceEvent = "linkx_background_animation_preference_change";
const readBackgroundAnimationPreference = () => {
  try {
    return localStorage.getItem(backgroundAnimationPreferenceKey) !== "false";
  } catch (_err) {
    return true;
  }
};
const loginLogo = import.meta.env.BASE_URL + "site_images/Linkx square Icon (256x256).png";
const genericLoginError = "Unable to sign in at this time. Please try again later.";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const videoRef = React.useRef(null);
  const [videoSrc, setVideoSrc] = useState(loginBackgroundVideo);
  const [isVideoUnavailable, setIsVideoUnavailable] = useState(false);
  const [imageSrc, setImageSrc] = useState(loginBackgroundImage);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [areBackgroundAnimationsEnabled, setAreBackgroundAnimationsEnabled] = useState(readBackgroundAnimationPreference);

  const playBackgroundVideo = (videoElement = videoRef.current) => {
    if (!videoElement) return;
    videoElement.play?.().catch(() => {});
  };

  const handleVideoError = () => {
    if (videoSrc === loginBackgroundVideo) {
      setVideoSrc(fallbackLoginBackgroundVideo);
      return;
    }
    setIsVideoUnavailable(true);
  };

  const handleImageError = () => {
    if (imageSrc === loginBackgroundImage) {
      setIsImageLoaded(false);
      setImageSrc(fallbackLoginBackgroundImage);
    }
  };

  useEffect(() => {
    if (!areBackgroundAnimationsEnabled) return;
    setIsVideoUnavailable(false);
    setVideoSrc(loginBackgroundVideo);
    videoRef.current?.load?.();
    playBackgroundVideo();
  }, [areBackgroundAnimationsEnabled]);

  useEffect(() => {
    const syncBackgroundPreference = (event) => {
      const enabled = typeof event?.detail?.enabled === "boolean"
        ? event.detail.enabled
        : readBackgroundAnimationPreference();
      setAreBackgroundAnimationsEnabled(enabled);
    };

    window.addEventListener("storage", syncBackgroundPreference);
    window.addEventListener(backgroundAnimationPreferenceEvent, syncBackgroundPreference);

    return () => {
      window.removeEventListener("storage", syncBackgroundPreference);
      window.removeEventListener(backgroundAnimationPreferenceEvent, syncBackgroundPreference);
    };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const cleanUsername = sanitizeIdentifier(username, { maxLength: 120 }).trim();
    const cleanPassword = sanitizeSecret(password, { maxLength: 256 });
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(cleanUsername, "Username", { minLength: 3, maxLength: 120 }),
      validateLoginPassword(cleanPassword),
    );

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      await onLogin(cleanUsername, cleanPassword);
    } catch (err) {
      setError(genericLoginError);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="linkx_login_shell">
      {areBackgroundAnimationsEnabled && !isVideoUnavailable ? (
        <video
          key={videoSrc}
          ref={videoRef}
          className="linkx_login_video"
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
          className={`linkx_login_video linkx_login_image${isImageLoaded ? " is-loaded" : ""}`}
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
      <div className="linkx_login_overlay" aria-hidden="true" />
      <div className="linkx_login_content">
      <section className="linkx_login_panel" aria-label="Login">
        <div className="linkx_login_brand">
          <div className="linkx_login_brand_mark">
            <img className="linkx_login_brand_logo" src={loginLogo} alt="Linkx logo" />
            <span>Linkx</span>
          </div>
          <small>Web Analyzer</small>
        </div>
        <form className="linkx_login_form" onSubmit={handleSubmit} noValidate>
          <label>
            Username
            <input
              type="text"
              value={username}
              autoComplete="username"
              maxLength={120}
              aria-invalid={!!error}
              onChange={(event) => setUsername(sanitizeIdentifier(event.target.value, { maxLength: 120 }))}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              maxLength={256}
              aria-invalid={!!error}
              onChange={(event) => setPassword(sanitizeSecret(event.target.value, { maxLength: 256 }))}
              required
            />
          </label>
          {error && <div className="linkx_login_error">{error}</div>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
      </div>
      <footer className="linkx_login_footer" aria-label="Login footer">
        <p>© 2026 Linkx. All rights reserved. Authorized use only. Unauthorized access is prohibited and may be monitored.</p>
      </footer>
    </main>
  );
}
