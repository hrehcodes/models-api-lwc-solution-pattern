import { LightningElement, api } from 'lwc';
import AGENTFORCE_ICON from '@salesforce/resourceUrl/Agentforce_Icon';
import getAvailableContext from '@salesforce/apex/RecordContextService.getAvailableContext';
import getRecordContext from '@salesforce/apex/RecordContextService.getRecordContext';

const MODE_INSIGHTS = 'insights';
const MODE_COMPARE = 'compare';
const AVAILABLE_MODES_BOTH = 'both';
const AVAILABLE_MODES_INSIGHTS_ONLY = 'insightsonly';
const AVAILABLE_MODES_COMPARE_ONLY = 'compareonly';

export default class AgentforceRecordInsights extends LightningElement {
    agentforceIcon = AGENTFORCE_ICON;

    @api recordId;
    @api objectApiName;
    @api cardTitle = 'Agentforce Record Insights';
    @api defaultDepth = 1;
    @api defaultMode = MODE_INSIGHTS;
    @api availableModes = AVAILABLE_MODES_BOTH;
    @api startWithContextPanelOpen;
    @api maxDepthAllowed = 3;
    @api defaultFieldCategoriesCsv;
    @api defaultRelationshipsCsv;
    @api showModelPicker;
    @api defaultModelApiName;
    @api showSuggestedPrompts;
    @api showUsageMetrics;
    @api persistConversation;
    @api showSuggestedComparisonRecords;
    @api enableSuggestedFollowUps;
    @api hideContextWarnings;

    mode = MODE_INSIGHTS;
    contextPanelOpen = true;
    availableContext;
    recordContextJson;
    includedCategories = [];
    includedRelationships = [];
    currentDepth = 1;
    isLoadingContext = false;
    contextError;
    showFieldSelector = false;
    sessionTokens = 0;
    sessionCredits = 0;
    contextLoadStatus;
    contextWarningSummary;
    contextWarningMessages = [];
    availableContextWarnings = [];
    recordContextWarnings = [];

    selectedObjectType = '';
    manualRecordId = '';
    activeRecordId;
    activeObjectApiName;
    activeRecordName;

    _contextLoadTimeout;
    _resizeObserver;
    headerWidth = 0;

    objectTypeOptions = [
        { label: 'Account', value: 'Account' },
        { label: 'Opportunity', value: 'Opportunity' },
        { label: 'Contact', value: 'Contact' },
        { label: 'Case', value: 'Case' },
        { label: 'Lead', value: 'Lead' },
        { label: 'Custom Object (enter ID)', value: 'custom' }
    ];

    connectedCallback() {
        this.contextPanelOpen = this.isBooleanEnabled(this.startWithContextPanelOpen);
        this.mode = this.getInitialMode();
        this.currentDepth = this.normalizeDepth(this.defaultDepth);

        if (this.recordId) {
            this.activeRecordId = this.recordId;
            this.activeObjectApiName = this.objectApiName;
            this.loadAvailableContext();
        }
    }

    renderedCallback() {
        if (this._resizeObserver) {
            return;
        }

        const headerElement = this.refs?.header;
        if (!headerElement) {
            return;
        }

        this._resizeObserver = new ResizeObserver(entries => {
            const width = entries?.[0]?.contentRect?.width;
            if (!width) {
                return;
            }

            // Observe the actual header region, not the host, so compact mode follows usable space.
            this.headerWidth = width;
        });

        this._resizeObserver.observe(headerElement);
    }

    disconnectedCallback() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    get isInsightsMode() { return this.mode === MODE_INSIGHTS; }
    get isCompareMode() { return this.mode === MODE_COMPARE; }
    get insightsButtonVariant() { return this.isInsightsMode ? 'brand' : 'neutral'; }
    get compareButtonVariant() { return this.isCompareMode ? 'brand' : 'neutral'; }
    get normalizedAvailableModes() {
        const normalized = this.normalizeToken(this.availableModes);
        if (normalized === AVAILABLE_MODES_INSIGHTS_ONLY || normalized === AVAILABLE_MODES_COMPARE_ONLY) {
            return normalized;
        }
        return AVAILABLE_MODES_BOTH;
    }
    get allowsInsightsMode() { return this.normalizedAvailableModes !== AVAILABLE_MODES_COMPARE_ONLY; }
    get allowsCompareMode() { return this.normalizedAvailableModes !== AVAILABLE_MODES_INSIGHTS_ONLY; }
    get showModeSwitcher() { return this.allowsInsightsMode && this.allowsCompareMode; }
    get showModelPickerEnabled() { return this.isBooleanEnabled(this.showModelPicker); }
    get showSuggestedPromptsEnabled() { return this.isBooleanEnabled(this.showSuggestedPrompts); }
    get showUsageMetricsEnabled() { return this.isBooleanEnabled(this.showUsageMetrics); }
    get persistConversationEnabled() { return this.isBooleanEnabled(this.persistConversation); }
    get showSuggestedComparisonRecordsEnabled() { return this.isBooleanEnabled(this.showSuggestedComparisonRecords); }
    get enableSuggestedFollowUpsEnabled() { return this.isBooleanEnabled(this.enableSuggestedFollowUps); }
    get hideContextWarningsEnabled() {
        return this.hideContextWarnings === true || this.hideContextWarnings === 'true';
    }

