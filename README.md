# Agentforce Record Insights

AI-powered conversational insights grounded in live Salesforce record data. Uses the Salesforce Models API to provide multi-turn chat about supported Salesforce records with dynamic field discovery, relationship traversal, and cross-record comparison.

## What It Does

**Drop it on any record page** and it automatically discovers the available fields and relationships for that object. Users can chat with the AI about their CRM data, toggle which context to include, and compare multiple records side by side.

**Key Capabilities:**
- **Zero-config context discovery** — Insights mode works broadly across standard and custom objects using Schema Describe APIs
- **Dynamic relationship traversal** — Uses `getChildRelationships()` to discover related records automatically
- **User-controlled context** — Toggle field categories, related objects, and traversal depth (1, 2, or 3 levels)
- **Cross-record comparison** — Compare 2-5 records of the same supported type with AI-powered analysis
- **Multi-turn conversation** — Persistent chat with localStorage, markdown rendering, suggested prompts
- **Permission-aware** — Enforces FLS, CRUD, and sharing rules at every layer
- **Permission-scoped record picking** — App/Home insights and compare mode use searchable record selection instead of raw-ID-first entry
- **Model selection** — Uses Salesforce model API names with a hard-coded fallback chain

## How It Differs from Einstein Summary

| Capability | Einstein Summary | Record Insights |
|---|---|---|
| File analysis | Core strength | Not included (intentional) |
| Record field context | No | Yes — dynamic field discovery |
| Relationship traversal | No | Yes — walks the data graph |
| Cross-record comparison | No | Yes — compare 2-5 records |
| Multi-turn conversation | No | Yes — persistent chat |
| Works on any object | Per Prompt Template | Broad insights support; compare uses a safe supported-object subset |

## Architecture

```text
LWC Layer:
  agentforceRecordInsights (orchestrator)
    ├── contextPanel (field/relationship toggles, depth, token estimate)
    ├── chatPanel (multi-turn chat, markdown, suggested prompts)
    ├── insightsFieldSelector (category selection modal)
    ├── recordCompare (multi-record picker + comparison chat)
    └── recordPicker (shared object/record picker for app/home insights and compare)

Apex Layer:
  RecordContextService    — Generic context engine (Schema Describe, dynamic SOQL)
  RecordAdvisorController — Chat controller (Models API, system prompts)
  RecordCompareService    — Cross-record comparison
  RecordSchemaUtils       — Schema utilities (field lists, name field, value normalization)

Platform:
  Salesforce Models API (aiplatform namespace)
  Schema Describe APIs
  Dynamic SOQL with sharing
```

## Deployment

### Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) installed
- Authenticated Salesforce org with Salesforce Models API enabled
- At least one supported Salesforce model alias available in the target org
- API version `66.0+`

Node.js and npm are optional for deployment. They are only needed if you want to run the local LWC Jest test suite.

### Authenticate to an org

```bash
# Login to a sandbox or production org
sf org login web --alias my-org

# Or use an existing default org
sf org display
```

### Deploy the project

```bash
# Deploy to a specific org
sf project deploy start --source-dir force-app --target-org my-org

# Or deploy to your default org
sf project deploy start --source-dir force-app

# Validate deployment (dry run) without writing to the org
sf project deploy start --source-dir force-app --target-org my-org --dry-run

# Deploy with Apex test execution
sf project deploy start --source-dir force-app --target-org my-org --test-level RunLocalTests
```

### Post-deployment

1. Assign the `Agentforce Record Insights User` permission set to users who need access to the component's Apex services.
2. Add the `agentforceRecordInsights` component to a Record Page, App Page, or Home Page in Lightning App Builder.
3. Confirm that the target org has Salesforce Models API access and at least one of the configured model aliases available.

The permission set grants Apex class access only. Object access, field-level security, and sharing remain controlled by the user's existing Salesforce permissions.

### Recommended deploy flow

```bash
# 1. Deploy the metadata
sf project deploy start --source-dir force-app --target-org my-org

# 2. Assign the packaged permission set to the default org user
sf org assign permset --name Agentforce_Record_Insights_User --target-org my-org

# 3. Optionally run Apex tests after deployment
sf apex run test --target-org my-org --test-level RunLocalTests
```

### Add the component in Lightning App Builder

After deployment:

1. Open Lightning App Builder.
2. Edit the target Record Page, App Page, or Home Page.
3. Drag **Agentforce Record Insights** onto the page.
4. Configure the builder properties you want, such as default mode, preload compare mode, and usage visibility.
5. Save and activate the page.

