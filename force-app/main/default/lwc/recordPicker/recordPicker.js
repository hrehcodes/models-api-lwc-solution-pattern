import { LightningElement, api } from 'lwc';

export default class RecordPicker extends LightningElement {
    @api mode = 'insights';
    @api showObjectPicker = false;
    @api objectTypeOptions = [];
    @api selectedObjectType = '';
    @api objectTypeFilter = '';
    @api isLoadingObjectTypes = false;
    @api objectTypeError;
    @api noFilteredObjectOptions = false;
    @api selectedRecords = [];
    @api canSearch = false;
    @api searchTerm = '';
    @api searchResults = [];
    @api searchError;
    @api showSuggestions = false;
    @api isLoadingSuggestions = false;
    @api suggestedRecords = [];
    @api noSuggestions = false;
    @api showAdvancedIdEntry = false;
    @api manualRecordId = '';
    @api hasReachedSelectionLimit = false;
    @api selectionLimitMessage;

    showManualEntry = false;

    get objectFilterPlaceholder() {
        return 'Filter object types...';
    }

    get searchPlaceholder() {
        return `Search ${this.selectedObjectType || 'records'}...`;
    }

    get showSearchResults() {
        return Array.isArray(this.searchResults) && this.searchResults.length > 0;
    }

    get hasSelectedRecords() {
        return Array.isArray(this.selectedRecords) && this.selectedRecords.length > 0;
    }

    get hasSuggestions() {
        return Array.isArray(this.suggestedRecords) && this.suggestedRecords.length > 0;
    }

    get showManualEntrySection() {
        return this.showAdvancedIdEntry && (this.showManualEntry || Boolean(this.manualRecordId));
    }

    get manualLoadDisabled() {
        return !this.manualRecordId;
    }

    get manualToggleLabel() {
        return this.showManualEntrySection ? 'Hide record ID entry' : 'Use a record ID instead';
    }

    handleObjectTypeChange(event) {
        this.dispatchEvent(new CustomEvent('objecttypechange', {
            detail: { value: event.detail.value }
        }));
    }

    handleObjectFilterChange(event) {
        this.dispatchEvent(new CustomEvent('objectfilterchange', {
            detail: { value: event.detail.value || '' }
        }));
    }

    handleSearchChange(event) {
        this.dispatchEvent(new CustomEvent('searchchange', {
            detail: { value: event.detail.value || '' }
        }));
    }

    handleSelectRecord(event) {
        const { id, name, source } = event.currentTarget.dataset;
        if (!id || !name) {
            return;
        }

        this.dispatchEvent(new CustomEvent('recordselect', {
            detail: { id, name, source: source || 'search' }
        }));
    }

    handleRemoveRecord(event) {
        const id = event.target.dataset.id;
        if (!id) {
            return;
        }

        this.dispatchEvent(new CustomEvent('recordremove', {
            detail: { id }
        }));
    }

    handleToggleManualEntry() {
        this.showManualEntry = !this.showManualEntry;
    }

    handleManualRecordIdChange(event) {
        this.dispatchEvent(new CustomEvent('manualidchange', {
            detail: { value: event.detail.value || event.target.value || '' }
        }));
    }

    handleManualLoad() {
        if (!this.manualRecordId) {
            return;
        }

        this.dispatchEvent(new CustomEvent('manualload', {
            detail: { value: this.manualRecordId }
        }));
    }
}
