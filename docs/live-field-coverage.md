# Live field coverage — matcher vs real apply pages

Generated: 2026-10-19 (Asia/Shanghai). Matcher: `shared/match.js` → `matchFieldKey`.
**1.1.1:** false-positive fixes applied (see section below); tables below document pre-fix observations.
Hints mirror content script `collectHints` (name, id, autocomplete, placeholder, aria-label, data-testid, data-automation-id, className, label text) then normalize.

## Summary counts

| Page | HTTP | True matches | Unique true keys | False positives | Unmatched fillable | Files | Captcha |
|---|---:|---:|---:|---:|---:|---:|---|
| Requested #1 (board/jobs path) | 404 | 0 | 0 | 0 | 0 | 0 | no/unclear |
| Live substitute for #1 — GitLab job board (same URL shape) | 200 | 8 | 7 | 3 | 4 | 2 | yes |
| Requested #2 (embed job_app for airbnb) | 404 | 0 | 0 | 0 | 0 | 0 | no/unclear |
| Live substitute for #2 — Airbnb embed (live token) | 200 | 9 | 8 | 2 | 3 | 2 | yes |
| Extra — Stripe embed (cross-check Greenhouse SSR) | 200 | 11 | 10 | 0 | 3 | 2 | yes |
| Optional Chinese boards | — | — | — | — | — | — | skipped |

**Union of true matched keys (live pages):** city, company, country, degree, email, firstName, lastName, linkedin, phone, school, title, workAuth

**Core Greenhouse coverage (true hits):** `firstName`←`first_name`/`given-name`, `lastName`←`last_name`/`family-name`, `email`, `phone`, `country`, `city`←Location (City), `linkedin`←LinkedIn Profile label, `school`/`degree` when present, `company`/`title` when employer/job-title questions appear, `workAuth`←visa/sponsorship labels, `summary`←cover letter text when present.

**Expected gaps:** file upload (`resume`, `cover_letter`), reCAPTCHA Enterprise on submit, gender/veteran/EEO selects, checkbox acknowledgements (intentionally not auto-checked), opaque custom questions without keyword-bearing labels.

## False positives observed

| Spurious key | Example label / id | Cause |
|---|---|---|
| `summary` | How did you hear about this job? | keyword `about` |
| `city` | Are you Hispanic/Latino? (`hispanic_ethnicity`) | `city` ⊂ `ethnicity` |
| `city` | …worked… in any capacity? | `city` ⊂ `capacity` |
| `company` | Have you previously worked at or consulted for GitLab? | short keyword `org` ⊂ `forgitlab` |
| `company` | …employment agreements… current employer… | `employer` in legal question (not “current company” field) |

Recommendation: tighten short ASCII keywords (`org`, `about`, bare `city`) with word-boundary / denylist context, or require longer forms (`organization`, `about me`, `city` only with location/address context).

## Fixes in 1.1.1

Matcher updates in `shared/match.js` (+ content script passes `autocomplete` separately) address the false positives above:

| Issue | Fix |
|---|---|
| `#city` + `autocomplete=address-level2` → `address` | Prefer `AUTOCOMPLETE_MAP` (`address-level2`→`city`, `street-address`→`address`, …) before keyword scan |
| `hispanic_ethnicity` → `city` | Word-boundary for short `city`; denylist `ethnicity` / `hispanic` / `latino` |
| “worked… for GitLab” → `company` via `org` | Word-boundary for `org`; denylist previously-worked / consulted-for |
| Legal “current employer” → `company` | Denylist employment-agreement / post-employment contexts (real “current employer?” questions still match) |
| “How did you hear about…” → `summary` | Denylist hear-about; word-boundary for `about` |
| `capacity` → `city` | Denylist / skip when `capacity` present |
| Visa Yes/No select filled with free-text `workAuth` | `matchSelectOption` refuses Yes/No-only selects unless value clearly maps to Yes/No |
| Demo degree select | Synonym groups (本科↔Bachelor, 硕士↔Master, …) |