### Do `package.json` or `sfdx-project.json` need to stay in the repo?

- `sfdx-project.json`: Yes, if you plan to deploy this source with `sf project deploy start`. The `sf project` commands expect a Salesforce DX project.
- `package.json`: No, not for deployment itself. It is only used here for local development tasks such as LWC Jest tests.

If someone only wants to deploy metadata without using a DX project, they can convert or deploy in metadata format instead of using `sf project deploy start`. For this repo and its documented workflow, keep both files.

## Usage

1. **Record Page:** Add the "Agentforce Record Insights" component to any record page via Lightning App Builder. It auto-detects the record and object type.
2. **App Page:** Add to a Lightning App Page for cross-record comparison mode or manual insights mode. Users select a supported object type and search for records they can access.
3. **Home Page:** Add to a Lightning Home Page for insights or comparison using the same permission-scoped record picker.

## Important Behavior

- **Insights mode** is designed to work broadly across standard and custom objects that the current user can access.
- **Compare mode** intentionally exposes a safe supported-object subset. Objects that cannot support reliable name-based search, recent-record discovery, or compare suggestions are excluded instead of failing at runtime.
- **Prompt size control** is configurable through the `Large Prompt Warning Threshold (Tokens)` builder property. In compare mode, that threshold also acts as the server-enforced comparison context ceiling. Set it to `0` to disable the ceiling.
- **Model availability** is curated through hard-coded Salesforce model API names in Apex. If the selected or default aliases are unavailable in the org, the component falls back through the configured list and returns a clear error if none are usable.

## Builder Settings to Know

- `Preload Compare Mode`: Defaults to `true` on record pages. Starts compare setup in the background so support checks and search are ready sooner when the user opens Compare.
- `Large Prompt Warning Threshold (Tokens)`: Defaults to `20000`. Warns before large prompts and limits compare payload size unless set to `0`.
- `Maximum Compare Records`: Caps compare selection between `2` and `5` records.
- `Related Records Per Relationship`: Controls how many child records are loaded per selected relationship and directly affects prompt size, response latency, and flex-credit use.
- `Enable Suggested Follow-Ups`: Adds an extra AI call after each response.
- `Persist Conversation`: Stores chat history and usage metrics in browser `localStorage` only.

## Local Development and Testing

```bash
# Install local dependencies
npm install

# Run LWC unit tests
npm run test:unit

# Run LWC unit tests with coverage
npm run test:unit:coverage

# Run Apex tests in a target org
sf apex run test --target-org my-org --test-level RunLocalTests
```

If you are preparing this for packaging, use an org with Salesforce Models API access and validate package-relevant Apex coverage in addition to local LWC tests.

## 2GP Managed Packaging

This branch is structured for a namespaced 2GP managed package built from `force-app`.

### Current package state

- Packaging Dev Hub alias: `sflabs`
- Namespace: `sfpalabs`
- Package alias: `Agentforce Record Insights` -> `0Hoao0000003KBtCAM`
- Latest created version: `Agentforce Record Insights@1.0.0-1` -> `04tao000004qWCnAAM`
- Current package version config in `sfdx-project.json`: `versionName: ver 1.0`, `versionNumber: 1.0.0.NEXT`

### Packaging prerequisites

- Dev Hub enabled in the packaging org aliased as `sflabs`
- The `sfpalabs` namespace linked to that Dev Hub
- Second-generation managed packaging enabled in the Dev Hub
- Einstein / Agentforce features enabled in the Dev Hub
- Einstein Terms of Service already accepted in the Dev Hub
- A clean scratch org created from that Dev Hub for install validation

### Verify or refresh Dev Hub auth

If package commands fail because the CLI can see the org but cannot resolve or use its auth, re-authenticate `sflabs` and retry. All package commands below pass `--target-dev-hub sflabs` explicitly so they do not depend on local CLI defaults.

```bash
sf org display --target-org sflabs
sf package list --target-dev-hub sflabs
```

### Create the package

```bash
sf package create \
  --name "Agentforce Record Insights" \
  --package-type Managed \
  --path force-app \
  --target-dev-hub sflabs
```

After package creation, copy the returned `0Ho...` package ID into `sfdx-project.json` as both `packageAliases["Agentforce Record Insights"]` and `packageAliases.agentforce_record_insights_managed`.

### Create a package version

Run LWC unit tests before packaging:

```bash
npm run test:unit
```

