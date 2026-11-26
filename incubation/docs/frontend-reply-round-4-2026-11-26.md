# Frontend reply to round 4: domains managed by a superuser

**From:** the LinkX frontend. **Date:** 2026-11-26. **To:** the request `service-request-round-4-2026-11-26.md` (B-49).

**In short:** we agree with all of it. We built our screens against your proposed routes. Until a route exists they stay out of the way: the app keeps its own list of domains, and the new page says "The Service does not offer this yet". Nothing has been run on the Service. Below are our five answers and what we need in return. The items marked **Please** are what we ask of you.

## 1. Sign-in: yes, built

Auto-login stays as it is for every visitor. What changed with auto-login on:

- **Sign out** no longer drops you straight back into the default account. It opens the sign-in page, with **Continue with the default account** below the form. The superuser signs in there with their username and password (`POST /auth/login`). Sign out first closes the work as any sign-out does: `/auth/logout`, sessions ended, runs with a seat kept.
- **We found and fixed a bug on our side.** Auto-login tokens are renewed shortly before they expire. That renewal would have replaced the superuser's own sign-in with the `admin` account, silently, within 30 minutes. Now only an auto-login token is renewed that way.
- When a password sign-in ends (expired, idle timeout, signed out), the sign-in page shows again. It never falls back to `admin` silently. A reload on that page stays on it.

**Please confirm or tell us:**
1. `POST /auth/login` works while auto-login is on.
2. How long a password sign-in's token lasts, and whether there is a refresh route. We have none for it today, so the superuser signs in again when it lapses.
3. **Important:** every visitor shares the one auto-login account. Does `/auth/logout` from one browser end the sessions and runs of the *other* visitors on `admin`, or only those of that token? If it ends theirs, Sign out must not call it for the auto-login account, and we will change that.
4. `domains:manage` comes in the permissions of `GET /auth/me` for the superuser.

## 2. Section 3: agreed

We agree with all of section 3. Three additions:
- **Please refuse two domains with the same display name.** Our selectors show domains by name, so two "Banking" entries cannot be told apart.
- **Please say what deactivating does to open sessions in that domain.** We assume it works like losing domain access (B-45): new searches, dataframes and streams are refused with `domain_inactive`, running runs go on, and `end_session` works.
- **Please refuse deactivating a domain that still has work tied to it,** for example `bank` while alert runs use it, or the domain of a service account. The refusal should name what uses it.

## 3. Section 4: the routes fit

What our screens read, so the shapes stay as they are:

| Route | We read |
|---|---|
| `GET /domains` | A list: `domain_id`, `display_name`, `description`, `active`, `origin`, `rule_set`, `profile_version_id`. Inactive ones included (we hide them in selectors) |
| `GET /rule-sets` | `name`, `required_fields` as groups of alternatives (as in `section=mapping`), `canonical_fields`, `relationships` (names), `domains` |
| `GET /domains/<id>/profile` | `profile: { field: value }`, `editable: { field: { type, min, max, max_length, pattern, allowed_values } }`, `origins`, `version_id` (`null` = never changed). A field missing from `editable` is shown read-only |
| `PATCH …/profile` | Changed fields only, plus `version_id` (as on the Domains page). The answer's `state` is the GET. `dry_run` answers `changed: { field: [now, after] }` |
| `POST /domains` | `{ domain_id, display_name, description, rule_set, copy_from }`. The answer holds the new domain as in `GET /domains`. A `dry_run` answers the profile it would create, shaped as the GET |
| `…/history` | `{ version_id, updated_by, created_at, changed: { field: [before, after] } }`, with deactivate and activate in it, with their `reason` |

**Please:**
- Use these field names, or tell us yours: `display_name`, `description`, `rule_set`, `source`, `target`, `relationship`, `node_label`, `date_column`, `storage_database`, `storage_tables` (list), `storage_path`, and `relationships` (shown only).
- Use these `type` values: `text`, `name`, `names` (a list of plain names), `list`, `integer`, `number`, `boolean`.
- Give `domains_changed` the payload `{ domain, action: "created" | "deactivated" | "activated" }`. We read the list again on any payload.
- Send `domain_inactive` with `domain`, as `domain_not_granted` does.
- Put the profile's version in `settings_used.versions.profile`. We already keep it with the run.

## 4. `copy_from`: only a domain on the chosen rule set

The keys of thresholds and presets belong to a rule set (closed sets, C5), so a copy from another rule set would bring keys the new domain cannot use. Our form offers only those domains. While `rule_set` is missing from `GET /domains`, it offers all of them.

## 5. Section 6: no

The frontend makes no rules. Analysts upload their own `.json` files, and we know of none that uses a built-in name. Refusing them is right.

**Please give the refusal its code and the clashing name,** for example `400 rule_name_reserved { name }` or `relationship_reserved { name }`, so we can say which one in words. Until then it shows as a general refusal. Once `GET /rule-sets` exists, we can also warn before the upload.

## What we built (nothing run on the Service)

- **Configuration ▸ Domain profiles:** a new tab, locked without `domains:manage`.
  - **List:** every domain, with inactive and created ones marked.
  - **Profile:** each field with its origin badge (Built in or Superuser). Plain names are checked before sending. Preview runs a dry run (offered only when the GET sends `version_id`). Saving asks first and sends the changed fields with `version_id`. On a conflict your edits are kept and the newer values are shown.
  - **History, and Deactivate or Activate** with a reason.
  - **New domain:** id checked (form, existing ids, aliases), display name, description, rule set with its required fields, copy from one on that rule set, Preview, Create.
- **Every domain selector** hides inactive domains (except the one in use) and shows display names, from `GET /domains`. That list is read once after sign-in and again on `domains_changed`. A profile change by someone else is announced, and the open page reads it again.
- **Refusals in words:** `domain_inactive`, `domain_exists`, `field_not_editable`.
