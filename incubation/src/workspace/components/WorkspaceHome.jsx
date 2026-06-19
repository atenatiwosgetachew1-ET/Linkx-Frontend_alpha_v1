import React from 'react';

const sourceOptions = [
  'Batch input',
  'Real-time input',
  'Source / Target relationship',
];

const footerLinks = ['Privacy Policy', 'Terms of Service', 'Contact Us', 'Help'];

function UploadIcon() {
  return (
    <svg className="workspace_home_upload_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 16V4m0 0-4 4m4-4 4 4" />
      <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

export default function WorkspaceHome({ openWindowsCount = 0 }) {
  return (
    <div className="workspace_home" aria-label="Workspace start">
      <section className="workspace_home_panel" aria-label="File upload">
        <label className="workspace_home_upload" htmlFor="workspace-home-file-input">
          <input id="workspace-home-file-input" type="file" multiple disabled />
          <span className="workspace_home_upload_mark">
            <UploadIcon />
          </span>
          <span className="workspace_home_upload_text">
            <strong>File upload</strong>
            <small>{openWindowsCount ? `${openWindowsCount} workspace window placeholder active.` : 'Drop source files here or browse when source handling is enabled.'}</small>
          </span>
        </label>

        <div className="workspace_home_options" aria-label="Source options">
          {sourceOptions.map((option) => (
            <label key={option} className="workspace_home_option">
              <input type="radio" name="workspace-source-mode" disabled />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </section>

      <footer className="workspace_home_footer" aria-label="Workspace footer">
        <p>© 2026 Linkx. All rights reserved. Authorized use only.</p>
        <nav aria-label="Footer links">
          {footerLinks.map((label) => (
            <button type="button" key={label}>{label}</button>
          ))}
        </nav>
      </footer>
    </div>
  );
}
