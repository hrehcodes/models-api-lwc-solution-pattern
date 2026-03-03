# Agentforce Record Insights

AI-powered conversational insights grounded in live Salesforce record data. Uses the Salesforce Models API to provide multi-turn chat about any record — standard or custom — with dynamic field discovery, relationship traversal, and cross-record comparison.

## What It Does

**Drop it on any record page** and it automatically discovers the available fields and relationships for that object. Users can chat with the AI about their CRM data, toggle which context to include, and compare multiple records side by side.

**Key Capabilities:**
- **Zero-config context discovery** — Works on any standard or custom object using Schema Describe APIs
- **Dynamic relationship traversal** — Uses `getChildRelationships()` to discover related records automatically
- **User-controlled context** — Toggle field categories, related objects, and traversal depth (1, 2, or 3 levels)
- **Cross-record comparison** — Compare 2-5 records of the same type with AI-powered analysis
- **Multi-turn conversation** — Persistent chat with localStorage, markdown rendering, suggested prompts
- **Permission-aware** — Enforces FLS, CRUD, and sharing rules at every layer
- **Model selection** — Choose from available AI models with automatic fallback chain

## How It Differs from Einstein Summary

| Capability | Einstein Summary | Record Insights |
|---|---|---|
| File analysis | Core strength | Not included (intentional) |
| Record field context | No | Yes — dynamic field discovery |
| Relationship traversal | No | Yes — walks the data graph |
| Cross-record comparison | No | Yes — compare 2-5 records |
| Multi-turn conversation | No | Yes — persistent chat |
| Works on any object | Per Prompt Template | Zero config |

## Architecture

```
LWC Layer:
  agentforceRecordInsights (orchestrator)
    ├── contextPanel (field/relationship toggles, depth, token estimate)
    ├── chatPanel (multi-turn chat, markdown, suggested prompts)
    ├── insightsFieldSelector (category selection modal)
    └── recordCompare (multi-record picker + comparison chat)

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

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (sf) installed
- Authenticated Salesforce org with Models API enabled (see Prerequisites below)

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

1. Assign the **Agentforce Record Insights Demo** flexipage (App Home page for comparison mode) to an app via Lightning App Builder.
2. Or manually add the `agentforceRecordInsights` component to any record page, App Page, or Home Page.

## Usage

1. **Record Page:** Add the "Agentforce Record Insights" component to any record page via Lightning App Builder. It auto-detects the record and object type.

2. **App Page:** Add to a Lightning App Page for cross-record comparison mode. Users select an object type and pick records to compare.

3. **Home Page:** Add to a Lightning Home Page for insights or comparison on the home tab.

## Files

```
force-app/main/default/
├── classes/
│   ├── RecordContextService.cls          — Context engine
│   ├── RecordAdvisorController.cls       — Chat controller
│   ├── RecordCompareService.cls          — Comparison service
│   ├── RecordSchemaUtils.cls             — Schema utilities
│   ├── RecordContextService_Test.cls     — Tests
│   ├── RecordAdvisorController_Test.cls  — Tests
│   ├── RecordCompareService_Test.cls     — Tests
│   └── RecordSchemaUtils_Test.cls        — Tests
├── lwc/
│   ├── agentforceRecordInsights/         — Main component
│   ├── contextPanel/                     — Context sidebar
│   ├── chatPanel/                        — Chat interface
│   ├── insightsFieldSelector/            — Field selection modal
│   └── recordCompare/                    — Comparison mode
└── flexipages/
    └── Agentforce_Record_Insights_Demo.flexipage-meta.xml
```

## Prerequisites

- Salesforce org with Models API enabled (Einstein AI / Agentforce license)
- At least one AI model configured (Gemini, GPT, Claude)
- API version 66.0+