    get showSettingsButton() {
        return this.isInsightsMode && this.hasRecordContext;
    }

    get needsRecordSelection() {
        return !this.activeRecordId && !this.isLoadingContext && !this.contextError;
    }

    get hasRecordContext() {
        return this.activeRecordId && this.availableContext && !this.isLoadingContext && !this.contextError;
    }

    get showFieldSelectorSafe() {
        return this.showFieldSelector && this.availableContext;
    }

    get loadRecordDisabled() { return !this.manualRecordId; }
    get contextToggleVariant() { return this.contextPanelOpen ? 'brand' : 'border'; }
    get useModeMenu() { return this.headerWidth > 0 && this.headerWidth < 940; }
    get useShortTitle() { return this.headerWidth > 0 && this.headerWidth < 760; }
    get isSmallHeader() { return this.headerWidth > 0 && this.headerWidth < 540; }
    get settingsButtonSize() { return this.useModeMenu ? 'small' : 'medium'; }
    get displayCardTitle() { return this.useShortTitle ? 'Record Insights' : this.cardTitle; }
    get customHeaderClass() {
        if (this.isSmallHeader) {
            return 'custom-header small';
        }

        if (this.useModeMenu) {
            return 'custom-header medium';
        }

        return 'custom-header';
    }
    get modeMenuLabel() { return this.isInsightsMode ? 'Insights' : 'Compare'; }
    get insightsMenuItemIcon() { return this.isInsightsMode ? 'utility:check' : null; }
    get compareMenuItemIcon() { return this.isCompareMode ? 'utility:check' : null; }

    get layoutClass() {
        return this.contextPanelOpen
            ? 'layout-with-context'
            : 'layout-chat-only';
    }

    get storageKey() {
        return this.activeRecordId ? `ari_chat_${this.activeRecordId}` : null;
    }

    get compareStorageKey() {
        return this.activeRecordId ? `ari_compare_${this.activeRecordId}` : 'ari_compare_app';
    }

    handleInsightsMode() { this.setMode(MODE_INSIGHTS); }
    handleCompareMode() { this.setMode(MODE_COMPARE); }
    handleToggleContext() { this.contextPanelOpen = !this.contextPanelOpen; }
    handleModeSelect(event) {
        this.setMode(event.detail.value);
    }

    handleObjectTypeChange(event) { this.selectedObjectType = event.detail.value; }
    handleManualRecordIdChange(event) { this.manualRecordId = event.detail.value; }

    handleLoadManualRecord() {
        if (this.manualRecordId) {
            this.activeRecordId = this.manualRecordId;
            this.activeObjectApiName = this.selectedObjectType === 'custom' ? null : this.selectedObjectType;
            this.loadAvailableContext();
        }
    }

    async loadAvailableContext() {
        this.isLoadingContext = true;
        this.contextError = null;
        this.availableContext = null;
        this.recordContextJson = null;
        this.resetContextWarningState();

        try {
            const ctx = await getAvailableContext({ recordId: this.activeRecordId });
            this.availableContext = ctx;
            this.activeObjectApiName = ctx.objectApiName;
            this.activeRecordName = ctx.recordName;
            this.availableContextWarnings = this.extractCompletenessMessages(ctx.completeness);
            this.includedCategories = this.resolveConfiguredSelections(
                ctx.fieldCategories,
                'name',
                this.defaultFieldCategoriesCsv,
                item => item.includedByDefault
            );
            this.includedRelationships = this.resolveConfiguredSelections(
                ctx.relationships,
                'relationshipName',
                this.defaultRelationshipsCsv,
                item => item.includedByDefault
            );
            this.currentDepth = this.normalizeDepth(this.currentDepth);

            await this.loadRecordContext();
        } catch (error) {
            this.contextError = this.extractErrorMessage(error);
        } finally {
            this.isLoadingContext = false;
        }
    }

    async loadRecordContext() {
        try {
            const ctx = await getRecordContext({
                recordId: this.activeRecordId,
                depth: this.currentDepth,
                includedCategories: this.includedCategories,
                includedRelationships: this.includedRelationships
            });
            this.recordContextJson = JSON.stringify(this.serializeContextForChat(ctx));
            this.updateContextWarningState(ctx.completeness);
        } catch (error) {
            console.error('Error loading record context:', error);
            this.recordContextJson = null;
            this.setContextFailureState(error);
        }
    }

    debouncedLoadRecordContext() {
        clearTimeout(this._contextLoadTimeout);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._contextLoadTimeout = setTimeout(() => {
            this.loadRecordContext();
        }, 300);
    }

