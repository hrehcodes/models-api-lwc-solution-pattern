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
const LOADING_STEP_ROTATION_MS = 1400;

export default class RecordCompare extends LightningElement {
    @api recordId;
    @api objectApiName;
    @api storageKey;
    @api showModelPicker;
    @api defaultModelApiName;
    @api modelSetName = 'Default';
    @api showSuggestedPrompts;
    @api showUsageMetrics;
    @api showInlineUsageStatus = false;
    @api persistConversation;
    @api showSuggestedComparisonRecords;
    @api enableSuggestedFollowUps;
    @api defaultDepth = 1;
    @api maxDepthAllowed = 3;
    @api defaultFieldCategoriesCsv;
    @api defaultIncludedFieldsCsv;
    @api fieldSelectionMode = 'categories';
    @api defaultRelationshipsCsv;
    @api hideContextWarnings;
    @api promptWarningThresholdTokens = 20000;
    @api maxCompareRecords = 5;
    @api relatedRecordsPerRelationship = 10;
    @api defaultParentReferencesCsv;
    @api defaultSameObjectSiblingsEnabled;
    @api maxParentReferencesSelected = 5;

    selectedObjectType = '';
    @track selectedRecords = [];
    searchTerm = '';
    @track searchResults = [];
    searchError;
    comparisonContextJson;
    comparisonLoaded = false;
    isLoadingComparison = false;
    compareError;
    activeStep = 'records';

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
    includedFields = [];
    activeFieldSelectionMode = 'categories';
    includedParentReferenceFields = [];
    includeSameObjectSiblingsThroughParents = false;
    parentSiblingRelationshipByReferenceField = {};
    currentDepth = 1;
    isLoadingCompareContext = false;
    showFieldSelector = false;
    contextStatus;
    contextWarningSummary;
    @track contextWarningMessages = [];
    comparisonContextWarnings = [];

    _sessionTokens = 0;
    _sessionCredits = 0;
    _loadedContextObjectType;
    _loadedContextReferenceRecordId;
    _validatedCurrentObjectType;
    _isValidatingCurrentObjectType = false;
    _supportStatusStepIndex = 0;
    _supportStatusInterval;
    _supportStatusSignature;

    _searchTimeout;

    connectedCallback() {
        this.currentDepth = this.normalizeDepth(this.defaultDepth);
        if (this.objectApiName) {
            this.selectedObjectType = this.objectApiName;
        }
        this.loadAvailableObjectTypes();
        if (this.recordId && this.objectApiName) {
            this.selectedRecords = [{
                id: this.recordId,
                name: 'Current Record'
            }];
        }
    }

    renderedCallback() {
        this.syncSupportStatusRotation();
    }

