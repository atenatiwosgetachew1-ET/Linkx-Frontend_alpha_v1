import React, { useState } from "react";
import {
  compactValidationErrors,
  sanitizeIdentifier,
  sanitizeSecret,
  validateLoginPassword,
  validateRequiredIdentifier,
} from "../utils/inputSecurity.js";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setError(err?.message || "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="linkx_login_shell">
      <section className="linkx_login_panel" aria-label="Login">
        <div className="linkx_login_brand">
          <span>Linkx</span>
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
    </main>
  );
}