Create the version:

```bash
sf package version create \
  --package agentforce_record_insights_managed \
  --definition-file config/project-package-def.json \
  --code-coverage \
  --installation-key-bypass \
  --version-name "ver 1.0" \
  --version-number 1.0.0.NEXT \
  --branch feature/2gp-managed-packaging \
  --wait 120 \
  --language en_US \
  --target-dev-hub sflabs \
  --verbose
```

After version creation, copy the returned `04t...` version ID into `sfdx-project.json` as the next `Agentforce Record Insights@<major>.<minor>.<patch>-<build>` alias.

This package starts with `1.0.0.1` in `sflabs`. After promoting and releasing the first version, add `ancestorVersion: HIGHEST` back for later managed upgrades. Because patch versioning is not enabled for this namespace, use a new major or minor line such as `1.1.0.NEXT` for future updates unless patch versioning is enabled through Salesforce Partner Support.

### Create a clean validation scratch org

```bash
sf org create scratch \
  --definition-file config/project-package-def.json \
  --edition developer \
  --alias ari-managed-install-qa \
  --target-dev-hub sflabs \
  --duration-days 7 \
  --wait 30 \
  --no-ancestors
```

The definition file includes the required AI runtime settings for package validation. It intentionally omits `edition` because this Dev Hub copies org shape during package version creation; pass `--edition developer` when creating a validation scratch org explicitly. Use `--no-ancestors` for install-validation orgs so Salesforce does not preseed the released managed package ancestor into the scratch org shape.

### Install and validate the package

```bash
sf package install \
  --package 04t... \
  --target-org ari-managed-install-qa \
  --security-type AdminsOnly \
  --wait 30 \
  --publish-wait 30 \
  --no-prompt

sf org assign permset \
  --name Agentforce_Record_Insights_User \
  --target-org ari-managed-install-qa
```

After install:

1. Open Lightning App Builder in the scratch org.
2. Add `agentforceRecordInsights` to a Record Page, App Page, or Home Page.
3. Smoke test insights mode and compare mode.

### Promote the validated version

Promote only after the install validation and manual smoke test pass.

```bash
sf package version promote \
  --package 04t... \
  --target-dev-hub sflabs \
  --no-prompt
```

### Notes

- This branch targets a standard 2GP managed package, not unlocked packaging.
- The current source does not include a demo flexipage.
- Package consumers still need Salesforce Models API access, available model aliases, and permission set assignment in the subscriber org.
- The current `sflabs` package lineage starts at `1.0.0.1` (`04tao000004qWCnAAM`).

## Files

```text
force-app/main/default/
├── classes/
│   ├── RecordContextService.cls          — Context engine
│   ├── RecordAdvisorController.cls       — Chat controller
│   ├── RecordCompareService.cls          — Comparison service
│   ├── RecordSchemaUtils.cls             — Schema utilities
│   ├── RecordContextService_Test.cls     — Tests
│   ├── RecordAdvisorController_Test.cls  — Tests
│   ├── RecordCompareService_Test.cls     — Tests
│   ├── RecordContextService_Case_Test.cls — Tests
│   └── RecordSchemaUtils_Test.cls        — Tests
├── lwc/
│   ├── agentforceRecordInsights/         — Main component
│   ├── contextPanel/                     — Context sidebar
│   ├── chatPanel/                        — Chat interface
│   ├── insightsFieldSelector/            — Field selection modal
│   ├── recordCompare/                    — Comparison mode
│   └── recordPicker/                     — Shared object/record picker
├── permissionsets/
│   └── Agentforce_Record_Insights_User.permissionset-meta.xml
└── staticresources/
    └── Agentforce_Icon.svg
```

## Runtime Requirements

- Salesforce org with Salesforce Models API enabled (Einstein AI / Agentforce capability)
- At least one configured Salesforce model alias available in the org
- Users assigned the `Agentforce Record Insights User` permission set
- User-level access to the objects, fields, and records they want to analyze
- API version `66.0+`

## Packaging Notes

- The source is structured for DX and this branch is intended for a 2GP managed package from the `force-app` directory.
- The managed package namespace is `sfpalabs` and the packaging Dev Hub alias is `sflabs`.
- Package consumers still need runtime prerequisites in the subscriber org: Salesforce Models API access, available model aliases, and permission set assignment.
- The current source no longer includes a demo flexipage. Installers should add the component to pages manually.
- The package version scratch-org shape is defined in `config/project-package-def.json`.