    disconnectedCallback() {
        clearTimeout(this._searchTimeout);
        this.stopSupportStatusRotation();
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
        return !this.isObjectSupportPending
            && this.isActiveObjectTypeSupported
            && this.selectedRecords.length < this.normalizedMaxCompareRecords;
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

    get isActiveObjectTypeSupported() {
        return Boolean(this.activeObjectType)
            && (
                this.objectTypeOptions.some(option => option.value === this.activeObjectType)
                || this._validatedCurrentObjectType === this.activeObjectType
            );
    }

    get isObjectSupportPending() {
        return Boolean(this.activeObjectType)
            && !this.objectTypeError
            && !this.isActiveObjectTypeSupported
            && (this.isLoadingObjectTypes || this._isValidatingCurrentObjectType);
    }

    get showSupportStatus() {
        return this.isObjectSupportPending;
    }

    get supportStatusTitle() {
        if (this.recordId && this.objectApiName === this.activeObjectType) {
            return `Preparing compare for ${this.activeObjectType}`;
        }

        return 'Preparing compare mode';
    }

    get supportStatusMessage() {
        if (this.recordId && this.objectApiName === this.activeObjectType) {
            return `Getting org metadata, checking ${this.activeObjectType}, and mapping supported relationships before additional records can be selected.`;
        }

        return 'Getting org metadata, discovering compare-ready objects, and mapping supported relationships for this org.';
    }

    get supportStatusSteps() {
        if (this.recordId && this.objectApiName === this.activeObjectType) {
            return [
                'Getting org metadata',
                `Checking ${this.activeObjectType}`,
                'Mapping relationships'
            ];
        }

        return [
            'Getting org metadata',
            'Discovering compare-ready objects',
            'Mapping relationships'
        ];
    }

    get activeSupportStatusStep() {
        if (!this.supportStatusSteps.length) {
            return null;
        }

        return this.supportStatusSteps[this._supportStatusStepIndex] || this.supportStatusSteps[0];
    }

    get supportStatusIndicators() {
        return this.supportStatusSteps.map((step, index) => ({
            id: `${index}-${step}`,
            className: index === this._supportStatusStepIndex
                ? 'support-status-dot support-status-dot-active'
                : 'support-status-dot'
        }));
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
        return this.showSuggestedComparisonRecordsEnabled
            && this.recordId
            && !this.isObjectSupportPending
            && this.isActiveObjectTypeSupported
            && this.selectedRecords.length < this.normalizedMaxCompareRecords;
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

    get displaySessionTokens() {
        return this._sessionTokens.toLocaleString();
    }

    get displaySessionCredits() {
        return this._sessionCredits.toLocaleString();
    }

    get showCompareContextSettings() {
        return !this.isObjectSupportPending && this.isActiveObjectTypeSupported;
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

    get normalizedMaxParentReferencesSelected() {
        const parsedValue = parseInt(this.maxParentReferencesSelected, 10);
        if (Number.isNaN(parsedValue)) {
            return 5;
        }
        return Math.min(Math.max(parsedValue, 1), 10);
    }

    get hasReachedMaxCompareRecords() {
        return this.selectedRecords.length >= this.normalizedMaxCompareRecords;
    }

    get compareSelectionLimitLabel() {
        return `${this.selectionCount} of ${this.normalizedMaxCompareRecords}`;
    }

    get compareLimitMessage() {
        return `You have reached the configured compare limit of ${this.normalizedMaxCompareRecords} records. Remove a record to add another.`;
    }

    get hasMinimumSelectedRecords() {
        return this.selectedRecords.length >= 2;
    }

    get canAccessSettingsStep() {
        return !this.isObjectSupportPending
            && this.isActiveObjectTypeSupported
            && this.hasMinimumSelectedRecords;
    }

    get settingsStepDisabled() {
        return !this.canAccessSettingsStep;
    }

    get chatStepDisabled() {
        return !this.comparisonLoaded;
    }

    get showSettingsStepBody() {
        return this.activeStep === 'settings' && !this.settingsStepDisabled;
    }

    get showRecordsStepBody() {
        return this.activeStep === 'records' || !this.hasMinimumSelectedRecords;
    }

    get showChatStepBody() {
        return this.activeStep === 'chat';
    }

    get showChatPlaceholder() {
        return this.showChatStepBody && !this.comparisonLoaded;
    }

    get showSelectionActionBar() {
        return this.selectedRecords.length > 0
            || this.isObjectSupportPending
            || this.isLoadingComparison
            || Boolean(this.compareError);
    }

    get selectionActionTitle() {
        if (this.isObjectSupportPending) {
            return 'Checking object support';
        }

        if (this.activeObjectType && !this.isActiveObjectTypeSupported) {
            return 'Compare unavailable';
        }

        return 'Load Comparison';
    }

    get selectionActionMessage() {
        if (this.objectTypeError) {
            return this.objectTypeError;
        }

        if (this.isObjectSupportPending) {
            return this.supportStatusMessage;
        }

        if (this.activeObjectType && !this.isActiveObjectTypeSupported) {
            return `Compare mode is not supported for ${this.activeObjectType}.`;
        }

        if (this.isLoadingComparison) {
            return 'Loading the comparison and preparing the chat context.';
        }

        if (this.hasMinimumSelectedRecords) {
            return `Ready to compare ${this.selectedRecords.length} records. Load the comparison to shift focus to the chat.`;
        }

        if (this.selectedRecords.length === 1) {
            return 'Select 1 more record to enable comparison.';
        }

        return 'Select at least 2 records to enable comparison.';
    }

    get showSettingsReviewAction() {
        return this.canAccessSettingsStep && !this.isLoadingComparison;
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

    get compareContextSummary() {
        if (this.contextStatus === 'failed' && this.contextWarningSummary) {
            return this.contextWarningSummary;
        }

        if (!this.availableContext) {
            return 'Choose the fields, related records, and depth used for each compared record.';
        }

        const categoryCount = this.includedCategories.length;
        const relationshipCount = this.includedRelationships.length;
        const summaryParts = [
            `${categoryCount} field ${categoryCount === 1 ? 'group' : 'groups'}`,
            `${relationshipCount} ${relationshipCount === 1 ? 'relationship' : 'relationships'}`,
            `Depth ${this.currentDepth}`
        ];

        if (this.compareContextTokenEstimate) {
            summaryParts.push(`~${this.compareContextTokenEstimate.toLocaleString()} tokens`);
        }

        if (this.contextStatus === 'partial') {
            summaryParts.push('Warnings present');
        }

        return summaryParts.join(' • ');
    }

    get selectedRecordPreview() {
        const recordNames = this.selectedRecords
            .map(record => record.name)
            .filter(Boolean);

        if (!recordNames.length) {
            return 'No records selected yet.';
        }

        const visibleNames = recordNames.slice(0, 2).join(', ');
        const remainingCount = recordNames.length - 2;
        return remainingCount > 0
            ? `${visibleNames} +${remainingCount} more`
            : visibleNames;
    }

    get recordsStepSummary() {
        if (this.isObjectSupportPending && this.selectedRecords.length > 0) {
            return `${this.selectedRecordPreview}. Checking compare support for ${this.activeObjectType}.`;
        }

        if (this.isObjectSupportPending) {
            return `Checking compare support for ${this.activeObjectType}.`;
        }

        if (!this.selectedRecords.length) {
            return 'Choose at least 2 records to compare.';
        }

        if (!this.hasMinimumSelectedRecords) {
            return `${this.selectedRecordPreview}. Add 1 more record to continue.`;
        }

        return `${this.compareSelectionLimitLabel} selected • ${this.selectedRecordPreview}`;
    }

    get settingsStepSummary() {
        if (!this.activeObjectType) {
            return 'Choose an object type and at least 2 records to unlock shared settings.';
        }

        if (!this.hasMinimumSelectedRecords) {
            return 'Optional. Unlocks after you choose at least 2 records.';
        }

        return this.compareContextSummary;
    }

    get chatStepSummary() {
        if (!this.comparisonLoaded) {
            return 'Load the comparison to start the conversation.';
        }

        return this.comparisonLabel;
    }

    get recordsStepClass() {
        return this.buildStepClass({
            active: this.activeStep === 'records',
            complete: this.hasMinimumSelectedRecords,
            locked: false
        });
    }

    get settingsStepClass() {
        return this.buildStepClass({
            active: this.activeStep === 'settings',
            complete: this.comparisonLoaded,
            locked: this.settingsStepDisabled
        });
    }

    get chatStepClass() {
        return this.buildStepClass({
            active: this.activeStep === 'chat',
            complete: this.comparisonLoaded,
            locked: this.chatStepDisabled
        });
    }

    get recordsStepBadgeClass() {
        return this.buildStepBadgeClass({
            active: this.activeStep === 'records',
            complete: this.hasMinimumSelectedRecords,
            locked: false
        });
    }

    get settingsStepBadgeClass() {
        return this.buildStepBadgeClass({
            active: this.activeStep === 'settings',
            complete: this.comparisonLoaded,
            locked: this.settingsStepDisabled
        });
    }

    get chatStepBadgeClass() {
        return this.buildStepBadgeClass({
            active: this.activeStep === 'chat',
            complete: this.comparisonLoaded,
            locked: this.chatStepDisabled
        });
    }

    get recordsStepChevronIcon() {
        return this.activeStep === 'records' ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get settingsStepChevronIcon() {
        return this.activeStep === 'settings' ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get chatStepChevronIcon() {
        return this.activeStep === 'chat' ? 'utility:chevrondown' : 'utility:chevronright';
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

            if (this.activeObjectType && !this.isActiveObjectTypeSupported) {
                if (await this.validateCurrentRecordPageObjectSupport()) {
                    this.objectTypeError = null;
                    this.performSearch();
                    this.loadCompareContextMetadata({ resetSelections: true });
                    if (this.recordId && this.objectApiName && this.showSuggestedComparisonRecordsEnabled) {
                        this.loadSuggestions();
                    }
                    return;
                }

                this.objectTypeError = `${this.activeObjectType} is not supported for compare mode.`;
                this.availableContext = null;
                this.searchResults = [];
                this.suggestedRecords = [];
                this.suggestionsLoaded = true;
                return;
            }

            if (this.activeObjectType) {
                this.objectTypeError = null;
                this.performSearch();
                this.loadCompareContextMetadata({ resetSelections: true });
                if (this.recordId && this.objectApiName && this.showSuggestedComparisonRecordsEnabled) {
                    this.loadSuggestions();
                }
            }
        } catch (error) {
            this.objectTypeOptions = [];
            this.objectTypeError = error?.body?.message || error?.message || 'Failed to load object types.';
        } finally {
            this.isLoadingObjectTypes = false;
        }
    }

    async loadCompareContextMetadata({ resetSelections = false } = {}) {
        if (!this.activeObjectType || !this.isActiveObjectTypeSupported) {
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

            if (resetSelections || this.includedParentReferenceFields.length === 0) {
                const parentDefaults = this.resolveConfiguredSelections(
                    ctx.parentReferences || [],
                    'referenceFieldApiName',
                    this.defaultParentReferencesCsv,
                    item => item.includedByDefault
                );
                this.includedParentReferenceFields = parentDefaults.slice(
                    0,
                    this.normalizedMaxParentReferencesSelected
                );
            }

            if (resetSelections) {
                this.activeFieldSelectionMode =
                    this.fieldSelectionMode === 'fields' ? 'fields' : 'categories';
                this.includedFields = this.resolveInitialIncludedFields(
                    ctx.fieldCategories,
                    this.includedCategories
                );
            }
            if (resetSelections) {
                this.includeSameObjectSiblingsThroughParents = this.defaultSameObjectSiblingsEnabled === true
                    || this.defaultSameObjectSiblingsEnabled === 'true';
                this.parentSiblingRelationshipByReferenceField = {};
            }

            this.currentDepth = resetSelections
                ? this.normalizeDepth(this.defaultDepth)
                : this.normalizeDepth(this.currentDepth);

            this.updateCompareWarningState();
        } catch (error) {
            this.availableContext = null;
            this.setCompareContextFailureState(error);
            this.activeStep = this.hasMinimumSelectedRecords ? 'settings' : 'records';
        } finally {
            this.isLoadingCompareContext = false;
        }
    }

    refreshCompareContextMetadata(resetSelections = false) {
        if (!this.isActiveObjectTypeSupported) {
            this.availableContext = null;
            this.resetCompareWarningState();
            return;
        }

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
        if (!this.recordId || !this.isActiveObjectTypeSupported) return;
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

    // ── Event Handlers ──

    handleObjectTypeChange(event) {
        this.selectedObjectType = event.detail.value;
        this._validatedCurrentObjectType = null;
        this.selectedRecords = [];
        this.searchResults = [];
        this.suggestedRecords = [];
        this.suggestionsLoaded = false;
        this.includedCategories = [];
        this.includedRelationships = [];
        this.includedFields = [];
        this.activeFieldSelectionMode =
            this.fieldSelectionMode === 'fields' ? 'fields' : 'categories';
        this.includedParentReferenceFields = [];
        this.includeSameObjectSiblingsThroughParents = false;
        this.parentSiblingRelationshipByReferenceField = {};
        this.searchError = null;
        this.objectTypeError = null;
        this.activeStep = 'records';
        this.invalidateComparison();
        this.loadCompareContextMetadata({ resetSelections: true });
        this.performSearch();
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

    async validateCurrentRecordPageObjectSupport() {
        if (!this.recordId || !this.objectApiName || this.activeObjectType !== this.objectApiName) {
            return false;
        }

        this._isValidatingCurrentObjectType = true;

        try {
            await searchRecords({
                objectApiName: this.activeObjectType,
                searchTerm: '',
                maxResults: 1
            });
            this._validatedCurrentObjectType = this.activeObjectType;
            return true;
        } catch (error) {
            this._validatedCurrentObjectType = null;
            return false;
        } finally {
            this._isValidatingCurrentObjectType = false;
        }
    }

    syncSupportStatusRotation() {
        const steps = this.supportStatusSteps;
        const shouldRotate = this.showSupportStatus && steps.length > 1;
        const nextSignature = steps.join('|');

        if (!shouldRotate) {
            this.stopSupportStatusRotation();
            return;
        }

        if (this._supportStatusInterval && this._supportStatusSignature === nextSignature) {
            return;
        }

        this.stopSupportStatusRotation(false);
        this._supportStatusSignature = nextSignature;
        this._supportStatusStepIndex = 0;
        this._supportStatusInterval = setInterval(() => {
            this._supportStatusStepIndex = (this._supportStatusStepIndex + 1) % steps.length;
        }, LOADING_STEP_ROTATION_MS);
    }

    stopSupportStatusRotation(resetIndex = true) {
        if (this._supportStatusInterval) {
            clearInterval(this._supportStatusInterval);
            this._supportStatusInterval = null;
        }

        this._supportStatusSignature = null;
        if (resetIndex) {
            this._supportStatusStepIndex = 0;
        }
    }

    async performSearch() {
        if (!this.activeObjectType || !this.isActiveObjectTypeSupported) {
            this.searchResults = [];
            return;
        }

        try {
            const results = await searchRecords({
                objectApiName: this.activeObjectType,
                searchTerm: this.searchTerm,
                maxResults: 10
            });

            const selectedIds = new Set(this.selectedRecords.map(r => r.id));
            this.searchResults = (results || []).filter(r => !selectedIds.has(r.id));
            this.searchError = null;
        } catch (error) {
            this.searchResults = [];
            this.searchError = error?.body?.message || error?.message || 'Search failed.';
        }
    }

    handleRecordSelect(event) {
        const { id, name } = event.detail;

        if (!this.canAddRecord(id)) return;

        this.selectedRecords = [...this.selectedRecords, { id, name }];
        this.searchResults = this.searchResults.filter(r => r.id !== id);
        this.suggestedRecords = this.suggestedRecords.filter(r => r.id !== id);
        this.searchError = null;
        this.invalidateComparison();
        this.refreshCompareContextMetadata();
        this.syncActiveStepAfterSelectionChange();
    }

    handleRemoveRecord(event) {
        const id = event.detail.id;
        this.selectedRecords = this.selectedRecords.filter(r => r.id !== id);
        this.invalidateComparison();
        this.refreshCompareContextMetadata();
        this.performSearch();
        this.syncActiveStepAfterSelectionChange();
    }

    async handleLoadComparison() {
        if (this.selectedRecords.length < 2 || !this.isActiveObjectTypeSupported) return;

        this.isLoadingComparison = true;
        this.compareError = null;
        this.invalidateComparison();

        try {
            const recordIds = this.selectedRecords.map(r => r.id);
            const ctx = await getComparisonContext({
                recordIds,
                depth: this.currentDepth,
                includedCategories: this.includedCategories,
                includedRelationships: this.includedRelationships,
                maxCompareRecords: this.normalizedMaxCompareRecords,
                maxRelatedRecords: this.normalizedRelatedRecordsPerRelationship,
                promptWarningThresholdTokens: this.normalizedPromptWarningThreshold,
                includedParentReferenceFields: this.includedParentReferenceFields,
                includeSameObjectSiblingsThroughParents: this.includeSameObjectSiblingsThroughParents,
                parentSiblingRelationshipByReferenceField: this.parentSiblingRelationshipByReferenceField,
                includedFields:
                    this.activeFieldSelectionMode === 'fields'
                        ? this.includedFields
                        : null
            });

            this.comparisonContextJson = JSON.stringify(this.serializeComparisonForChat(ctx));
            this.comparisonLoaded = true;
            this.activeStep = 'chat';
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
        this.activeStep = 'settings';
    }

    handleParentContextChange(event) {
        const {
            includedParentReferenceFields,
            includeSameObjectSiblingsThroughParents,
            parentSiblingRelationshipByReferenceField
        } = event.detail || {};

        if (Array.isArray(includedParentReferenceFields)) {
            this.includedParentReferenceFields = includedParentReferenceFields
                .slice(0, this.normalizedMaxParentReferencesSelected);
            const allowed = new Set(this.includedParentReferenceFields);
            const currentMap = { ...(this.parentSiblingRelationshipByReferenceField || {}) };
            for (const key of Object.keys(currentMap)) {
                if (!allowed.has(key)) delete currentMap[key];
            }
            this.parentSiblingRelationshipByReferenceField = currentMap;
        }
        if (typeof includeSameObjectSiblingsThroughParents === 'boolean') {
            this.includeSameObjectSiblingsThroughParents = includeSameObjectSiblingsThroughParents;
        }
        if (parentSiblingRelationshipByReferenceField
            && typeof parentSiblingRelationshipByReferenceField === 'object') {
            this.parentSiblingRelationshipByReferenceField = { ...parentSiblingRelationshipByReferenceField };
        }
        this.invalidateComparison();
        this.updateCompareWarningState();
        this.activeStep = 'settings';
    }

    handleDepthChange(event) {
        this.currentDepth = this.normalizeDepth(event.detail.depth);
        this.invalidateComparison();
        this.updateCompareWarningState();
        this.activeStep = 'settings';
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
        this.activeStep = 'settings';
    }

    handleFieldSelectionChange(event) {
        const detail = event.detail || {};
        if (Array.isArray(detail.includedCategories)) {
            this.includedCategories = detail.includedCategories;
        }
        if (detail.fieldSelectionMode === 'fields') {
            this.activeFieldSelectionMode = 'fields';
            this.includedFields = Array.isArray(detail.includedFields)
                ? detail.includedFields
                : [];
        } else {
            this.activeFieldSelectionMode = 'categories';
            this.includedFields = [];
        }
        this.showFieldSelector = false;
        this.invalidateComparison();
        this.updateCompareWarningState();
        this.activeStep = 'settings';
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

    openRecordsStep() {
        this.activeStep = 'records';
    }

    openSettingsStep() {
        if (this.settingsStepDisabled) {
            return;
        }
        this.activeStep = 'settings';
    }

    openChatStep() {
        if (this.chatStepDisabled) {
            return;
        }
        this.activeStep = 'chat';
    }

    resetCompareWarningState() {
        this.contextStatus = null;
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
        this.comparisonContextWarnings = [];
    }

    updateCompareWarningState(completeness) {
        this.comparisonContextWarnings = this.extractCompletenessMessages(completeness);

        if (this.comparisonContextWarnings.length > 0) {
            this.contextStatus = 'partial';
            this.contextWarningSummary = 'Some compared record context was skipped or truncated. AI responses may be incomplete.';
            this.contextWarningMessages = [...this.comparisonContextWarnings];
            return;
        }

        this.contextStatus = 'ready';
        this.contextWarningSummary = null;
        this.contextWarningMessages = [];
    }

    setCompareContextFailureState(error) {
        this.contextStatus = 'failed';
        this.contextWarningSummary = 'Comparison context could not be loaded. Responses may be ungrounded until the comparison loads successfully.';
        this.contextWarningMessages = [this.extractErrorMessage(error)];
    }

    extractCompletenessMessages(completeness) {
        return Array.isArray(completeness?.warningMessages)
            ? completeness.warningMessages.filter(Boolean)
            : [];
    }

    syncActiveStepAfterSelectionChange() {
        if (!this.hasMinimumSelectedRecords) {
            this.activeStep = 'records';
            return;
        }

        if (this.activeStep === 'chat') {
            this.activeStep = 'settings';
        }
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

    resolveInitialIncludedFields(fieldCategories, includedCategoryNames) {
        if (this.fieldSelectionMode !== 'fields') {
            return [];
        }
        const configured = this.parseCsv(this.defaultIncludedFieldsCsv);
        if (!configured.length) {
            return [];
        }

        const includedCategorySet = new Set(includedCategoryNames || []);
        const applyFilter = includedCategorySet.size > 0;
        const eligible = new Set();
        (fieldCategories || []).forEach(cat => {
            if (applyFilter && !includedCategorySet.has(cat.name)) return;
            (cat.fields || []).forEach(fi => {
                if (fi && fi.apiName) eligible.add(fi.apiName.toLowerCase());
            });
        });

        const seen = new Set();
        const result = [];
        configured.forEach(token => {
            const key = token.toLowerCase();
            if (seen.has(key) || !eligible.has(key)) return;
            seen.add(key);
            result.push(token);
        });
        return result;
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

    canAddRecord(id) {
        if (!id) {
            return false;
        }
        if (this.selectedRecords.some(record => record.id === id)) {
            return false;
        }
        return this.selectedRecords.length < this.normalizedMaxCompareRecords;
    }

    buildStepClass({ active, complete, locked }) {
        const classNames = ['step-card'];

        if (active) {
            classNames.push('step-card-active');
        }
        if (complete) {
            classNames.push('step-card-complete');
        }
        if (locked) {
            classNames.push('step-card-locked');
        }

        return classNames.join(' ');
    }

    buildStepBadgeClass({ active, complete, locked }) {
        const classNames = ['step-badge'];

        if (active) {
            classNames.push('step-badge-active');
        } else if (complete && !locked) {
            classNames.push('step-badge-complete');
        } else if (locked) {
            classNames.push('step-badge-locked');
        }

        return classNames.join(' ');
    }

    serializeComparisonForChat(ctx) {
        if (!ctx) {
            return null;
        }

        const warningMessages = this.extractCompletenessMessages(ctx.completeness);

        return {
            selectionSummary: {
                mode: 'compare',
                objectApiName: this.activeObjectType || ctx.objectApiName,
                objectLabel: ctx.objectLabel,
                comparedRecordCount: ctx.recordCount,
                depth: this.currentDepth,
                selectedCategories: [...this.includedCategories],
                selectedRelationships: [...this.includedRelationships],
                selectedFields:
                    this.activeFieldSelectionMode === 'fields'
                        ? [...(this.includedFields || [])]
                        : [],
                fieldSelectionMode: this.activeFieldSelectionMode,
                selectedParentReferences: [...(this.includedParentReferenceFields || [])],
                includeSameObjectSiblingsThroughParents: !!this.includeSameObjectSiblingsThroughParents,
                parentSiblingRelationshipByReferenceField: { ...(this.parentSiblingRelationshipByReferenceField || {}) },
                contextStatus: warningMessages.length ? 'partial' : 'ready',
                warningSummary: warningMessages.length
                    ? 'Some compared record context was skipped or truncated. AI responses may be incomplete.'
                    : null,
                warningMessages
            },
            comparisonContext: ctx
        };
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
