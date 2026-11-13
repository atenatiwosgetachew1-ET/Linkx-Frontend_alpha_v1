import React, { useRef, useState } from 'react';

import Modal from '../../../shared/components/Modal.jsx';

// Password dialog for encrypted (.lxac) configuration export / import.
// `onSubmit(password)` must throw with a user-facing message on failure.
export default function LxacDialog({ mode, file, onSelectFile, onDropFile, onSubmit, onClose }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);
  const isExport = mode === 'export';

  const handleSubmit = async (event) => {
    event.preventDefault();
    // Never trimmed: the exact characters typed encrypt and decrypt the file.
    const value = password;
    if (!value) {
      setError(isExport ? 'Please enter an encryption password.' : 'Please enter the decryption password.');
      return;
    }
    if (isExport && value.length < 12) {
      setError('Use at least 12 characters for the encryption password.');
      return;
    }
    if (isExport && value !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!isExport && !file) {
      setError('Select an encrypted configuration file first.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(value);
    } catch (err) {
      setError(err?.message || (isExport ? 'Failed to export encrypted configuration.' : 'Decryption failed. Please check your password.'));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      as="form"
      title={isExport ? 'Export configuration' : 'Import configuration'}
      onClose={onClose}
      onSubmit={handleSubmit}
      closeDisabled={submitting}
      initialFocusRef={inputRef}
    >
        <p className="settings_hint">
          {isExport
            ? 'Enter a password to encrypt this configuration. You will need it to import the file into another session.'
            : 'Enter the decryption password to import and merge this multi-domain configuration into the active session.'}
        </p>

        {!isExport ? (
          file ? (
            <div className="config_window_file_badge">
              <span title={file.name}>{file.name}</span>
              <small>({Math.max(1, Math.round(file.size / 1024))} KB)</small>
              <button type="button" aria-label="Drop selected file" disabled={submitting} onClick={onDropFile}>✕</button>
            </div>
          ) : (
            <button type="button" className="settings_button" onClick={onSelectFile}>Select file…</button>
          )
        ) : null}

        {error ? <div className="settings_error" role="alert">{error}</div> : null}

        <label className="config_window_field">
          <span className="config_window_field_label">{isExport ? 'Encryption password' : 'Decryption password'}</span>
          <input
            ref={inputRef}
            className="settings_input"
            type={showPassword ? 'text' : 'password'}
            value={password}
            disabled={submitting}
            autoComplete={isExport ? 'new-password' : 'current-password'}
            onChange={(event) => { setPassword(event.target.value); setError(''); }}
          />
        </label>
        {isExport ? <small className="config_window_field_hint">At least 12 characters. Spaces count, and the password cannot be recovered.</small> : null}
        {isExport ? (
          <label className="config_window_field">
            <span className="config_window_field_label">Confirm encryption password</span>
            <input
              className="settings_input"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              disabled={submitting}
              autoComplete="new-password"
              onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }}
            />
          </label>
        ) : null}
        <label className="settings_toggle_row config_window_toggle">
          <input type="checkbox" checked={showPassword} disabled={submitting} onChange={(event) => setShowPassword(event.target.checked)} />
          <span>Show password characters</span>
        </label>

        <footer className="config_window_inline_actions is-end">
          <button type="button" className="settings_button" disabled={submitting} onClick={onClose}>Cancel</button>
          <button type="submit" className="settings_button" disabled={submitting || !password || (!isExport && !file)}>
            {submitting ? (isExport ? 'Exporting…' : 'Importing…') : (isExport ? 'Export' : 'Import')}
          </button>
        </footer>
    </Modal>
  );
}
