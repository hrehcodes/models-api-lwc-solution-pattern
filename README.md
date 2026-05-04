# Agentforce Record Insights

AI-powered conversational insights grounded in live Salesforce record data. Uses the Salesforce Models API to provide multi-turn chat about supported Salesforce records with dynamic field discovery, relationship traversal, and cross-record comparison.

## What It Does

**Drop it on any record page** and it automatically discovers the available fields and relationships for that object. Users can chat with the AI about their CRM data, toggle which context to include, and compare multiple records side by side.

**Key Capabilities:**
- **Zero-config context discovery** — Insights mode works broadly across standard and custom objects using Schema Describe APIs
- **Dynamic relationship traversal** — Uses `getChildRelationships()` to discover related records automatically
- **User-controlled context** — Toggle field categories, related objects, and traversal depth (1, 2, or 3 levels)
- **Parent and sibling context (one hop)** — Optionally include selected parent lookup records, their same-object siblings through those parents, and one user-picked child relationship per parent. Scope is strictly one hop; the AI never chains further
- **Cross-record comparison** — Compare 2-5 records of the same supported type with AI-powered analysis
- **Multi-turn conversation** — Persistent chat with localStorage, markdown rendering, suggested prompts
- **Permission-aware** — Enforces FLS, CRUD, and sharing rules at every layer
- **Permission-scoped record picking** — App/Home insights and compare mode use searchable record selection instead of raw-ID-first entry
- **Admin-configurable model catalog** — Uses subscriber-controlled custom metadata to decide which Models API aliases appear in the end-user picker, with App Builder controlling the page default

## How It Differs from Einstein Summary

| Capability | Einstein Summary | Record Insights |
|---|---|---|
| File analysis | Core strength | Not included (intentional) |
| Record field context | No | Yes — dynamic field discovery |
| Relationship traversal | No | Yes — walks the data graph |
| Cross-record comparison | No | Yes — compare 2-5 records |
| Multi-turn conversation | No | Yes — persistent chat |
| Works on any object | Per Prompt Template | Broad insights support; compare uses a safe supported-object subset |

## Updates

### UI/UX Refresh

