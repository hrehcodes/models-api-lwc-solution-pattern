import { LightningElement, api, track } from 'lwc';

export default class InsightsFieldSelector extends LightningElement {
    @api fieldCategories = [];
    @api includedCategories = [];

    @track localIncluded = [];
    @track expandedCategories = new Set();

    connectedCallback() {
        this.localIncluded = [...(this.includedCategories || [])];
    }

    get categoriesWithState() {
        const included = new Set(this.localIncluded);
        return (this.fieldCategories || []).map(cat => ({
            ...cat,
            isIncluded: included.has(cat.name),
            isExpanded: this.expandedCategories.has(cat.name),
            expandLabel: this.expandedCategories.has(cat.name) ? 'Hide fields' : 'Show fields',
            cardClass: `category-card slds-box slds-box_x-small ${included.has(cat.name) ? 'category-selected' : 'category-unselected'}`
        }));
    }

    get selectedCategoryCount() {
        return this.localIncluded.length;
    }

    get selectedFieldCount() {
        const included = new Set(this.localIncluded);
        return (this.fieldCategories || [])
            .filter(cat => included.has(cat.name))
            .reduce((sum, cat) => sum + cat.fieldCount, 0);
    }

    handleToggleCategory(event) {
        const category = event.target.dataset.category;
        const isChecked = event.target.checked;

        if (isChecked && !this.localIncluded.includes(category)) {
            this.localIncluded = [...this.localIncluded, category];
        } else if (!isChecked) {
            this.localIncluded = this.localIncluded.filter(c => c !== category);
        }
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
        this.localIncluded = (this.fieldCategories || []).map(cat => cat.name);
    }

    handleDeselectAll() {
        this.localIncluded = [];
    }

    handleApply() {
        this.dispatchEvent(new CustomEvent('categorieschange', {
            detail: { includedCategories: [...this.localIncluded] }
        }));
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close'));
    }
}