Re-scan of live pages after 1.1.1 should drop the FP rows in the tables below; true positives (name/email/phone/city location/linkedin/school/degree/employer title questions) unchanged.

## Requested #1 (board/jobs path)

- **URL:** https://boards.greenhouse.io/113134/jobs/5061733002
- **HTTP:** 404 (12249 bytes)
- **Note:** Job token expired/removed; Greenhouse redirects to board error page. No apply form in HTML.
- **Matched keys:** (none — no usable form)
- **Unmatched field hints:** (none)
- **Expected gaps:** N/A for 404/error shell

## Live substitute for #1 — GitLab job board (same URL shape)

- **URL:** https://job-boards.greenhouse.io/gitlab/jobs/8860302002
- **HTTP:** 200 (80393 bytes)
- **Note:** SSR Remix page with application inputs. Title: Account Executive - France.
- **True matched keys:** `firstName`, `lastName`, `email`, `country`, `phone`, `linkedin`, `workAuth`
- **False-positive hits:** `company` on `question_38624170002`; `company` on `question_38624173002`; `city` on `hispanic_ethnicity`

### Matched fields

| Key | id | label / aria-label | autocomplete | FP? |
|---|---|---|---|---|
| firstName | first_name | First Name * | given-name |  |
| lastName | last_name | Last Name * | family-name |  |
| email | email | Email * | email |  |
| country | country | Country | off |  |
| phone | phone | Phone |  |  |
| linkedin | question_38624168002 | LinkedIn Profile |  |  |
| company | question_38624170002 | Are you subject to any employment agreements and/or post-employment restrictions with your current e | off | `employer` in legal/employment-agreement question |
| workAuth | question_38624172002 | Will you now or in the future require sponsorship for a visa to remain in your current location? * | off |  |
| company | question_38624173002 | Have you previously worked at or consulted for GitLab? * | off | short keyword `org` ⊂ "for GitLab" / similar |
| country | question_38624174002 | What is your current country of residence? * | off |  |
| city | hispanic_ethnicity | Are you Hispanic/Latino? | off | `city` ⊂ `ethnicity` |

### Unmatched field hints (fillable)

| id | label / aria-label |
|---|---|
| question_38624169002 | What's the name you'd prefer us to use throughout the interview process? |
| question_38624171002 | It is important to us to create an accessible and inclusive interview experience. Please let us know |
| gender | Gender |
| veteran_status | Veteran Status |

### Expected gaps

- **File upload:** resume, cover_letter
- **Captcha:** recaptcha/captcha strings in HTML; Greenhouse also uses reCAPTCHA Enterprise at submit
- **Checkboxes skipped by design:** 0
- **Comboboxes:** react-aria text inputs, not native `<select>` — `matchSelectOption` does not apply.

## Requested #2 (embed job_app for airbnb)

- **URL:** https://boards.greenhouse.io/embed/job_app?for=airbnb&token=6804257
- **HTTP:** 404 (10998 bytes)
- **Note:** Token 6804257 no longer valid (Page not found).
- **Matched keys:** (none — no usable form)
- **Unmatched field hints:** (none)
- **Expected gaps:** N/A for 404/error shell

## Live substitute for #2 — Airbnb embed (live token)

- **URL:** https://job-boards.greenhouse.io/embed/job_app?for=airbnb&token=8184174
- **HTTP:** 200 (56860 bytes)
- **Note:** boards.greenhouse.io embed → 301 → job-boards.greenhouse.io. Job: Account Manager (id 8184174).
- **True matched keys:** `firstName`, `lastName`, `email`, `country`, `phone`, `city`, `linkedin`, `workAuth`
- **False-positive hits:** `summary` on `question_69024585`; `city` on `question_69024591`

### Matched fields

