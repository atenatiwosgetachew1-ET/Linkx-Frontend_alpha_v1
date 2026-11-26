# Service request, round 4: domains managed by a superuser

> Our copy of the Service's request of 2026-11-26, as received. Our answer: `frontend-reply-round-4-2026-11-26.md`. Backend entry: B-49.

**From:** the LinkX Service (backend). **Date:** 2026-11-26.
**Purpose:** agree on the screens and routes before we build. **Nothing here is built yet.** Please answer section 7.

## 1. Why

Today a domain's profile is a file in the Service's code. A new domain, or a change to its storage, rule set or graph shape, needs a developer and a deployment. The Service owner wants that run by the system: a **superuser** creates domains and changes their profile, in screens, with history and without a deployment.

Admins keep what they have (Domains page: thresholds, presets, scoring, columns, mapping, entity lists). The superuser gets the level above.

## 2. Who

| Item | Rule |
|---|---|
| Role | `superuser`, permission **`domains:manage`** (new, superuser only). Not given to `admin` |
| Account | One separate account with its own password, made by the Service owner. Never the auto-login account |
| Giving the role | Only a superuser can (exists: an admin may give only `analyst` and `viewer`) |

**Sign-in:** the auto-login lands every visitor in `admin`. The superuser must sign in with username and password. Section 7, question 1.

## 3. What the superuser may change

| Profile part | Change? | Rule |
|---|---|---|
| Display name, description | Yes | Text, at most 120 and 1,000 characters |
| Domain id (`bank`, `cdr`, …) | **Never** | Runs, evidence, settings and access point at it. Make a new domain instead |
| Rule set | Yes, chosen from the rule sets that exist | Applies to new runs only |
| Writing rule code | **Never from a screen** | Rule code runs inside the Service's workers; new rule sets are made by developers, with tests |
| Source, target, relationship name, node label | Yes | Plain names (letters, digits, `_`): they go into graph queries |
| Pattern list (`relationships`) | No, shown only | It is what the rule set produces |
| Date column | Yes | A field the mapping fills or the data has |
| Storage database, tables, path | Yes | Plain names. The address and login stay in the admin's connection settings |
| New domain | Yes, on an existing rule set | Starts as a copy of a domain using that rule set (thresholds, scoring, entity lists, presets, columns, mapping); then tuned as today |
| Remove a domain | **No: deactivate** | A deactivated domain takes no new work; its records stay readable. It can be activated again |

Every change is versioned, audited with before and after, and applies to **new** runs. Running runs keep what they started with, and `settings_used` gets the profile's version.

## 4. Proposed routes (to agree)

| Route | What |
|---|---|
| `GET /domains` | Every domain: `domain_id`, `display_name`, `active`, `origin` (`builtin` or `created`), `rule_set`, `profile_version_id`. Readable with `config:read` |
| `GET /rule-sets` | The rule sets that exist: `name`, `required_fields`, `canonical_fields`, `relationships`, and the domains using each |
| `GET /domains/<id>/profile` | The effective profile, `editable` (per field: `type`, limits, allowed values), `origins` (`file` or `superuser`) and `version_id` |
| `POST /domains` | Create: `{ domain_id, display_name, description, rule_set, copy_from, … }`. `dry_run: true` shows the result without saving |
| `PATCH /domains/<id>/profile` | Change editable fields; send `version_id` (old: `409 version_conflict { current }`, as on the Domains page). `dry_run` as above |
| `GET /domains/<id>/profile/history` | Versions, newest first, `limit` up to 200 |
| `POST /domains/<id>/deactivate` and `/activate` | With a `reason` |

**Refusals:** `403 { permission: "domains:manage" }`; `400 invalid_field` with `invalid_fields`; `409 domain_exists`; `409 version_conflict`; `400 field_not_editable` for the fields marked never/no above.

**Events:** the socket event `domain_config_changed` gets `section: "profile"`, and a new `domains_changed` on create, deactivate and activate.

**Domain ids:** lower case letters, digits and `_`, 2 to 40 characters, not one of the existing ids or their aliases (`banking`, `telecom`, `mfi`, …).

## 5. What changes for screens you already have

- Domain selectors read `GET /domains` and hide inactive domains. A user's granted domains and `registered_domains` still apply.
- An inactive domain refuses new searches, dataframes and runs, with `domain_inactive`. Existing records stay readable.
- The Domains page (admin) works for created domains as for built-in ones.

## 6. Also for this round (found while preparing it)

These are fixed on our side and need nothing from you, unless you upload rules:
- **Uploaded rules (`.json` in Configuration ▸ Rules):** we will refuse a rule name that equals a built-in rule set, and relationship names that equal built-in patterns (`SMURFING`, …). Today such an upload replaces the built-in rules in that session without saying so.
- An uploaded rule will stay in its session: today it is also copied to a place every session reads.
- Rule types that compare every row with every other row get a size limit.

## 7. Please answer

1. **Sign-in:** can your screens sign in a second user with username and password while the auto-login is on (for example, "Sign in as another user")? If not, what do you need from us?
2. Section 3: agreed, or where not?
3. Section 4: do the routes and shapes fit your screens? What is missing?
4. Do you want `copy_from` to be any domain, or only one using the chosen rule set?
5. Section 6: do you upload rules whose names or patterns equal the built-in ones? If yes, they will be refused.
