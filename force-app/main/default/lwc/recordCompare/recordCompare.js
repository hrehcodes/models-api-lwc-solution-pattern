import { LightningElement, api, track } from 'lwc';
import getComparisonContext from '@salesforce/apex/RecordCompareService.getComparisonContext';
import searchRecords from '@salesforce/apex/RecordCompareService.searchRecords';
import getSuggestedRecords from '@salesforce/apex/RecordCompareService.getSuggestedRecords';
import getAvailableCompareObjects from '@salesforce/apex/RecordCompareService.getAvailableCompareObjects';
import getAvailableContextForObject from '@salesforce/apex/RecordContextService.getAvailableContextForObject';

const OBJECT_ICON_MAP = {
    Account: 'standard:account',
    Opportunity: 'standard:opportunity',
    Contact: 'standard:contact',
    Case: 'standard:case',
    Lead: 'standard:lead'
};

export default class RecordCompare extends LightningElement {
    @api recordId;
    @api objectApiName;
    @api storageKey;
    @api showModelPicker;
    @api defaultModelApiName;
    @api showSuggestedPrompts;
    @api showUsageMetrics;
    @api persistConversation;
    @api showSuggestedComparisonRecords;
    @api enableSuggestedFollowUps;
    @api defaultDepth = 1;
    @api maxDepthAllowed = 3;
    @api defaultFieldCategoriesCsv;
    @api defaultRelationshipsCsv;
    @api hideContextWarnings;
    @api promptWarningThresholdTokens = 20000;

    selectedObjectType = '';
    @track selectedRecords = [];
    searchTerm = '';
    @track searchResults = [];
    comparisonContextJson;
    comparisonLoaded = false;
    isLoadingComparison = false;
    compareError;
    selectionCollapsed = false;

    @track suggestedRecords = [];
    isLoadingSuggestions = false;
    suggestionsLoaded = false;
    @track objectTypeOptions = [];
    objectTypeFilter = '';
    isLoadingObjectTypes = false;
    objectTypeError;
    availableContext;
    includedCategories = [];
    includedRelationships = [];
    currentDepth = 1;
    isLoadingCompareContext = false;
    showFieldSelector = false;
    contextStatus;
    contextWarningSummary;
    @track contextWarningMessages = [];
    availableContextWarnings = [];
    comparisonContextWarnings = [];

    _sessionTokens = 0;
    _sessionCredits = 0;
    _loadedContextObjectType;
    _loadedContextReferenceRecordId;

    _searchTimeout;

    connectedCallback() {
        this.currentDepth = this.normalizeDepth(this.defaultDepth);
        if (this.objectApiName) {
            this.selectedObjectType = this.objectApiName;
            this.loadCompareContextMetadata({ resetSelections: true });
        } else {
            this.loadAvailableObjectTypes();
        }
        if (this.recordId && this.objectApiName) {
            this.selectedRecords = [{
                id: this.recordId,
                name: 'Current Record'
            }];
            if (this.showSuggestedComparisonRecordsEnabled) {
                this.loadSuggestions();
            }
        }
    }

    // ── Getters ──

    get showObjectPicker() {
        return !this.objectApiName;
    }

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

    get canSearch() {
        return this.selectedObjectType && this.selectedRecords.length < 5;
    }

    get canCompare() {
        return this.selectedRecords.length >= 2 && !this.isLoadingComparison && !this.isLoadingCompareContext;
    }

    get selectionCount() {
        return this.selectedRecords.length;
    }

    get searchPlaceholder() {
        return `Search ${this.selectedObjectType || 'records'}...`;
    }

    get activeObjectType() {
        return this.selectedObjectType || this.objectApiName;
    }

    get objectIconName() {
        return OBJECT_ICON_MAP[this.activeObjectType] || 'standard:custom_notification';
    }

    get objectFilterPlaceholder() {
        return 'Filter object types...';
    }

    get comparisonLabel() {
        return `Comparing ${this.selectedRecords.length} ${this.activeObjectType} records`;
    }

