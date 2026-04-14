import { LightningElement, api } from 'lwc';
import AGENTFORCE_ICON from '@salesforce/resourceUrl/Agentforce_Icon';
import getAvailableContext from '@salesforce/apex/RecordContextService.getAvailableContext';
import getRecordContext from '@salesforce/apex/RecordContextService.getRecordContext';
import getAvailableCompareObjects from '@salesforce/apex/RecordCompareService.getAvailableCompareObjects';
import searchRecords from '@salesforce/apex/RecordCompareService.searchRecords';

const MODE_INSIGHTS = 'insights';
const MODE_COMPARE = 'compare';
const AVAILABLE_MODES_BOTH = 'both';
const AVAILABLE_MODES_INSIGHTS_ONLY = 'insightsonly';
const AVAILABLE_MODES_COMPARE_ONLY = 'compareonly';
const LOADING_STEP_ROTATION_MS = 1400;

export default class AgentforceRecordInsights extends LightningElement {
    agentforceIcon = AGENTFORCE_ICON;

    @api recordId;
    @api objectApiName;
    @api cardTitle = 'Agentforce Record Insights';
    @api defaultDepth = 1;
    @api defaultMode = MODE_INSIGHTS;
    @api availableModes = AVAILABLE_MODES_BOTH;
    @api preloadCompareMode;
    @api startWithContextPanelOpen;
    @api maxDepthAllowed = 3;
    @api defaultFieldCategoriesCsv;
    @api defaultRelationshipsCsv;
    @api showModelPicker;
    @api defaultModelApiName;
    @api showSuggestedPrompts;
    @api showUsageMetrics;
    @api showInlineUsageStatus = false;
    @api persistConversation;
    @api showSuggestedComparisonRecords;
    @api enableSuggestedFollowUps;
    @api hideContextWarnings;
    @api promptWarningThresholdTokens = 20000;
    @api maxCompareRecords = 5;
    @api relatedRecordsPerRelationship = 10;

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
    recordContextWarnings = [];

    selectedObjectType = '';
    manualRecordId = '';
    activeRecordId;
    activeObjectApiName;
    activeRecordName;
    objectTypeOptions = [];
    objectTypeFilter = '';
    objectTypeError;
    searchTerm = '';
    searchResults = [];
    searchError;
    selectedInsightsRecords = [];
    isLoadingObjectTypes = false;
    contextLoadingPhase = 'discovering';
    _contextLoadTimeout;
    _searchTimeout;
    _resizeObserver;
    _didAttemptResizeObserverSetup = false;
    _insightsLoadingStepIndex = 0;
    _insightsLoadingInterval;
    _insightsLoadingSignature;
    headerWidth = 0;

    connectedCallback() {
        this.contextPanelOpen = this.isBooleanEnabled(this.startWithContextPanelOpen);
        this.mode = this.getInitialMode();
        this.currentDepth = this.normalizeDepth(this.defaultDepth);

        if (this.recordId) {
            this.activeRecordId = this.recordId;
            this.activeObjectApiName = this.objectApiName;
            this.loadAvailableContext();
        } else if (this.mode === MODE_INSIGHTS) {
            this.ensureInsightsPickerInitialized();
        }
    }

    renderedCallback() {
        if (!this._didAttemptResizeObserverSetup) {
            this.setupResizeObserver();
        }

        this.syncInsightsLoadingRotation();
    }

    disconnectedCallback() {
        clearTimeout(this._searchTimeout);
        clearTimeout(this._contextLoadTimeout);
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        this.stopInsightsLoadingRotation();
    }

    setupResizeObserver() {
        const headerElement = this.refs?.header;
        if (!headerElement) {
            return;
        }

        this._didAttemptResizeObserverSetup = true;

        const resizeObserverConstructor = this.getResizeObserverConstructor();
        if (!resizeObserverConstructor) {
            return;
        }

        try {
            this._resizeObserver = new resizeObserverConstructor(entries => {
                const width = entries?.[0]?.contentRect?.width;
                if (!width) {
                    return;
                }

                // Observe the actual header region, not the host, so compact mode follows usable space.
                this.headerWidth = width;
            });

            this._resizeObserver.observe(headerElement);
        } catch {
            this._resizeObserver = null;
        }
    }

    getResizeObserverConstructor() {
        if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'function') {
            return window.ResizeObserver;
        }

        if (typeof globalThis !== 'undefined' && typeof globalThis.ResizeObserver === 'function') {
            return globalThis.ResizeObserver;
        }