| Key | id | label / aria-label | autocomplete | FP? |
|---|---|---|---|---|
| firstName | first_name | First Name * | given-name |  |
| lastName | last_name | Last Name * | family-name |  |
| email | email | Email * | email |  |
| country | country | Country * | off |  |
| phone | phone | Phone * |  |  |
| city | candidate-location | Location (City) | off |  |
| linkedin | question_69024584 | LinkedIn Profile |  |  |
| summary | question_69024585 | How did you hear about this job? * |  | keyword `about` in "hear about" |
| country | question_69024588 | Are you legally authorized to work in the country where the job is located? * | off |  |
| workAuth | question_69024589 | Will you now or in the future require company sponsorship to retain or extend your work authorizatio | off |  |
| city | question_69024591 | Are you currently or have you ever worked for Airbnb in any capacity? This could include, but is not | off | `city` ⊂ `capacity` |

### Unmatched field hints (fillable)

| id | label / aria-label |
|---|---|
| question_69024587 | Gender * |
| question_69024590 | Are you currently subject to any non-compete or non-solicitation agreement that would impact your ab |
| question_69024592 | Candidate AI Usage Attestation: * |

### Expected gaps

- **File upload:** resume, cover_letter
- **Captcha:** recaptcha/captcha strings in HTML; Greenhouse also uses reCAPTCHA Enterprise at submit
- **Checkboxes skipped by design:** 1
- **Comboboxes:** react-aria text inputs, not native `<select>` — `matchSelectOption` does not apply.

## Extra — Stripe embed (cross-check Greenhouse SSR)

- **URL:** https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8172508
- **HTTP:** 200 (99554 bytes)
- **Note:** Abuse Investigator; includes School/Degree and employer/title custom questions.
- **True matched keys:** `firstName`, `lastName`, `email`, `country`, `phone`, `city`, `school`, `degree`, `company`, `title`

### Matched fields

| Key | id | label / aria-label | autocomplete | FP? |
|---|---|---|---|---|
| firstName | first_name | First Name * | given-name |  |
| lastName | last_name | Last Name * | family-name |  |
| email | email | Email * | email |  |
| country | country | Country * | off |  |
| phone | phone | Phone * |  |  |
| city | candidate-location | Location (City) * | off |  |
| school | school--0 | School * | off |  |
| degree | degree--0 | Degree * | off |  |
| company | question_68935488 | Who is your current or previous employer? * |  |  |
| title | question_68935489 | What is your current or previous job title? * |  |  |
| country | question_68935490 | Please select the country where you currently reside. * | off |  |

### Unmatched field hints (fillable)

| id | label / aria-label |
|---|---|
| question_68935492 | Are you authorized to work in the location(s) you selected in your previous response? * |
| question_68935493 | Will you require Stripe to sponsor you for a work permit now or in the future for the location(s) yo |
| question_69457838 | To ensure we can focus fully on our conversation, we use BrightHire to record and transcribe intervi |

### Expected gaps

- **File upload:** resume, cover_letter
- **Captcha:** recaptcha/captcha strings in HTML; Greenhouse also uses reCAPTCHA Enterprise at submit
- **Checkboxes skipped by design:** 30
- **Comboboxes:** react-aria text inputs, not native `<select>` — `matchSelectOption` does not apply.

## Optional Chinese boards

Tried public pages: Boss直聘 geek job list, 51job, 智联校园, 猎聘. All returned SPA shells or listing chrome via curl; **no login-free apply form** with name/email fields was available. Skipped matcher run.

## Method notes

1. Requested tokens returned **404**; live substitutes kept the same URL patterns (`/{board}/jobs/{id}` and `/embed/job_app?for=&token=`).
2. Visible Greenhouse text inputs often have `id` + `aria-label` + `<label for>` but **no `name=`** (JS submit). Matcher still hits via id/label/autocomplete.
3. Job Board API `GET .../jobs/{id}?questions=true` confirms canonical names: `first_name`, `last_name`, `email`, `phone`, `resume`, `cover_letter`, plus `question_*`.
