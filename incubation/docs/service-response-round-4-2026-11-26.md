# Service response to round 4 (B-49)

> Our copy of the Service's response of 2026-11-26 to `frontend-reply-round-4-2026-11-26.md`, condensed; the codes, shapes and field names are as received. **Status: everything "Next"** (built on the Service, live with its next deployment; until then the routes answer 404).

## Status
- **Next:** the seven routes, `domains:manage`, versions, `dry_run`, audit, events; `domain_inactive`; `settings_used.versions.profile` (`null` = never changed); `409 display_name_exists`; `409 domain_in_use` with `used_by`; uploaded-rule refusals with code and name.
- **Refused:** our field names (theirs are kept, below); a refresh route for a password sign-in (sign-in moves to the parent's SSO).
- **Exists:** the superuser account (role `superuser`).

## Sign-in
1. `POST /auth/login` works with auto-login on; a valid token is its own account. 5 tries a minute.
2. Token lasts 60 minutes (`LINKX_AUTH_TOKEN_SECONDS`), no refresh: sign in again.
3. **`/auth/logout` works on the account**: it ends every open session of the account (up to 50; seats kept), releases its locks, revokes only the calling token. For the auto-login account: drop the token, do not call it. Password sign-ins: call it.
4. `GET /auth/me` permissions come from the roles on every request; `domains:manage` is in `superuser` only.

## Our three additions
- Same display name: `409 { code: "display_name_exists", invalid_fields: ["display_name"] }`, compared without case and extra spaces, inactive domains included; `detail` names the domain.
- Deactivated domain: new `search`, `create_DF`, `preview_DF_filter`, `stream` and a switch to it → `409 { code: "domain_inactive", domain }`. Runs go on, `end_session` works, records readable; an account already in it keeps saving its configuration.
- `409 { code: "domain_in_use", domain, used_by: [{ type, name, detail }] }`, `type` = `default_domain`, `alert_runs`, `service_account` (`name` = client id). `bank` cannot be deactivated today. Activating is never refused.

## Shapes
| Ours (asked) | Theirs |
|---|---|
| `source`, `target` | `default_source_col`, `default_target_col` |
| `relationship` | `default_relationship` |
| `node_label` | `neo4j_node_label` |
| `storage_database` | `storage_databases` (list), `active_storage_database` |
| `storage_tables` | `storage_tables` (list), `active_storage_tables` |
| others | the same |

- `editable: { field: { type, max_length, pattern, allowed_values, max_items, required } }`; `type` ∈ `text`, `name`, `names`. `rule_set`, `active_storage_database`, `active_storage_tables` carry `allowed_values`. `not_editable` lists `domain_id`, `relationships` (`400 field_not_editable` if sent).
- Profile GET also: `active`, `origin`, `updated_by`, `updated_at`, `reason`; `origins` `file` | `superuser`; needs `domains:manage` (`GET /domains`, `/rule-sets`: `config:read`).
- `PATCH`: `results: { state, changed, warnings, dry_run, version_id }`. `null` puts a built-in domain's field back (a created domain: `400 invalid_field`). Rule-set change: `warnings: [{ code: "rule_set_changed", from, to, detail }]`, also in the dry run: **show it before the save**.
- `POST /domains`: `201 results: { domain, state, copied_from, copied, dry_run }`; `copied` ⊂ `thresholds`, `lineage`, `entities`, `columns`, `mapping`, `preset`. Dry run `200`, same shape. `copy_from` required; `rule_set` left out = `copy_from`'s.
- History: `{ version_id, updated_by, created_at, reason, action, changed }`, `action` ∈ `created`, `changed`, `deactivated`, `activated` (`changed: { active: [before, after] }`).
- Events: `domains_changed { domain, action, active, version_id }`; `domain_config_changed { domain, section: "profile", version_id }`.
- Refusals (all with `code`, `detail`, `invalid_fields`): `invalid_field` 400, `field_not_editable` 400, `domain_exists` 409 (ids and aliases), `display_name_exists` 409, `version_conflict` 409, `domain_in_use` 409, `domain_inactive` 409, `unknown_domain` 404.

## copy_from: agreed (same rule set only; another: `400 invalid_field ["copy_from"]`)

## Uploaded rules
- `400 { code: "rule_name_reserved", name, invalid_fields: ["rule_name"] }`; `400 { code: "relationship_name_reserved", name, invalid_fields: ["relationship.name"] }`.
- An uploaded rule belongs to its session (and its Source windows); upload again in another session.
- `PAIRWISE` needs `match.group_by`; `PAIRWISE` and `CIRCULAR` not over 50,000 rows, a sequence rule without `group_by` not over 500,000: the run fails saying so.

## The Service asks us to check after the deployment
1. Superuser: `GET /auth/me` has `domains:manage`; `admin` does not.
2. Sign out of the auto-login account in one browser does not end another browser's run.
3. Create a domain from `bank`, dry run then real; it appears in `GET /domains` and the selectors after `domains_changed`.
4. Deactivate it: a search in an open session answers `domain_inactive`; its records still open.
5. `bank` cannot be deactivated; the refusal names why.
6. Two tabs on one profile: the second save answers `version_conflict` with `current`.