    get showSuggestions() {
        return this.showSuggestedComparisonRecordsEnabled && this.recordId && this.selectedRecords.length < 5;
    }

    get showUsageMetricsEnabled() {
        return this.isBooleanEnabled(this.showUsageMetrics);
    }

    get showSuggestedComparisonRecordsEnabled() {
        return this.isBooleanEnabled(this.showSuggestedComparisonRecords);
    }

    get hasSuggestions() {
        return !this.isLoadingSuggestions && this.suggestedRecords.length > 0;
    }

    get noSuggestions() {
        return !this.isLoadingSuggestions && this.suggestionsLoaded && this.suggestedRecords.length === 0;
    }

    get selectionExpanded() {
        return !this.selectionCollapsed;
    }

    get collapseChevronIcon() {
        return this.selectionCollapsed ? 'utility:chevronright' : 'utility:chevrondown';
    }

    get displaySessionTokens() {
        return this._sessionTokens.toLocaleString();
    }

    get displaySessionCredits() {
        return this._sessionCredits.toLocaleString();
    }

    get showCompareContextSettings() {
        return Boolean(this.activeObjectType);
    }

    get showCompareContextPanel() {
        return this.showCompareContextSettings && this.availableContext && !this.isLoadingCompareContext;
    }

    get showCompareContextError() {
        return this.showCompareContextSettings
            && !this.availableContext
            && !this.isLoadingCompareContext
            && this.contextStatus === 'failed';
    }

    get referenceRecordId() {
        if (this.recordId && this.objectApiName === this.activeObjectType) {
            return this.recordId;
        }
        return this.selectedRecords[0]?.id || null;
    }

    get compareContextTokenEstimate() {
        if (this.comparisonContextJson) {
            return Math.ceil(this.comparisonContextJson.length / 4);
        }

        if (!this.availableContext) {
            return null;
        }

        let perRecordEstimate = 0;
        const includedCategorySet = new Set(this.includedCategories);
        for (const category of this.availableContext.fieldCategories || []) {
            if (includedCategorySet.has(category.name)) {
                perRecordEstimate += (category.fieldCount || 0) * 15;
            }
        }

        const includedRelationshipSet = new Set(this.includedRelationships);
        for (const relationship of this.availableContext.relationships || []) {
            if (includedRelationshipSet.has(relationship.relationshipName) && relationship.recordCount > 0) {
                perRecordEstimate += relationship.recordCount * 100;
            }
        }

        const recordMultiplier = Math.max(this.selectedRecords.length, 1);
        return perRecordEstimate > 0 ? perRecordEstimate * recordMultiplier : null;
    }

    get normalizedPromptWarningThreshold() {
        const parsedThreshold = parseInt(this.promptWarningThresholdTokens, 10);
        if (Number.isNaN(parsedThreshold)) {
            return 20000;
        }
        return Math.max(parsedThreshold, 0);
    }