        return null;
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
    get preloadCompareModeEnabled() {
        return Boolean(this.recordId) && this.isBooleanEnabled(this.preloadCompareMode);
    }
    get shouldRenderCompareMode() {
        return this.allowsCompareMode && (this.isCompareMode || this.preloadCompareModeEnabled);
    }
    get compareContainerClass() {
        return this.isCompareMode
            ? 'mode-panel compare-panel'
            : 'mode-panel compare-panel compare-panel-hidden';
    }
    get showModelPickerEnabled() { return this.isBooleanEnabled(this.showModelPicker); }
    get showSuggestedPromptsEnabled() { return this.isBooleanEnabled(this.showSuggestedPrompts); }
    get showUsageMetricsEnabled() { return this.isBooleanEnabled(this.showUsageMetrics); }
    get showInlineUsageStatusEnabled() {
        return this.showInlineUsageStatus === true || this.showInlineUsageStatus === 'true';
    }
    get persistConversationEnabled() { return this.isBooleanEnabled(this.persistConversation); }
    get showSuggestedComparisonRecordsEnabled() { return this.isBooleanEnabled(this.showSuggestedComparisonRecords); }
    get enableSuggestedFollowUpsEnabled() { return this.isBooleanEnabled(this.enableSuggestedFollowUps); }
    get hideContextWarningsEnabled() {
        return this.hideContextWarnings === true || this.hideContextWarnings === 'true';
    }
    get normalizedPromptWarningThreshold() {
        const parsedThreshold = parseInt(this.promptWarningThresholdTokens, 10);
        if (Number.isNaN(parsedThreshold)) {
            return 20000;
        }
        return Math.max(parsedThreshold, 0);
    }
    get normalizedMaxCompareRecords() {
        const parsedValue = parseInt(this.maxCompareRecords, 10);
        if (Number.isNaN(parsedValue)) {
            return 5;
        }
        return Math.min(Math.max(parsedValue, 2), 5);
    }
    get normalizedRelatedRecordsPerRelationship() {
        const parsedValue = parseInt(this.relatedRecordsPerRelationship, 10);
        if (Number.isNaN(parsedValue)) {
            return 10;
        }
        return Math.min(Math.max(parsedValue, 1), 20);
    }

    get showSettingsButton() {
        return this.isInsightsMode && this.hasRecordContext;
    }

    get isStandaloneInsightsEntry() {
        return !this.recordId;
    }

    get showInsightsRecordPicker() {
        return this.isStandaloneInsightsEntry
            && this.isInsightsMode
            && !this.isLoadingContext
            && (!this.activeRecordId || Boolean(this.contextError));
    }

    get hasRecordContext() {
        return this.activeRecordId && this.availableContext && !this.isLoadingContext && !this.contextError;
    }

    get showFieldSelectorSafe() {
        return this.showFieldSelector && this.availableContext;
    }

    get loadRecordDisabled() { return !this.manualRecordId; }
    get filteredObjectTypeOptions() {
        const normalizedFilter = this.objectTypeFilter.trim().toLowerCase();
        let options = this.objectTypeOptions;

        if (normalizedFilter) {
            options = options.filter(option =>
                option.label.toLowerCase().includes(normalizedFilter)
                || option.value.toLowerCase().includes(normalizedFilter)
            );
        }

        const selectedOption = this.objectTypeOptions.find(option => option.value === this.selectedObjectType);
        if (selectedOption && !options.some(option => option.value === selectedOption.value)) {
            options = [selectedOption, ...options];
        }

        return options;
    }
    get noFilteredObjectOptions() {
        return !this.isLoadingObjectTypes
            && !this.objectTypeError
            && this.objectTypeOptions.length > 0
            && this.filteredObjectTypeOptions.length === 0;
    }
    get insightsCanSearch() {
        return Boolean(this.selectedObjectType) && !this.isLoadingContext;
    }
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

    get insightsLoadingTitle() {
        if (this.contextLoadingPhase === 'mapping') {
            return 'Mapping record context';
        }

        return 'Preparing grounded insights';
    }

    get insightsLoadingMessage() {
        if (this.contextLoadingPhase === 'mapping') {
            return 'Mapping fields and related records into grounded context for the chat experience.';
        }

        return 'Getting org metadata, discovering accessible relationships, and preparing the context panel.';
    }

