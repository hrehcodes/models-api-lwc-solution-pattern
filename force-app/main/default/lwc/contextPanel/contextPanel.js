import { LightningElement, api } from 'lwc';
import getParentChildRelationships from '@salesforce/apex/RecordContextService.getParentChildRelationships';

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
    @api includedFields = [];
    @api fieldSelectionMode = 'categories';
    @api includedParentReferenceFields = [];
    @api includeSameObjectSiblingsThroughParents = false;
    @api parentSiblingRelationshipByReferenceField = {};
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
    parentsExpanded = false;
    parentChildRelationshipsCache = {};
    loadingParentChildFor = new Set();

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

    get parentsExpandIcon() {
        return this.parentsExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get hasParentReferences() {
        return Array.isArray(this.availableContext?.parentReferences)
            && this.availableContext.parentReferences.length > 0;
    }

    get includedParentRefCount() {
        return this.includedParentReferenceFields?.length || 0;
    }

    get parentReferencesWithState() {
        if (!this.availableContext?.parentReferences) return [];
        const includedRefs = new Set(this.includedParentReferenceFields);
        const siblingRelMap = this.parentSiblingRelationshipByReferenceField || {};

        return this.availableContext.parentReferences.map(ref => {
            const isIncluded = includedRefs.has(ref.referenceFieldApiName);
            const hasParentValue = Boolean(ref.parentRecordId);
            const childOptions = this.buildParentChildOptions(
                ref.parentObjectApiName,
                siblingRelMap[ref.referenceFieldApiName]
            );
            const displayLabel = `${ref.parentObjectLabel || ref.parentObjectApiName} (${ref.referenceFieldLabel || ref.referenceFieldApiName})`;
            const selectedChildRelationship = siblingRelMap[ref.referenceFieldApiName] || '';
            const parentSummary = hasParentValue
                ? (ref.parentRecordName || ref.parentRecordId)
                : 'Blank on this record';
            return {
                ...ref,
                isIncluded,
                hasParentValue,
                displayLabel,
                parentSummary,
                childOptions,
                selectedChildRelationship,
                showControls: isIncluded && hasParentValue
            };
        });
    }

    buildParentChildOptions(parentObjectApiName, selectedValue) {
        const options = [{ label: '(none)', value: '' }];
        const cached = this.parentChildRelationshipsCache[parentObjectApiName];
        if (Array.isArray(cached)) {
            for (const rel of cached) {
                options.push({
                    label: rel.childObjectLabel || rel.relationshipName,
                    value: rel.relationshipName
                });
            }
        } else if (selectedValue) {
            // Ensure the selected value still shows up even before options load.
            options.push({ label: selectedValue, value: selectedValue });
        }
        return options;
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
            countUnavailable: rel.countStatus === 'unknown',
            displayCount: this.isRelationshipCountKnown(rel)
                ? `(${rel.recordCount})`
                : ''
        }));
    }

    get showRelationshipCountNote() {
        return !this.hideContextWarningsEnabled
            && Boolean(this.availableContext?.recordId)
            && this.relationshipsWithState.some(rel => rel.countUnavailable);
    }

    get relationshipCountNote() {
        return 'Some relationship counts are unavailable and are shown without counts.';
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
        if (
            this.fieldSelectionMode === 'fields'
            && Array.isArray(this.includedFields)
            && this.includedFields.length > 0
        ) {
            return this.includedFields.length;
        }
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
        const overrideFieldCount = Array.isArray(this.includedFields)
            ? this.includedFields.length
            : 0;
        const hasFieldOverride =
            this.fieldSelectionMode === 'fields' && overrideFieldCount > 0;
        if (hasFieldOverride) {
            tokens += overrideFieldCount * 15;
        } else {
            const included = new Set(this.includedCategories);
            if (this.availableContext?.fieldCategories) {
                for (const cat of this.availableContext.fieldCategories) {
                    if (included.has(cat.name)) {
                        tokens += cat.fieldCount * 15;
                    }
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

        // Parent records: ~200 tokens per selected parent for field data.
        const parentRefIncluded = new Set(this.includedParentReferenceFields);
        const siblingsEnabled = this.isBooleanEnabled(this.includeSameObjectSiblingsThroughParents);
        const siblingRelMap = this.parentSiblingRelationshipByReferenceField || {};
        if (this.availableContext?.parentReferences) {
            for (const ref of this.availableContext.parentReferences) {
                if (!parentRefIncluded.has(ref.referenceFieldApiName)) continue;
                tokens += 200;
                if (siblingsEnabled) {
                    tokens += 500; // estimated cost for up to ~5 sibling records
                }
                if (siblingRelMap[ref.referenceFieldApiName]) {
                    tokens += 600; // estimated cost for child-relationship expansion under the parent
                }
            }
        }
        return tokens > 0 ? tokens : null;
    }

    get tokenMeterWidth() {
        const baseTokens = this.tokenMeterBaseTokens;
        const pct = baseTokens > 0
            ? Math.min((this.tokenEstimate || 0) / baseTokens * 100, 100)
            : 0;
        return `width: ${pct}%`;
    }

    get tokenMeterFillClass() {
        if (this.tokenWarningThresholdValue === 0) {
            return 'token-meter-fill meter-fill-green';
        }

        const baseTokens = this.tokenMeterBaseTokens;
        const pct = baseTokens > 0
            ? (this.tokenEstimate || 0) / baseTokens * 100
            : 0;
        let color = 'meter-fill-green';
        if (pct > 75) color = 'meter-fill-red';
        else if (pct > 50) color = 'meter-fill-yellow';
        return `token-meter-fill ${color}`;
    }

    get tokenMeterBaseTokens() {
        if (this.tokenWarningThresholdValue > 0) {
            return this.tokenWarningThresholdValue;
        }
        return this.tokenEstimate || 0;
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

    isRelationshipCountKnown(relationship) {
        return relationship?.countStatus !== 'unknown'
            && typeof relationship.recordCount === 'number'
            && relationship.recordCount >= 0;
    }

    toggleFieldsSection() { this.fieldsExpanded = !this.fieldsExpanded; }
    toggleRelationshipsSection() { this.relationshipsExpanded = !this.relationshipsExpanded; }
    toggleParentsSection() {
        this.parentsExpanded = !this.parentsExpanded;
        if (this.parentsExpanded) {
            this.prefetchParentChildRelationshipsForSelected();
        }
    }

    handleParentReferenceToggle(event) {
        const refApiName = event.target.dataset.reference;
        const isChecked = event.target.checked;
        let updated = [...(this.includedParentReferenceFields || [])];

        if (isChecked && !updated.includes(refApiName)) {
            updated.push(refApiName);
            this.loadParentChildRelationshipsFor(refApiName);
        } else if (!isChecked) {
            updated = updated.filter(r => r !== refApiName);
        }

        this.dispatchParentChange({ includedParentReferenceFields: updated });
    }

    handleSameObjectSiblingsToggle(event) {
        const isChecked = event.target.checked;
        this.dispatchParentChange({ includeSameObjectSiblingsThroughParents: isChecked });
    }

    handleParentChildRelationshipChange(event) {
        const refApiName = event.target.dataset.reference;
        const value = event.target.value || '';
        const current = { ...(this.parentSiblingRelationshipByReferenceField || {}) };
        if (value) {
            current[refApiName] = value;
        } else {
            delete current[refApiName];
        }
        this.dispatchParentChange({ parentSiblingRelationshipByReferenceField: current });
    }

    dispatchParentChange(partialDetail) {
        this.dispatchEvent(new CustomEvent('parentcontextchange', {
            detail: {
                includedParentReferenceFields: this.includedParentReferenceFields,
                includeSameObjectSiblingsThroughParents: this.includeSameObjectSiblingsThroughParents,
                parentSiblingRelationshipByReferenceField: this.parentSiblingRelationshipByReferenceField,
                ...partialDetail
            }
        }));
    }

    prefetchParentChildRelationshipsForSelected() {
        const refs = this.includedParentReferenceFields || [];
        for (const ref of refs) {
            this.loadParentChildRelationshipsFor(ref);
        }
    }

    async loadParentChildRelationshipsFor(referenceFieldApiName) {
        const parentRef = (this.availableContext?.parentReferences || [])
            .find(r => r.referenceFieldApiName === referenceFieldApiName);
        if (!parentRef || !parentRef.parentObjectApiName) return;
        const parentObjectApiName = parentRef.parentObjectApiName;
        if (this.parentChildRelationshipsCache[parentObjectApiName]) return;
        if (this.loadingParentChildFor.has(parentObjectApiName)) return;

        this.loadingParentChildFor.add(parentObjectApiName);
        try {
            const result = await getParentChildRelationships({ parentObjectApiName });
            this.parentChildRelationshipsCache = {
                ...this.parentChildRelationshipsCache,
                [parentObjectApiName]: Array.isArray(result) ? result : []
            };
        } catch (error) {
            this.parentChildRelationshipsCache = {
                ...this.parentChildRelationshipsCache,
                [parentObjectApiName]: []
            };
        } finally {
            this.loadingParentChildFor.delete(parentObjectApiName);
        }
    }

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