    async loadAvailableObjectTypes() {
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
            this.objectTypeError = error?.body?.message || error?.message || 'Failed to load object types.';
        } finally {
            this.isLoadingObjectTypes = false;
        }
    }

    async loadCompareContextMetadata({ resetSelections = false } = {}) {
        if (!this.activeObjectType) {
            this.availableContext = null;
            this.resetCompareWarningState();
            return;
        }

        this.isLoadingCompareContext = true;
        this.resetCompareWarningState();

        try {
            const referenceRecordId = this.referenceRecordId;
            const ctx = await getAvailableContextForObject({
                objectApiName: this.activeObjectType,
                referenceRecordId
            });

            this.availableContext = ctx;
            this.availableContextWarnings = this.extractCompletenessMessages(ctx.completeness);
            this._loadedContextObjectType = this.activeObjectType;
            this._loadedContextReferenceRecordId = referenceRecordId;

            if (resetSelections || this.includedCategories.length === 0) {
                this.includedCategories = this.resolveConfiguredSelections(
                    ctx.fieldCategories,
                    'name',
                    this.defaultFieldCategoriesCsv,
                    item => item.includedByDefault
                );
            }
            if (resetSelections || this.includedRelationships.length === 0) {
                this.includedRelationships = this.resolveConfiguredSelections(
                    ctx.relationships,
                    'relationshipName',
                    this.defaultRelationshipsCsv,
                    item => item.includedByDefault
                );
            }

            this.currentDepth = resetSelections
                ? this.normalizeDepth(this.defaultDepth)
                : this.normalizeDepth(this.currentDepth);

            this.updateCompareWarningState();
        } catch (error) {
            this.availableContext = null;
            this.setCompareContextFailureState(error);
        } finally {
            this.isLoadingCompareContext = false;
        }
    }

    refreshCompareContextMetadata(resetSelections = false) {
        const nextReferenceRecordId = this.referenceRecordId;
        if (
            resetSelections
            || !this.availableContext
            || this._loadedContextObjectType !== this.activeObjectType
            || this._loadedContextReferenceRecordId !== nextReferenceRecordId
        ) {
            this.loadCompareContextMetadata({ resetSelections });
        }
    }

    // ── Suggestions ──

    async loadSuggestions() {
        if (!this.recordId) return;
        this.isLoadingSuggestions = true;
        try {
            const results = await getSuggestedRecords({
                recordId: this.recordId,
                maxResults: 8
            });
            const selectedIds = new Set(this.selectedRecords.map(r => r.id));
            this.suggestedRecords = (results || []).filter(r => !selectedIds.has(r.id));
        } catch (error) {
            console.error('Error loading suggestions:', error);
            this.suggestedRecords = [];
        } finally {
            this.isLoadingSuggestions = false;
            this.suggestionsLoaded = true;
        }
    }

    handleAddSuggested(event) {
        const id = event.currentTarget.dataset.id;
        const name = event.currentTarget.dataset.name;
        if (!id || !name) return;
        if (this.selectedRecords.length >= 5) return;
        if (this.selectedRecords.some(r => r.id === id)) return;

        this.selectedRecords = [...this.selectedRecords, { id, name }];
        this.suggestedRecords = this.suggestedRecords.filter(r => r.id !== id);
        this.invalidateComparison();
        this.refreshCompareContextMetadata();
    }

    // ── Event Handlers ──

    handleObjectTypeChange(event) {
        this.selectedObjectType = event.detail.value;
        this.selectedRecords = [];
        this.searchResults = [];
        this.suggestedRecords = [];
        this.suggestionsLoaded = false;
        this.includedCategories = [];
        this.includedRelationships = [];
        this.invalidateComparison();
        this.loadCompareContextMetadata({ resetSelections: true });
    }

    handleObjectFilterChange(event) {
        this.objectTypeFilter = event.detail.value || '';
    }

    handleSearchChange(event) {
        this.searchTerm = event.detail.value;

        clearTimeout(this._searchTimeout);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._searchTimeout = setTimeout(() => {
            this.performSearch();
        }, 300);
    }

    async performSearch() {
        if (!this.activeObjectType) return;

        try {
            const results = await searchRecords({
                objectApiName: this.activeObjectType,
                searchTerm: this.searchTerm,
                maxResults: 10
            });

            const selectedIds = new Set(this.selectedRecords.map(r => r.id));
            this.searchResults = (results || []).filter(r => !selectedIds.has(r.id));
        } catch (error) {
            console.error('Search error:', error);
            this.searchResults = [];
        }
    }

    handleAddRecord(event) {
        const id = event.currentTarget.dataset.id;
        const name = event.currentTarget.dataset.name;

        if (this.selectedRecords.length >= 5) return;
        if (this.selectedRecords.some(r => r.id === id)) return;

        this.selectedRecords = [...this.selectedRecords, { id, name }];
        this.searchResults = this.searchResults.filter(r => r.id !== id);
        this.suggestedRecords = this.suggestedRecords.filter(r => r.id !== id);
        this.invalidateComparison();
        this.refreshCompareContextMetadata();
    }

    handleRemoveRecord(event) {
        const id = event.target.dataset.id;
        this.selectedRecords = this.selectedRecords.filter(r => r.id !== id);
        this.invalidateComparison();
        this.refreshCompareContextMetadata();
    }

    handleRemoveRecordCollapsed(event) {
        const id = event.target.dataset.id;
        this.selectedRecords = this.selectedRecords.filter(r => r.id !== id);
        this.invalidateComparison();
        this.refreshCompareContextMetadata();
        if (this.selectedRecords.length < 2) {
            this.selectionCollapsed = false;
        }
    }

    toggleSelectionCollapsed() {
        this.selectionCollapsed = !this.selectionCollapsed;
    }

    async handleLoadComparison() {
        if (this.selectedRecords.length < 2) return;

        this.isLoadingComparison = true;
        this.compareError = null;
        this.invalidateComparison();

        try {
            const recordIds = this.selectedRecords.map(r => r.id);
            const ctx = await getComparisonContext({
                recordIds,
                depth: this.currentDepth,
                includedCategories: this.includedCategories,
                includedRelationships: this.includedRelationships
            });

            this.comparisonContextJson = JSON.stringify(ctx);
            this.comparisonLoaded = true;
            this.selectionCollapsed = true;
            this.updateCompareWarningState(ctx.completeness);

            if (ctx.records) {
                const nameMap = {};
                for (const rec of ctx.records) {
                    nameMap[rec.recordId] = rec.recordName;
                }
                this.selectedRecords = this.selectedRecords.map(r => ({
                    ...r,
                    name: nameMap[r.id] || r.name
                }));
            }
        } catch (error) {
            this.compareError = error?.body?.message || error?.message || 'Failed to load comparison.';
            this.setCompareContextFailureState(error);
        } finally {
            this.isLoadingComparison = false;
        }
    }

    handleContextChange(event) {
        const { includedCategories, includedRelationships } = event.detail;
        if (includedCategories) {
            this.includedCategories = includedCategories;
        }
        if (includedRelationships) {
            this.includedRelationships = includedRelationships;
        }
        this.invalidateComparison();
        this.updateCompareWarningState();
    }

    handleDepthChange(event) {
        this.currentDepth = this.normalizeDepth(event.detail.depth);
        this.invalidateComparison();
        this.updateCompareWarningState();
    }

    handleOpenFieldSelector() {
        this.showFieldSelector = true;
    }

    handleCloseFieldSelector() {
        this.showFieldSelector = false;
    }

    handleCategoriesChange(event) {
        this.includedCategories = event.detail.includedCategories;
        this.showFieldSelector = false;
        this.invalidateComparison();
        this.updateCompareWarningState();
    }

    handleChatUsageUpdate(event) {
        this._sessionTokens = event.detail.sessionTokens;
        this._sessionCredits = event.detail.sessionCredits;
        this.dispatchEvent(new CustomEvent('usageupdate', {
            detail: event.detail
        }));
    }

    invalidateComparison() {
        this.comparisonLoaded = false;
        this.comparisonContextJson = null;
        this.compareError = null;
        this.comparisonContextWarnings = [];
    }

    resetCompareWarningState() {
        this.contextStatus = null;
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
        this.availableContextWarnings = [];
        this.comparisonContextWarnings = [];
    }

    updateCompareWarningState(completeness) {
        this.comparisonContextWarnings = this.extractCompletenessMessages(completeness);
        const combinedWarnings = this.combineWarnings(
            this.availableContextWarnings,
            this.comparisonContextWarnings
        );

        if (combinedWarnings.length > 0) {
            this.contextStatus = 'partial';
            this.contextWarningSummary = 'Some compared record context was skipped or truncated. AI responses may be incomplete.';
            this.contextWarningMessages = combinedWarnings;
            return;
        }

        this.contextStatus = 'ready';
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
    }

    setCompareContextFailureState(error) {
        this.contextStatus = 'failed';
        this.contextWarningSummary = 'Comparison context could not be loaded. Responses may be ungrounded until the comparison loads successfully.';
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

        return matches.length
            ? [...new Set(matches)]
            : items.filter(fallbackPredicate).map(item => item[keyField]);
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
