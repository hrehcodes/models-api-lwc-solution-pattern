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
- Node.js and npm installed for local LWC tests
- Authenticated Salesforce org with Salesforce Models API enabled
- At least one supported Salesforce model alias available in the target org
- API version `66.0+`

### Authenticate to an org

```bash
# Login to a sandbox or production org
sf org login web --alias my-org

# Or use an existing default org
sf org display
```

### Deploy the project

```bash
# Deploy to your default org (--source-dir can be omitted when using the default package directory)
sf project deploy start --source-dir force-app

# Deploy to a specific org
sf project deploy start --source-dir force-app --target-org my-org

# Validate deployment (dry run) without writing to the org
sf project deploy start --source-dir force-app --dry-run

# Deploy with test execution (required for production)
sf project deploy start --source-dir force-app --test-level RunLocalTests
```

### Post-deployment

1. Assign the `Agentforce Record Insights User` permission set to users who need access to the component's Apex services.
2. Add the `agentforceRecordInsights` component to a Record Page, App Page, or Home Page, or assign the packaged **Agentforce Record Insights Demo** flexipage to an app.
3. Confirm that the target org has Salesforce Models API access and at least one of the configured model aliases available.

The permission set grants Apex class access only. Object access, field-level security, and sharing remain controlled by the user's existing Salesforce permissions.

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
├── staticresources/
│   └── Agentforce_Icon.svg
└── flexipages/
    └── Agentforce_Record_Insights_Demo.flexipage-meta.xml
```

## Runtime Requirements

- Salesforce org with Salesforce Models API enabled (Einstein AI / Agentforce capability)
- At least one configured Salesforce model alias available in the org
- Users assigned the `Agentforce Record Insights User` permission set
- User-level access to the objects, fields, and records they want to analyze
- API version `66.0+`

## Packaging Notes

- The source is structured for DX and can be packaged as a 2GP unlocked package from the `force-app` directory.
- Package consumers still need runtime prerequisites in the subscriber org: Salesforce Models API access, available model aliases, and permission set assignment.
- The demo flexipage is optional but safe to keep in the package as a ready-made sample page.
