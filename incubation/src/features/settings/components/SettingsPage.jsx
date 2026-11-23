import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// The settings page family (set by Linkx Vigilance): a state-railed header,
// a row of figures or facts, then titled blocks. Styles: settings.css.

export function SettingsPage({ className = '', children }) {
  return <div className={`settings_page${className ? ` ${className}` : ''}`}>{children}</div>;
}

// The page's header and its figures as one container, under one wash of
// the accent.
export function Masthead({ children }) {
  return <div className="settings_masthead">{children}</div>;
}

// tone: 'active' | 'paused' | 'inactive' | 'danger' | 'locked' (rail colour;
// the accent without one).
export function PageHero({ tone = '', eyebrow, title, titleHint, pill, meta, media, children }) {
  return (
    <header className={`settings_hero${tone ? ` is-${tone}` : ''}`}>
      {media ? <div className="settings_hero_media" aria-hidden="true">{media}</div> : null}
      <div className="settings_hero_main">
        {eyebrow ? <p className="settings_eyebrow">{eyebrow}</p> : null}
        <div className="settings_hero_title">
          <h4 title={titleHint}>{title}</h4>
          {pill}
        </div>
        {meta ? <p className="settings_hero_meta">{meta}</p> : null}
      </div>
      {children ? <div className="settings_hero_aside">{children}</div> : null}
    </header>
  );
}

// tone: 'active' | 'neutral' | (none: danger).
export function Pill({ tone = '', dot = false, title, children }) {
  return (
    <span className={`settings_pill${tone ? ` is-${tone}` : ''}`} title={title}>
      {dot ? <i aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Stats({ label, columns, className = '', children }) {
  return (
    <dl
      className={`settings_stats${className ? ` ${className}` : ''}`}
      aria-label={label}
      style={columns ? { '--settings-stats-columns': `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {children}
    </dl>
  );
}

// Glyphs for the figure and fact tiles (24px grid, stroked).
const STAT_ICONS = {
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  cross: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM15 9l-6 6M9 9l6 6',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  language: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  briefcase: 'M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  userCheck: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4',
  userOff: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM18 8l5 5M23 8l-5 5',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  server: 'M5 2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 14h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM6 6h.01M6 18h.01',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  block: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM4.93 4.93l14.14 14.14',
};

// A figure (default) or, with `text`, a fact in words. `icon` names one of
// STAT_ICONS.
export function Stat({ label, value, note, icon, tone = '', text = false, wrap = false, code = false, empty = false, lead = false }) {
  const glyph = STAT_ICONS[icon];
  const className = ['settings_stat', glyph && 'has-icon', lead && 'is-lead', text && 'is-text', wrap && 'is-wrap', tone && `is-${tone}`].filter(Boolean).join(' ');
  const valueClass = [code && 'is-code', empty && 'is-empty'].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      {glyph ? (
        <span className="settings_stat_icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={glyph} /></svg>
        </span>
      ) : null}
      <dt>{label}</dt>
      <dd className={valueClass} title={typeof value === 'string' && !wrap ? value : undefined}>{value}</dd>
      {note ? <small title={typeof note === 'string' ? note : undefined}>{note}</small> : null}
    </div>
  );
}

export function Block({ title, description, actions, label, children }) {
  return (
    <section className="settings_block" aria-label={label || (typeof title === 'string' ? title : undefined)}>
      <header className="settings_block_header">
        <div>
          <h4>{title}</h4>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="settings_block_actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

const OPTION_ICONS = {
  layout: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  motion: 'M22 12h-4l-3 9L9 3l-3 9H2',
  glass: 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};

// An option card: its glyph, what it does, its state and its switch. The
// whole card is the switch's label.
export function Option({ title, description, icon, checked, disabled = false, onChange }) {
  const glyph = OPTION_ICONS[icon];
  return (
    <label className={`settings_option settings_switch${checked ? ' is-on' : ''}`}>
      {glyph ? (
        <span className="settings_option_icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={glyph} /></svg>
        </span>
      ) : null}
      <span className="settings_option_text">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="settings_option_state" aria-hidden="true">{checked ? 'On' : 'Off'}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

// A popup over the Settings window, in the Graph window's "Generate report"
// card (the graph_customize shell): header, scrolling body, footer with a
// hint and the actions. Escape, × or a click outside closes it (not while
// busy). It is portalled to the window's frame so it covers the whole
// window rather than the scrolling tab area.
export function SettingsPopup({ title, subtitle, hint, footer, wide = false, narrow = false, busy = false, onClose, children }) {
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const [host, setHost] = useState(null);
  const titleId = `${useId()}-title`;

  useEffect(() => {
    setHost(anchorRef.current?.closest('.settings_window_workspace') || anchorRef.current?.parentElement || null);
  }, []);
  useEffect(() => {
    if (host) cardRef.current?.querySelector('input, select, textarea, button:not(.graph_customize_close)')?.focus();
  }, [host]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || busy) return;
      // With one popup open over another, Escape closes only the top one.
      const open = document.querySelectorAll('.settings_popup_backdrop');
      const top = open[open.length - 1];
      if (top && cardRef.current && !top.contains(cardRef.current)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const popup = (
    <div className="graph_customize_backdrop settings_popup_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={cardRef} className={`graph_customize is-report settings_popup${wide ? ' is-wide' : ''}${narrow ? ' is-narrow' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className="settings_popup_body">{children}</div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{hint}</span>
          {footer}
        </footer>
      </div>
    </div>
  );

  return (
    <>
      <span ref={anchorRef} hidden />
      {host ? createPortal(popup, host) : null}
    </>
  );
}