The refreshed experience improves trust and readability with cleaner answer formatting, collapsible source disclosures, context-size visibility, model controls, and a more polished comparison workflow. Special thanks to [Dylan Anderson](https://github.com/dylandersen) for the inspiration behind the UI/UX refresh. Check out Dylan's [Agentforce Workspace](https://github.com/dylandersen/agentforce-workspace) repo to explore more of his incredible solutions and innovations.

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
2. Assign the `Agentforce Record Insights Admin` permission set to admins who will maintain the model catalog custom metadata.
3. Review or update the `Record Insights Model Alias` custom metadata records so at least one enabled model alias is available for the intended model set.
4. Add the `agentforceRecordInsights` component to a Record Page, App Page, or Home Page in Lightning App Builder.
5. Configure `Model Set` and `Default Model API Name` in Lightning App Builder when the page should expose a specific model set or preselect a specific model.
6. Confirm that the target org has Salesforce Models API access and at least one of the configured model aliases available.

The user permission set grants Apex class access only. Object access, field-level security, and sharing remain controlled by the user's existing Salesforce permissions. The admin permission set grants access to the model catalog metadata and the dynamic App Builder model-set picklist provider.

### Recommended deploy flow

```bash
# 1. Deploy the metadata
sf project deploy start --source-dir force-app --target-org my-org

# 2. Assign the packaged user permission set to the default org user
sf org assign permset --name Agentforce_Record_Insights_User --target-org my-org

# 3. Assign the admin permission set to catalog maintainers
sf org assign permset --name Agentforce_Record_Insights_Admin --target-org my-org

# 4. Optionally run Apex tests after deployment
sf apex run test --target-org my-org --test-level RunLocalTests
```

### Add the component in Lightning App Builder

After deployment:

1. Open Lightning App Builder.
2. Edit the target Record Page, App Page, or Home Page.
3. Drag **Agentforce Record Insights** onto the page.
4. Configure the builder properties you want, such as default mode, model set, default model API name, preload compare mode, and usage visibility.
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
- **Model availability** is curated through the `Record Insights Model Alias` custom metadata type. Enabled records in the selected `Model Set` appear in the end-user picker. If no enabled records exist for the selected set, the component falls back to the packaged Apex catalog.
- **Default model selection** is controlled by the Lightning App Builder `Default Model API Name` property. Custom metadata controls availability only; it does not mark a default model. If the configured default is blank or not available in the selected model set, the picker selects the first available model.

### Admin-Configurable Model Catalog

Admins maintain available models with `Record Insights Model Alias` custom metadata records. The packaged seed records cover the supported Models API aliases, and subscribers can enable, disable, relabel, reorder, or add records without changing Apex.

Key fields:

- `Model API Name`: The Salesforce Models API alias sent to the Models API, such as `sfdc_ai__DefaultVertexAIGeminiPro31`.
- `Display Label`: The label shown in the end-user picker.
- `Provider`: Optional provider text shown beside the label.
- `Credit Type`: `basic`, `standard`, or `advanced`; used for client-side flex-credit estimates.
- `Enabled`: Controls whether the model appears in the picker.
- `Model Set`: Groups records for page-specific catalogs. Blank values are treated as `Default`.
- `Sort Order`: Controls picker ordering before label ordering.

Model sets let admins maintain different catalogs for different pages. For example, a sales page can use the `Default` set while an executive page uses an `Executive` set with fewer enabled models. Lightning App Builder reads available model set names through `RecordInsightsModelSetPicklist`.

Default behavior is intentionally split from availability. To change the preselected model, edit the page in Lightning App Builder and set `Default Model API Name` to an enabled model in the selected model set. To remove a model from the picker, disable its custom metadata record or move it to another model set.

## Builder Settings to Know

- `Preload Compare Mode`: Defaults to `true` on record pages. Starts compare setup in the background so support checks and search are ready sooner when the user opens Compare.
- `Model Set`: Selects which `Record Insights Model Alias` records populate the model picker. Defaults to `Default`.
- `Default Model API Name`: Preselects a model when that API name is enabled in the selected model set. Defaults to Gemini 3.1 Pro. Leave blank to select the first available model.
- `Large Prompt Warning Threshold (Tokens)`: Defaults to `20000`. Warns before large prompts and limits compare payload size unless set to `0`.
- `Maximum Compare Records`: Caps compare selection between `2` and `5` records.
- `Related Records Per Relationship`: Controls how many child records are loaded per selected relationship and directly affects prompt size, response latency, and flex-credit use.
- `Default Parent Records (CSV)`: Optional comma-separated lookup field API names to preselect as parent records in insights and compare mode. One hop only. Example for a custom Order: `AccountId,ContactId,TreatmentSite__c`.
- `Preload Same-Object Siblings Through Parents`: When a parent record is included, also loads other records of the same object type under that parent (excluding the active record). Increases prompt size; keep off unless sibling comparisons are core to the use case.
- `Maximum Parent Records Selected`: Caps how many parent lookup records a user can include at once (1–10). Lower this to keep prompts small and focused.
- `Field Selection Mode`: `categories` (default) includes whole field categories. `fields` switches to a curated per-field override. In `fields` mode only the explicitly selected fields are queried, which typically cuts prompt tokens for wide objects.
- `Default Included Fields (CSV)`: Only honored when `Field Selection Mode` is `fields`. Comma-separated field API names to preselect. The server intersects the list with the user's field-level security and the currently included categories, and drops any field that is unknown or not accessible. Example: `Name,StageName,Amount,CloseDate`.
- `Enable Suggested Follow-Ups`: Adds an extra AI call after each response.
- `Persist Conversation`: Stores chat history and usage metrics in browser `localStorage` only.

### Per-Field Override and Security

The per-field override is an opt-in token-saving mode, not a security bypass. Every request is re-validated server-side against the same categorized, describe-filtered field list (which already enforces `isAccessible` and excludes unsafe field types). Unknown, out-of-category, or inaccessible fields are silently dropped and surfaced as completeness warnings instead of being echoed back in the payload. `Id` and the object's name field are always preserved, and the global `MAX_FIELDS_PER_QUERY` limit continues to apply.

Typical token savings: on a 120-field custom object, narrowing to the 5 fields a prompt actually needs reduces the record payload from roughly 1,800 tokens to around 75 tokens per record, before related-record and parent expansions.

### Parent and Sibling Context Scope

Parent and sibling expansions are strictly **one hop**:

- Parent records are the direct single-target lookups on the active record. Polymorphic lookups (for example, Task `WhatId`/`WhoId`) are skipped and surfaced as a warning.
- Same-object siblings are other records of the active record's type that share the selected parent, excluding the active record itself.
- For each selected parent, users can optionally include **one** child relationship of that parent to expand additional context.

The AI is instructed to reason only over the provided data and to avoid inventing relationships or values. Multi-hop traversal, workflow inference, and chained lookups are intentionally out of scope.

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

This source is structured for a namespaced 2GP managed package built from `force-app`.

### Current package state

- Packaging Dev Hub alias: `sflabs`
- Namespace: `sfpalabs`
- Package alias: `Agentforce Record Insights` -> `0Hoao0000003KBtCAM`
- Latest created version: `Agentforce Record Insights@2.0.0-1` -> `04tao000005PnCLAA0`
- Current package version config in `sfdx-project.json`: `versionName: ver 2.0`, `versionNumber: 2.0.0.NEXT`, `ancestorVersion: 1.3.0.1`

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
  --version-name "ver 2.0" \
  --version-number 2.0.0.NEXT \
  --branch feature/2gp-managed-packaging \
  --wait 120 \
  --language en_US \
  --target-dev-hub sflabs \
  --verbose
```

After version creation, copy the returned `04t...` version ID into `sfdx-project.json` as the next `Agentforce Record Insights@<major>.<minor>.<patch>-<build>` alias.

This package starts with `1.0.0.1` in `sflabs`. Because patch versioning is not enabled for this namespace, use a new major or minor line such as `2.1.0.NEXT` for future updates unless patch versioning is enabled through Salesforce Partner Support.

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

sf org assign permset \
  --name Agentforce_Record_Insights_Admin \
  --target-org ari-managed-install-qa
```

After install:

1. Open Lightning App Builder in the scratch org.
2. Add `agentforceRecordInsights` to a Record Page, App Page, or Home Page.
3. Confirm `Model Set` and `Default Model API Name` are configurable.
4. Smoke test insights mode and compare mode.

### Promote the validated version

Promote only after the install validation and manual smoke test pass.

```bash
sf package version promote \
  --package 04t... \
  --target-dev-hub sflabs \
  --no-prompt
```

### Notes

- This source targets a standard 2GP managed package, not unlocked packaging.
- The current source does not include a demo flexipage.
- Package consumers still need Salesforce Models API access, available model aliases, and permission set assignment in the subscriber org.
- The current `sflabs` package lineage starts at `1.0.0.1` (`04tao000004qWCnAAM`).

## Files

```text
force-app/main/default/
├── classes/
│   ├── RecordContextService.cls             — Context engine
│   ├── RecordAdvisorController.cls          — Chat controller and model catalog loader
│   ├── RecordCompareService.cls             — Comparison service
│   ├── RecordSchemaUtils.cls                — Schema utilities
│   ├── RecordInsightsModelSetPicklist.cls   — Dynamic App Builder model-set picklist
│   ├── RecordContextService_Test.cls        — Tests
│   ├── RecordAdvisorController_Test.cls     — Tests
│   ├── RecordCompareService_Test.cls        — Tests
│   ├── RecordContextService_Case_Test.cls   — Tests
│   └── RecordSchemaUtils_Test.cls           — Tests
├── customMetadata/
│   └── Record_Insights_Model_Alias.*        — Packaged seed model catalog records
├── lwc/
│   ├── agentforceRecordInsights/         — Main component
│   ├── contextPanel/                     — Context sidebar
│   ├── chatPanel/                        — Chat interface
│   ├── insightsFieldSelector/            — Field selection modal
│   ├── recordCompare/                    — Comparison mode
│   └── recordPicker/                     — Shared object/record picker
├── permissionsets/
│   ├── Agentforce_Record_Insights_User.permissionset-meta.xml
│   └── Agentforce_Record_Insights_Admin.permissionset-meta.xml
├── objects/
│   └── Record_Insights_Model_Alias__mdt/    — Subscriber-configurable model catalog type
└── staticresources/
    └── Agentforce_Icon.svg
```

## Runtime Requirements

- Salesforce org with Salesforce Models API enabled (Einstein AI / Agentforce capability)
- At least one enabled `Record Insights Model Alias` record whose `Model API Name` is available in the org
- Users assigned the `Agentforce Record Insights User` permission set
- Admins who maintain model aliases assigned the `Agentforce Record Insights Admin` permission set
- User-level access to the objects, fields, and records they want to analyze
- API version `66.0+`

## Packaging Notes

- The source is structured for DX and is intended for a 2GP managed package from the `force-app` directory.
- The managed package namespace is `sfpalabs` and the packaging Dev Hub alias is `sflabs`.
- Package consumers still need runtime prerequisites in the subscriber org: Salesforce Models API access, enabled model catalog aliases, and permission set assignment.
- The current source no longer includes a demo flexipage. Installers should add the component to pages manually.
- The package version scratch-org shape is defined in `config/project-package-def.json`.
