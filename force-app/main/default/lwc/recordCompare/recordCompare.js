import { LightningElement, api, track } from 'lwc';
import getComparisonContext from '@salesforce/apex/RecordCompareService.getComparisonContext';
import searchRecords from '@salesforce/apex/RecordCompareService.searchRecords';
import getSuggestedRecords from '@salesforce/apex/RecordCompareService.getSuggestedRecords';

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

    _sessionTokens = 0;
    _sessionCredits = 0;

    _searchTimeout;

    objectTypeOptions = [
        { label: 'Account', value: 'Account' },
        { label: 'Opportunity', value: 'Opportunity' },
        { label: 'Contact', value: 'Contact' },
        { label: 'Case', value: 'Case' },
        { label: 'Lead', value: 'Lead' }
    ];

    connectedCallback() {
        if (this.objectApiName) {
            this.selectedObjectType = this.objectApiName;
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

    get canSearch() {
        return this.selectedObjectType && this.selectedRecords.length < 5;
    }

    get canCompare() {
        return this.selectedRecords.length >= 2 && !this.isLoadingComparison;
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
        this.comparisonLoaded = false;
    }

    // ── Event Handlers ──

    handleObjectTypeChange(event) {
        this.selectedObjectType = event.detail.value;
        this.selectedRecords = [];
        this.searchResults = [];
        this.comparisonLoaded = false;
        this.comparisonContextJson = null;
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
        this.comparisonLoaded = false;
    }

    handleRemoveRecord(event) {
        const id = event.target.dataset.id;
        this.selectedRecords = this.selectedRecords.filter(r => r.id !== id);
        this.comparisonLoaded = false;
    }

    handleRemoveRecordCollapsed(event) {
        const id = event.target.dataset.id;
        this.selectedRecords = this.selectedRecords.filter(r => r.id !== id);
        this.comparisonLoaded = false;
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
        this.comparisonLoaded = false;

        try {
            const recordIds = this.selectedRecords.map(r => r.id);
            const ctx = await getComparisonContext({ recordIds });

            this.comparisonContextJson = JSON.stringify(ctx);
            this.comparisonLoaded = true;
            this.selectionCollapsed = true;

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
        } finally {
            this.isLoadingComparison = false;
        }
    }

    handleChatUsageUpdate(event) {
        this._sessionTokens = event.detail.sessionTokens;
        this._sessionCredits = event.detail.sessionCredits;
        this.dispatchEvent(new CustomEvent('usageupdate', {
            detail: event.detail
        }));
    }

    isBooleanEnabled(value) {
        return value !== false && value !== 'false';
    }
}