    get insightsLoadingSteps() {
        if (this.contextLoadingPhase === 'mapping') {
            return [
                'Mapping selected fields',
                'Collecting related records',
                'Finalizing grounded context'
            ];
        }

        return [
            'Getting org metadata',
            'Discovering relationships',
            'Preparing context settings'
        ];
    }

    get activeInsightsLoadingStep() {
        if (!this.insightsLoadingSteps.length) {
            return null;
        }

        return this.insightsLoadingSteps[this._insightsLoadingStepIndex] || this.insightsLoadingSteps[0];
    }

    get insightsLoadingIndicators() {
        return this.insightsLoadingSteps.map((step, index) => ({
            id: `${index}-${step}`,
            className: index === this._insightsLoadingStepIndex
                ? 'insights-loading-dot insights-loading-dot-active'
                : 'insights-loading-dot'
        }));
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

    handleObjectTypeChange(event) {
        this.selectedObjectType = event.detail.value;
        this.searchTerm = '';
        this.searchResults = [];
        this.searchError = null;
        this.objectTypeError = null;
        this.manualRecordId = '';
        this.clearStandaloneInsightsSelection();
        this.performInsightsSearch();
    }
    handleManualRecordIdChange(event) { this.manualRecordId = event.detail.value; }

    handleLoadManualRecord() {
        if (this.manualRecordId) {
            this.selectedInsightsRecords = [{ id: this.manualRecordId, name: this.manualRecordId }];
            this.activeRecordId = this.manualRecordId;
            this.activeObjectApiName = null;
            this.loadAvailableContext();
        }
    }

    handleObjectFilterChange(event) {
        this.objectTypeFilter = event.detail.value || '';
    }

    handleSearchChange(event) {
        this.searchTerm = event.detail.value || '';

        clearTimeout(this._searchTimeout);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._searchTimeout = setTimeout(() => {
            this.performInsightsSearch();
        }, 300);
    }

    handleInsightsRecordSelect(event) {
        const { id, name } = event.detail;
        if (!id) {
            return;
        }

        this.searchError = null;
        this.contextError = null;
        this.selectedInsightsRecords = [{ id, name }];
        this.activeRecordId = id;
        this.activeObjectApiName = this.selectedObjectType || null;
        this.loadAvailableContext();
    }

    handleInsightsRecordRemove() {
        this.clearStandaloneInsightsSelection();
    }

    async loadAvailableContext() {
        this.isLoadingContext = true;
        this.contextLoadingPhase = 'discovering';
        this.contextError = null;
        this.availableContext = null;
        this.recordContextJson = null;
        this.resetContextWarningState();

        try {
            const ctx = await getAvailableContext({ recordId: this.activeRecordId });
            this.availableContext = ctx;
            this.activeObjectApiName = ctx.objectApiName;
            this.activeRecordName = ctx.recordName;
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

            this.contextLoadingPhase = 'mapping';
            await this.loadRecordContext();
        } catch (error) {
            this.contextError = this.extractErrorMessage(error);
        } finally {
            this.isLoadingContext = false;
            this.contextLoadingPhase = null;
        }
    }

    async loadRecordContext() {
        if (this.isLoadingContext) {
            this.contextLoadingPhase = 'mapping';
        }
        try {
            const ctx = await getRecordContext({
                recordId: this.activeRecordId,
                depth: this.currentDepth,
                includedCategories: this.includedCategories,
                includedRelationships: this.includedRelationships,
                maxRelatedRecords: this.normalizedRelatedRecordsPerRelationship
            });
            this.recordContextJson = JSON.stringify(this.serializeContextForChat(ctx));
            this.updateContextWarningState(ctx.completeness);
        } catch (error) {
            console.error('Error loading record context:', error);
            this.recordContextJson = null;
            this.setContextFailureState(error);
        }
    }

    syncInsightsLoadingRotation() {
        const steps = this.insightsLoadingSteps;
        const shouldRotate = this.isLoadingContext && steps.length > 1;
        const nextSignature = steps.join('|');

        if (!shouldRotate) {
            this.stopInsightsLoadingRotation();
            return;
        }

        if (this._insightsLoadingInterval && this._insightsLoadingSignature === nextSignature) {
            return;
        }

        this.stopInsightsLoadingRotation(false);
        this._insightsLoadingSignature = nextSignature;
        this._insightsLoadingStepIndex = 0;
        this._insightsLoadingInterval = setInterval(() => {
            this._insightsLoadingStepIndex = (this._insightsLoadingStepIndex + 1) % steps.length;
        }, LOADING_STEP_ROTATION_MS);
    }

    stopInsightsLoadingRotation(resetIndex = true) {
        if (this._insightsLoadingInterval) {
            clearInterval(this._insightsLoadingInterval);
            this._insightsLoadingInterval = null;
        }

        this._insightsLoadingSignature = null;
        if (resetIndex) {
            this._insightsLoadingStepIndex = 0;
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
        this.recordContextWarnings = [];
    }

    updateContextWarningState(completeness) {
        this.recordContextWarnings = this.extractCompletenessMessages(completeness);

        if (this.recordContextWarnings.length) {
            this.contextLoadStatus = 'partial';
            this.contextWarningSummary = 'Some record context was skipped or truncated. AI responses may be incomplete.';
            this.contextWarningMessages = [...this.recordContextWarnings];
            return;
        }

        this.contextLoadStatus = 'ready';
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
    }

    setContextFailureState(error) {
        this.contextLoadStatus = 'failed';
        this.contextWarningSummary = 'Record context could not be loaded. Responses may be ungrounded until context loads successfully.';
        this.contextWarningMessages = [this.extractErrorMessage(error)];
    }

    extractCompletenessMessages(completeness) {
        return Array.isArray(completeness?.warningMessages)
            ? completeness.warningMessages.filter(Boolean)
            : [];
    }

    serializeContextForChat(ctx) {
        if (!ctx) {
            return null;
        }

        const warningMessages = this.extractCompletenessMessages(ctx.completeness);

        return {
            selectionSummary: {
                mode: MODE_INSIGHTS,
                objectApiName: ctx.objectApiName,
                objectLabel: ctx.objectLabel,
                recordName: ctx.recordName,
                depth: this.currentDepth,
                selectedCategories: [...this.includedCategories],
                selectedRelationships: [...this.includedRelationships],
                contextStatus: warningMessages.length ? 'partial' : 'ready',
                warningSummary: warningMessages.length
                    ? 'Some record context was skipped or truncated. AI responses may be incomplete.'
                    : null,
                warningMessages
            },
            recordContext: ctx
        };
    }

    getInitialMode() {
        const fallbackMode = this.recordId ? MODE_INSIGHTS : MODE_COMPARE;
        return this.resolveAllowedMode(this.normalizeMode(this.defaultMode) || fallbackMode);
    }

    setMode(nextMode) {
        this.mode = this.resolveAllowedMode(this.normalizeMode(nextMode));
        if (this.mode === MODE_INSIGHTS && this.isStandaloneInsightsEntry) {
            this.ensureInsightsPickerInitialized();
        }
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

    async ensureInsightsPickerInitialized() {
        if (this.objectTypeOptions.length > 0 || this.isLoadingObjectTypes) {
            return;
        }

        await this.loadInsightsObjectTypes();
    }

    async loadInsightsObjectTypes() {
        this.isLoadingObjectTypes = true;
        this.objectTypeError = null;

        try {
            const options = await getAvailableCompareObjects();
            this.objectTypeOptions = (options || []).map(option => ({
                label: option.label,
                value: option.apiName
            }));
        } catch (error) {
            this.objectTypeOptions = [];
            this.objectTypeError = this.extractErrorMessage(error);
        } finally {
            this.isLoadingObjectTypes = false;
        }
    }

    async performInsightsSearch() {
        if (!this.selectedObjectType) {
            this.searchResults = [];
            return;
        }

        try {
            const results = await searchRecords({
                objectApiName: this.selectedObjectType,
                searchTerm: this.searchTerm,
                maxResults: 10
            });
            const selectedIds = new Set(this.selectedInsightsRecords.map(record => record.id));
            this.searchResults = (results || []).filter(record => !selectedIds.has(record.id));
            this.searchError = null;
        } catch (error) {
            this.searchResults = [];
            this.searchError = this.extractErrorMessage(error);
        }
    }

    clearStandaloneInsightsSelection() {
        if (this.recordId) {
            return;
        }

        this.selectedInsightsRecords = [];
        this.activeRecordId = null;
        this.activeObjectApiName = null;
        this.activeRecordName = null;
        this.availableContext = null;
        this.recordContextJson = null;
        this.contextError = null;
        this.resetContextWarningState();
    }

    extractErrorMessage(error) {
        if (typeof error === 'string') return error;
        if (error?.body?.message) return error.body.message;
        if (error?.message) return error.message;
        return 'An unexpected error occurred.';
    }
}
