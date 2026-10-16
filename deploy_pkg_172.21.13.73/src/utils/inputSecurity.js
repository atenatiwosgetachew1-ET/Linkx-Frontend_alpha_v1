/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const HTML_MARKUP_CHARS = /[<>]/g;
const IDENTIFIER_UNSAFE_CHARS = /[^a-zA-Z0-9_.@-]/g;
const SECRET_UNSAFE_CHARS = /[\s\u0000-\u001F\u007F]/g;
const PERMISSION_PATTERN = /^[a-z][a-z0-9:_-]*$/i;

export const stripControlChars = (value = "") => String(value ?? "").replace(CONTROL_CHARS, "");

export const sanitizeText = (value = "", { maxLength = 120, allowNewlines = false } = {}) => {
  const raw = String(value ?? "");
  const withoutControls = allowNewlines ? raw.replace(CONTROL_CHARS, "") : stripControlChars(raw).replace(/\s+/g, " ");
  return withoutControls.replace(HTML_MARKUP_CHARS, "").slice(0, maxLength);
};

export const sanitizeIdentifier = (value = "", { maxLength = 120 } = {}) => (
  stripControlChars(value).replace(IDENTIFIER_UNSAFE_CHARS, "").slice(0, maxLength)
);

export const sanitizeSecret = (value = "", { maxLength = 256 } = {}) => (
  String(value ?? "").replace(SECRET_UNSAFE_CHARS, "").slice(0, maxLength)
);

export const sanitizeConnectionValue = (value = "", { maxLength = 300 } = {}) => (
  stripControlChars(value).trim().replace(/[<>"'`]/g, "").slice(0, maxLength)
);

export const sanitizeKafkaTopic = (value = "", { maxLength = 249 } = {}) => (
  stripControlChars(value).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, maxLength)
);

export const sanitizeRelationshipName = (value = "", { maxLength = 80 } = {}) => (
  sanitizeIdentifier(value, { maxLength }).replace(/[@.-]/g, "_").toUpperCase()
);

export const sanitizePermissionList = (permissions = []) => Array.from(new Set(
  (Array.isArray(permissions) ? permissions : [])
    .map((permission) => sanitizeIdentifier(permission, { maxLength: 80 }))
    .filter((permission) => PERMISSION_PATTERN.test(permission))
)).sort();

export const sanitizeRoleList = (roles = [], allowedRoles = []) => {
  const allowed = new Set(allowedRoles);
  return Array.from(new Set(Array.isArray(roles) ? roles : []))
    .map((role) => sanitizeIdentifier(role, { maxLength: 40 }))
    .filter((role) => allowed.has(role));
};

export const validateRequiredIdentifier = (value, label, { minLength = 3, maxLength = 120 } = {}) => {
  const normalized = sanitizeIdentifier(value, { maxLength }).trim();
  if (!normalized) return `${label} is required.`;
  if (normalized.length < minLength) return `${label} must be at least ${minLength} characters.`;
  if (normalized !== String(value ?? "").trim()) return `${label} contains unsupported characters.`;
  return "";
};

export const validateDisplayName = (value, label = "Display name") => {
  const normalized = sanitizeText(value, { maxLength: 120 }).trim();
  if (String(value ?? "").trim() && !normalized) return `${label} contains unsupported characters.`;
  if (normalized.length > 120) return `${label} must be 120 characters or less.`;
  return "";
};

export const validateLoginPassword = (value) => {
  const password = sanitizeSecret(value, { maxLength: 256 });
  if (!password) return "Password is required.";
  if (password !== String(value ?? "")) return "Password contains unsupported whitespace or control characters.";
  return "";
};

export const validateNewPassword = (value, { required = true } = {}) => {
  const password = sanitizeSecret(value, { maxLength: 256 });
  if (!password) return required ? "Password is required." : "";
  if (password !== String(value ?? "")) return "Password contains unsupported whitespace or control characters.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return "";
};

export const validateClientSecret = (value) => {
  const secret = sanitizeSecret(value, { maxLength: 128 });
  if (!secret) return "Client secret is required.";
  if (secret !== String(value ?? "")) return "Client secret contains unsupported whitespace or control characters.";
  if (secret.length < 32) return "Client secret must be at least 32 characters.";
  return "";
};

export const validateConnectionValue = (value, label = "Address") => {
  const normalized = sanitizeConnectionValue(value);
  if (!normalized) return `${label} is required.`;
  if (normalized !== String(value ?? "").trim()) return `${label} contains unsupported characters.`;
  return "";
};

export const validateKafkaTopic = (value, label = "Kafka topic") => {
  const normalized = sanitizeKafkaTopic(value);
  if (!normalized) return `${label} is required.`;
  if (normalized !== String(value ?? "")) return `${label} can only contain letters, numbers, dots, underscores, and hyphens.`;
  return "";
};

export const validateRelationshipName = (value) => {
  const normalized = sanitizeRelationshipName(value);
  if (!normalized) return "Relationship name is required.";
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalized)) return "Relationship name must be an uppercase identifier.";
  return "";
};

export const compactValidationErrors = (...errors) => errors.flat().filter(Boolean).join(" ");


export const validateSchema = (value = {}, schema = {}) => {
  const source = value && typeof value === "object" ? value : {};
  const sanitized = {};
  const errors = [];

  Object.entries(schema).forEach(([field, rules = {}]) => {
    const raw = source[field];
    const sanitizer = typeof rules.sanitize === "function" ? rules.sanitize : (item) => item;
    const normalized = sanitizer(raw);

    const label = rules.label || field;
    const isEmpty = normalized === undefined || normalized === null || String(normalized).trim?.() === "";
    if (rules.required && isEmpty) {
      errors.push(label + " is required.");
      return;
    }
    if (isEmpty) {
      if (typeof rules.validate === "function") {
        const customError = rules.validate(normalized, sanitized, source);
        if (customError) errors.push(customError);
      }
      return;
    }
    sanitized[field] = normalized;

    if (Number.isFinite(rules.minLength) && String(normalized).length < rules.minLength) {
      errors.push(label + " must be at least " + rules.minLength + " characters.");
    }
    if (Number.isFinite(rules.maxLength) && String(normalized).length > rules.maxLength) {
      errors.push(label + " must be " + rules.maxLength + " characters or less.");
    }
    if (rules.pattern && !rules.pattern.test(String(normalized))) {
      errors.push(rules.message || (label + " has an invalid format."));
    }
    if (typeof rules.validate === "function") {
      const customError = rules.validate(normalized, sanitized, source);
      if (customError) errors.push(customError);
    }
  });

  return {
    ok: errors.length === 0,
    value: sanitized,
    errors,
    message: errors.join(" "),
  };
};
