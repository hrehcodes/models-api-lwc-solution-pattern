import { LightningElement, api } from 'lwc';
const LOADING_STEP_ROTATION_MS = 1400;

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
    _objectTypeLoadingStepIndex = 0;
    _objectTypeLoadingInterval;
    _objectTypeLoadingSignature;

    renderedCallback() {
        this.syncObjectTypeLoadingRotation();
    }

    disconnectedCallback() {
        this.stopObjectTypeLoadingRotation();
    }

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

    get objectTypeLoadingTitle() {
        if (!this.isLoadingObjectTypes) {
            return null;
        }

        if (this.mode === 'compare') {
            return this.selectedObjectType
                ? `Preparing ${this.selectedObjectType} for compare`
                : 'Preparing compare-ready objects';
        }

        return 'Preparing insights search';
    }

    get objectTypeLoadingMessage() {
        if (!this.isLoadingObjectTypes) {
            return null;
        }

        if (this.mode === 'compare') {
            return this.selectedObjectType
                ? `Getting org metadata, checking ${this.selectedObjectType}, and mapping supported relationships.`
                : 'Getting org metadata, discovering compare-ready objects, and mapping supported relationships.';
        }

        return 'Getting org metadata, discovering searchable objects, and preparing the record picker.';
    }

    get objectTypeLoadingSteps() {
        if (!this.isLoadingObjectTypes) {
            return [];
        }

        if (this.mode === 'compare') {
            if (this.selectedObjectType) {
                return [
                    'Getting org metadata',
                    `Checking ${this.selectedObjectType}`,
                    'Mapping relationships'
                ];
            }

            return [
                'Getting org metadata',
                'Discovering compare-ready objects',
                'Mapping relationships'
            ];
        }

        return [
            'Getting org metadata',
            'Discovering searchable objects',
            'Preparing record search'
        ];
    }

    get activeObjectTypeLoadingStep() {
        if (!this.objectTypeLoadingSteps.length) {
            return null;
        }

        return this.objectTypeLoadingSteps[this._objectTypeLoadingStepIndex] || this.objectTypeLoadingSteps[0];
    }

    get objectTypeLoadingIndicators() {
        return this.objectTypeLoadingSteps.map((step, index) => ({
            id: `${index}-${step}`,
            className: index === this._objectTypeLoadingStepIndex
                ? 'picker-loading-dot picker-loading-dot-active'
                : 'picker-loading-dot'
        }));
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

    syncObjectTypeLoadingRotation() {
        const steps = this.objectTypeLoadingSteps;
        const shouldRotate = this.isLoadingObjectTypes && steps.length > 1;
        const nextSignature = steps.join('|');

        if (!shouldRotate) {
            this.stopObjectTypeLoadingRotation();
            return;
        }

        if (this._objectTypeLoadingInterval && this._objectTypeLoadingSignature === nextSignature) {
            return;
        }

        this.stopObjectTypeLoadingRotation(false);
        this._objectTypeLoadingSignature = nextSignature;
        this._objectTypeLoadingStepIndex = 0;
        this._objectTypeLoadingInterval = setInterval(() => {
            this._objectTypeLoadingStepIndex = (this._objectTypeLoadingStepIndex + 1) % steps.length;
        }, LOADING_STEP_ROTATION_MS);
    }

    stopObjectTypeLoadingRotation(resetIndex = true) {
        if (this._objectTypeLoadingInterval) {
            clearInterval(this._objectTypeLoadingInterval);
            this._objectTypeLoadingInterval = null;
        }

        this._objectTypeLoadingSignature = null;
        if (resetIndex) {
            this._objectTypeLoadingStepIndex = 0;
        }
    }
}
