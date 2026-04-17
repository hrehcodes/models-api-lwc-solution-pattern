import { LightningElement, api, track } from 'lwc';

const MODE_CATEGORIES = 'categories';
const MODE_FIELDS = 'fields';

export default class InsightsFieldSelector extends LightningElement {
    @api fieldCategories = [];
    @api includedCategories = [];
    @api includedFields = [];
    @api selectionMode = MODE_CATEGORIES;

    @track localIncluded = [];
    @track localFields = [];
    @track localMode = MODE_CATEGORIES;
    @track expandedCategories = new Set();
    @track searchTerm = '';

    connectedCallback() {
        this.localIncluded = [...(this.includedCategories || [])];
        this.localFields = [...(this.includedFields || [])];
        this.localMode =
            this.selectionMode === MODE_FIELDS ? MODE_FIELDS : MODE_CATEGORIES;
    }

    get isCategoryMode() {
        return this.localMode !== MODE_FIELDS;
    }

    get isFieldMode() {
        return this.localMode === MODE_FIELDS;
    }

    get modeOptions() {
        return [
            { label: 'By category', value: MODE_CATEGORIES },
            { label: 'Individual fields', value: MODE_FIELDS }
        ];
    }

    get categoriesWithState() {
        const included = new Set(this.localIncluded);
        return (this.fieldCategories || []).map((cat) => ({
            ...cat,
            isIncluded: included.has(cat.name),
            isExpanded: this.expandedCategories.has(cat.name),
            expandLabel: this.expandedCategories.has(cat.name)
                ? 'Hide fields'
                : 'Show fields',
            cardClass: `category-card slds-box slds-box_x-small ${
                included.has(cat.name) ? 'category-selected' : 'category-unselected'
            }`
        }));
    }

    get selectedCategoryCount() {
        return this.localIncluded.length;
    }

    get selectedFieldCount() {
        if (this.isFieldMode) {
            return this.localFields.length;
        }
        const included = new Set(this.localIncluded);
        return (this.fieldCategories || [])
            .filter((cat) => included.has(cat.name))
            .reduce((sum, cat) => sum + cat.fieldCount, 0);
    }

    /**
     * Universe of fields the user is allowed to pick from. This is ALWAYS
     * derived from the server-provided categorized field list — we never let
     * the UI synthesize a field name. Only fields inside the currently
     * included categories (or all categories when none are selected) are
     * eligible.
     */
    get eligibleFields() {
        const categorySet = new Set(this.localIncluded);
        const applyCategoryFilter = categorySet.size > 0;
        const seen = new Set();
        const results = [];
        const search = (this.searchTerm || '').trim().toLowerCase();

        (this.fieldCategories || []).forEach((cat) => {
            if (applyCategoryFilter && !categorySet.has(cat.name)) return;
            (cat.fields || []).forEach((fi) => {
                if (!fi || !fi.apiName) return;
                const key = fi.apiName.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                if (
                    search &&
                    !fi.apiName.toLowerCase().includes(search) &&
                    !(fi.label || '').toLowerCase().includes(search)
                ) {
                    return;
                }
                results.push(fi);
            });
        });
        return results;
    }

    get fieldsWithState() {
        const selected = new Set(this.localFields.map((f) => f.toLowerCase()));
        return this.eligibleFields.map((fi) => ({
            ...fi,
            isIncluded: selected.has(fi.apiName.toLowerCase()),
            rowClass: selected.has(fi.apiName.toLowerCase())
                ? 'field-row slds-p-vertical_xx-small field-selected'
                : 'field-row slds-p-vertical_xx-small'
        }));
    }

    get hasFieldResults() {
        return this.fieldsWithState.length > 0;
    }

    get fieldResultSummary() {
        return `${this.selectedFieldCount} field(s) selected`;
    }

    handleModeChange(event) {
        const value = event.detail.value;
        this.localMode = value === MODE_FIELDS ? MODE_FIELDS : MODE_CATEGORIES;
    }

    handleToggleCategory(event) {
        const category = event.target.dataset.category;
        const isChecked = event.target.checked;

        if (isChecked && !this.localIncluded.includes(category)) {
            this.localIncluded = [...this.localIncluded, category];
        } else if (!isChecked) {
            this.localIncluded = this.localIncluded.filter((c) => c !== category);
            this.localFields = this.localFields.filter((apiName) =>
                this.eligibleFieldApiNames().has(apiName.toLowerCase())
            );
        }
    }

    handleToggleField(event) {
        const apiName = event.target.dataset.field;
        if (!apiName) return;
        const isChecked = event.target.checked;
        const lower = apiName.toLowerCase();
        const already = this.localFields.some((f) => f.toLowerCase() === lower);

        if (isChecked && !already) {
            this.localFields = [...this.localFields, apiName];
        } else if (!isChecked) {
            this.localFields = this.localFields.filter(
                (f) => f.toLowerCase() !== lower
            );
        }
    }

    handleSearch(event) {
        this.searchTerm = event.target.value || '';
    }

    handleToggleExpand(event) {
        const category = event.target.dataset.category;
        const newExpanded = new Set(this.expandedCategories);
        if (newExpanded.has(category)) {
            newExpanded.delete(category);
        } else {
            newExpanded.add(category);
        }
        this.expandedCategories = newExpanded;
    }

    handleSelectAll() {
        if (this.isFieldMode) {
            this.localFields = this.eligibleFields.map((fi) => fi.apiName);
        } else {
            this.localIncluded = (this.fieldCategories || []).map(
                (cat) => cat.name
            );
        }
    }

    handleDeselectAll() {
        if (this.isFieldMode) {
            this.localFields = [];
        } else {
            this.localIncluded = [];
        }
    }

    handleApply() {
        this.dispatchEvent(
            new CustomEvent('categorieschange', {
                detail: { includedCategories: [...this.localIncluded] }
            })
        );
        this.dispatchEvent(
            new CustomEvent('fieldselectionchange', {
                detail: {
                    includedCategories: [...this.localIncluded],
                    includedFields: [...this.localFields],
                    fieldSelectionMode: this.localMode
                }
            })
        );
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }

    eligibleFieldApiNames() {
        const set = new Set();
        this.eligibleFields.forEach((fi) => set.add(fi.apiName.toLowerCase()));
        return set;
    }
}