    handleContextChange(event) {
        const { includedCategories, includedRelationships } = event.detail;
        if (includedCategories) this.includedCategories = includedCategories;
        if (includedRelationships) this.includedRelationships = includedRelationships;
        this.debouncedLoadRecordContext();
    }

    handleDepthChange(event) {
        this.currentDepth = this.normalizeDepth(event.detail.depth);
        this.debouncedLoadRecordContext();
    }

    handleOpenFieldSelector() { this.showFieldSelector = true; }
    handleCloseFieldSelector() { this.showFieldSelector = false; }

    handleCategoriesChange(event) {
        this.includedCategories = event.detail.includedCategories;
        this.showFieldSelector = false;
        this.debouncedLoadRecordContext();
    }

    handleUsageUpdate(event) {
        this.sessionTokens = event.detail.sessionTokens;
        this.sessionCredits = event.detail.sessionCredits;
    }

    resetContextWarningState() {
        this.contextLoadStatus = null;
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
        this.availableContextWarnings = [];
        this.recordContextWarnings = [];
    }

    updateContextWarningState(completeness) {
        this.recordContextWarnings = this.extractCompletenessMessages(completeness);
        const combinedWarnings = this.combineWarnings(
            this.availableContextWarnings,
            this.recordContextWarnings
        );

        if (combinedWarnings.length) {
            this.contextLoadStatus = 'partial';
            this.contextWarningSummary = 'Some record context was skipped or truncated. AI responses may be incomplete.';
            this.contextWarningMessages = combinedWarnings;
            return;
        }

        this.contextLoadStatus = 'ready';
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
    }

    setContextFailureState(error) {
        this.contextLoadStatus = 'failed';
        this.contextWarningSummary = 'Record context could not be loaded. Responses may be ungrounded until context loads successfully.';
        this.contextWarningMessages = this.combineWarnings(
            [this.extractErrorMessage(error)],
            this.availableContextWarnings
        );
    }

    extractCompletenessMessages(completeness) {
        return Array.isArray(completeness?.warningMessages)
            ? completeness.warningMessages.filter(Boolean)
            : [];
    }

    combineWarnings(...warningGroups) {
        return [...new Set([].concat(...warningGroups).filter(Boolean))];
    }

    serializeContextForChat(ctx) {
        if (!ctx) {
            return null;
        }

        const { completeness, ...chatContext } = ctx;
        return chatContext;
    }

    getInitialMode() {
        const fallbackMode = this.recordId ? MODE_INSIGHTS : MODE_COMPARE;
        return this.resolveAllowedMode(this.normalizeMode(this.defaultMode) || fallbackMode);
    }

    setMode(nextMode) {
        this.mode = this.resolveAllowedMode(this.normalizeMode(nextMode));
    }

    resolveAllowedMode(candidateMode) {
        if (!this.allowsInsightsMode) {
            return MODE_COMPARE;
        }
        if (!this.allowsCompareMode) {
            return MODE_INSIGHTS;
        }
        return candidateMode === MODE_COMPARE ? MODE_COMPARE : MODE_INSIGHTS;
    }

    normalizeDepth(value) {
        const parsedDepth = parseInt(value, 10);
        const safeDepth = Number.isNaN(parsedDepth) ? 1 : parsedDepth;
        return Math.min(Math.max(safeDepth, 1), this.normalizedMaxDepth);
    }

    get normalizedMaxDepth() {
        const parsedDepth = parseInt(this.maxDepthAllowed, 10);
        const safeDepth = Number.isNaN(parsedDepth) ? 3 : parsedDepth;
        return Math.min(Math.max(safeDepth, 1), 3);
    }

    resolveConfiguredSelections(items, keyField, csvValue, fallbackPredicate) {
        const configuredTokens = this.parseCsv(csvValue);
        if (!configuredTokens.length) {
            return items.filter(fallbackPredicate).map(item => item[keyField]);
        }

        const availableItems = new Map(
            items.map(item => [this.normalizeToken(item[keyField]), item[keyField]])
        );
        const matches = configuredTokens
            .map(token => availableItems.get(this.normalizeToken(token)))
            .filter(Boolean);

        return matches.length ? [...new Set(matches)] : items.filter(fallbackPredicate).map(item => item[keyField]);
    }

    parseCsv(value) {
        if (!value) {
            return [];
        }

        return String(value)
            .split(',')
            .map(token => token.trim())
            .filter(Boolean);
    }

    normalizeMode(value) {
        const normalized = this.normalizeToken(value);
        return normalized === MODE_COMPARE ? MODE_COMPARE : MODE_INSIGHTS;
    }

    normalizeToken(value) {
        return value ? String(value).trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
    }

    isBooleanEnabled(value) {
        return value !== false && value !== 'false';
    }

    extractErrorMessage(error) {
        if (typeof error === 'string') return error;
        if (error?.body?.message) return error.body.message;
        if (error?.message) return error.message;
        return 'An unexpected error occurred.';
    }
}
