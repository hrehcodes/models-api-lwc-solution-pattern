import { LightningElement, api } from 'lwc';

const OBJECT_ICON_MAP = {
    Account: 'standard:account',
    Opportunity: 'standard:opportunity',
    Contact: 'standard:contact',
    Case: 'standard:case',
    Lead: 'standard:lead',
    Task: 'standard:task',
    Event: 'standard:event',
    Campaign: 'standard:campaign'
};

const MAX_TOKENS = 8000;

const DEPTH_DESCRIPTIONS = {
    1: 'Direct children only (e.g., Opps on Account)',
    2: 'Children + grandchildren (e.g., Opp Products)',
    3: 'Three levels deep (uses more queries)'
};

export default class ContextPanel extends LightningElement {
    @api recordId;
    @api availableContext;
    @api includedCategories = [];
    @api includedRelationships = [];
    @api depth = 1;
    @api maxDepthAllowed = 3;
    @api sessionTokens = 0;
    @api sessionCredits = 0;
    @api showUsageMetrics;
    @api contextStatus;
    @api contextWarningSummary;
    @api contextWarningMessages = [];
    @api hideContextWarnings;
    @api contextTokenEstimate;
    @api tokenWarningThreshold = 20000;

    fieldsExpanded = false;
    relationshipsExpanded = false;

    renderedCallback() {
        const fieldsCb = this.template.querySelector('input[data-select-all="fields"]');
        if (fieldsCb) {
            fieldsCb.indeterminate = this.someFieldsSelected;
        }
        const relsCb = this.template.querySelector('input[data-select-all="rels"]');
        if (relsCb) {
            relsCb.indeterminate = this.someRelsSelected;
        }
    }

    get objectIconName() {
        if (!this.availableContext) return 'standard:record';
        return OBJECT_ICON_MAP[this.availableContext.objectApiName] || 'standard:custom_notification';
    }

    get depth1Variant() { return this.depth === 1 ? 'brand' : 'neutral'; }
    get depth2Variant() { return this.depth === 2 ? 'brand' : 'neutral'; }
    get depth3Variant() { return this.depth === 3 ? 'brand' : 'neutral'; }
    get showDepth2Button() { return this.normalizedMaxDepth >= 2; }
    get showDepth3Button() { return this.normalizedMaxDepth >= 3; }
    get showUsageMetricsEnabled() { return this.isBooleanEnabled(this.showUsageMetrics); }
    get showContextWarning() {
        return !this.hideContextWarningsEnabled
            && Boolean(this.contextWarningSummary || this.contextWarningMessageList.length);
    }
    get contextWarningMessageList() {
        return Array.isArray(this.contextWarningMessages) ? this.contextWarningMessages.filter(Boolean) : [];
    }
    get contextWarningClass() {
        return this.contextStatus === 'failed'
            ? 'context-warning context-warning-failed'
            : 'context-warning';
    }
    get hideContextWarningsEnabled() {
        return this.hideContextWarnings === true || this.hideContextWarnings === 'true';
    }

    get showLargeContextWarning() {
        return this.tokenWarningThresholdValue > 0
            && Boolean(this.tokenEstimate)
            && this.tokenEstimate > this.tokenWarningThresholdValue;
    }

    get largeContextWarningSummary() {
        return `This context is estimated at ~${this.tokenEstimate} tokens, above the configured warning threshold of ${this.tokenWarningThresholdValue.toLocaleString()} tokens.`;
    }

    get largeContextWarningDetails() {
        return 'Large prompts can be slower, consume more flex credits, and may cause some context to be truncated before the model responds.';
    }

    get tokenWarningThresholdValue() {
        const parsedThreshold = parseInt(this.tokenWarningThreshold, 10);
        if (Number.isNaN(parsedThreshold)) {
            return 20000;
        }
        return Math.max(parsedThreshold, 0);
    }

    get depthDescription() {
        return DEPTH_DESCRIPTIONS[this.depth] || '';
    }

    get normalizedMaxDepth() {
        const parsedDepth = parseInt(this.maxDepthAllowed, 10);
        const safeDepth = Number.isNaN(parsedDepth) ? 3 : parsedDepth;
        return Math.min(Math.max(safeDepth, 1), 3);
    }

    get fieldsExpandIcon() {
        return this.fieldsExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get relsExpandIcon() {
        return this.relationshipsExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get fieldCategoriesWithState() {
        if (!this.availableContext?.fieldCategories) return [];
        const included = new Set(this.includedCategories);
        return this.availableContext.fieldCategories.map(cat => ({
            ...cat,
            isIncluded: included.has(cat.name)
        }));
    }

    get allFieldsSelected() {
        if (!this.availableContext?.fieldCategories) return false;
        return this.availableContext.fieldCategories.length > 0
            && this.availableContext.fieldCategories.every(cat =>
                this.includedCategories.includes(cat.name)
            );
    }

    get someFieldsSelected() {
        if (!this.availableContext?.fieldCategories) return false;
        const count = this.availableContext.fieldCategories.filter(cat =>
            this.includedCategories.includes(cat.name)
        ).length;
        return count > 0 && count < this.availableContext.fieldCategories.length;
    }

    get relationshipsWithState() {
        if (!this.availableContext?.relationships) return [];
        const included = new Set(this.includedRelationships);
        return this.availableContext.relationships.map(rel => ({
            ...rel,
            isIncluded: included.has(rel.relationshipName),
            displayCount: typeof rel.recordCount === 'number' && rel.recordCount >= 0
                ? `(${rel.recordCount})`
                : ''
        }));
    }

    get allRelsSelected() {
        if (!this.availableContext?.relationships) return false;
        return this.availableContext.relationships.length > 0
            && this.availableContext.relationships.every(rel =>
                this.includedRelationships.includes(rel.relationshipName)
            );
    }

    get someRelsSelected() {
        if (!this.availableContext?.relationships) return false;
        const count = this.availableContext.relationships.filter(rel =>
            this.includedRelationships.includes(rel.relationshipName)
        ).length;
        return count > 0 && count < this.availableContext.relationships.length;
    }

    get totalFieldCount() {
        if (!this.availableContext?.fieldCategories) return 0;
        const included = new Set(this.includedCategories);
        return this.availableContext.fieldCategories
            .filter(cat => included.has(cat.name))
            .reduce((sum, cat) => sum + cat.fieldCount, 0);
    }

    get includedRelCount() {
        return this.includedRelationships?.length || 0;
    }

    get tokenEstimate() {
        const explicitEstimate = parseInt(this.contextTokenEstimate, 10);
        if (!Number.isNaN(explicitEstimate) && explicitEstimate > 0) {
            return explicitEstimate;
        }

        let tokens = 0;
        const included = new Set(this.includedCategories);
        if (this.availableContext?.fieldCategories) {
            for (const cat of this.availableContext.fieldCategories) {
                if (included.has(cat.name)) {
                    tokens += cat.fieldCount * 15;
                }
            }
        }
        const relIncluded = new Set(this.includedRelationships);
        if (this.availableContext?.relationships) {
            for (const rel of this.availableContext.relationships) {
                if (relIncluded.has(rel.relationshipName) && rel.recordCount > 0) {
                    tokens += rel.recordCount * 100;
                }
            }
        }
        return tokens > 0 ? tokens : null;
    }

    get tokenMeterWidth() {
        const pct = Math.min((this.tokenEstimate || 0) / MAX_TOKENS * 100, 100);
        return `width: ${pct}%`;
    }

    get tokenMeterFillClass() {
        const pct = (this.tokenEstimate || 0) / MAX_TOKENS * 100;
        let color = 'meter-fill-green';
        if (pct > 75) color = 'meter-fill-red';
        else if (pct > 50) color = 'meter-fill-yellow';
        return `token-meter-fill ${color}`;
    }

    // ── Event Handlers ──

    handleDepth1() { this.dispatchEvent(new CustomEvent('depthchange', { detail: { depth: 1 } })); }
    handleDepth2() {
        if (this.normalizedMaxDepth < 2) return;
        this.dispatchEvent(new CustomEvent('depthchange', { detail: { depth: 2 } }));
    }
    handleDepth3() {
        if (this.normalizedMaxDepth < 3) return;
        this.dispatchEvent(new CustomEvent('depthchange', { detail: { depth: 3 } }));
    }

    isBooleanEnabled(value) {
        return value !== false && value !== 'false';
    }

    toggleFieldsSection() { this.fieldsExpanded = !this.fieldsExpanded; }
    toggleRelationshipsSection() { this.relationshipsExpanded = !this.relationshipsExpanded; }

    handleSelectAllFields(event) {
        event.stopPropagation();
        const isChecked = event.target.checked;
        let updated;
        if (isChecked) {
            updated = this.availableContext.fieldCategories.map(cat => cat.name);
        } else {
            updated = [];
        }
        this.dispatchEvent(new CustomEvent('contextchange', {
            detail: { includedCategories: updated, includedRelationships: this.includedRelationships }
        }));
    }

    handleCategoryToggle(event) {
        const category = event.target.dataset.category;
        const isChecked = event.target.checked;
        let updated = [...this.includedCategories];

        if (isChecked && !updated.includes(category)) {
            updated.push(category);
        } else if (!isChecked) {
            updated = updated.filter(c => c !== category);
        }

        this.dispatchEvent(new CustomEvent('contextchange', {
            detail: { includedCategories: updated, includedRelationships: this.includedRelationships }
        }));
    }

    handleSelectAllRels(event) {
        event.stopPropagation();
        const isChecked = event.target.checked;
        let updated;
        if (isChecked) {
            updated = this.availableContext.relationships.map(rel => rel.relationshipName);
        } else {
            updated = [];
        }
        this.dispatchEvent(new CustomEvent('contextchange', {
            detail: { includedCategories: this.includedCategories, includedRelationships: updated }
        }));
    }

    handleRelationshipToggle(event) {
        const relName = event.target.dataset.relationship;
        const isChecked = event.target.checked;
        let updated = [...this.includedRelationships];

        if (isChecked && !updated.includes(relName)) {
            updated.push(relName);
        } else if (!isChecked) {
            updated = updated.filter(r => r !== relName);
        }

        this.dispatchEvent(new CustomEvent('contextchange', {
            detail: { includedCategories: this.includedCategories, includedRelationships: updated }
        }));
    }

    handleFieldSelect(event) {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent('fieldselect'));
    }
}
