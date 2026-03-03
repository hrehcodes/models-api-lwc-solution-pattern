import { LightningElement, api } from 'lwc';
import AGENTFORCE_ICON from '@salesforce/resourceUrl/Agentforce_Icon';
import getAvailableContext from '@salesforce/apex/RecordContextService.getAvailableContext';
import getRecordContext from '@salesforce/apex/RecordContextService.getRecordContext';

export default class AgentforceRecordInsights extends LightningElement {
    agentforceIcon = AGENTFORCE_ICON;

    @api recordId;
    @api objectApiName;
    @api cardTitle = 'Agentforce Record Insights';
    @api defaultDepth = 1;
    @api defaultMode = 'insights';

    mode = 'insights';
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

    selectedObjectType = '';
    manualRecordId = '';
    activeRecordId;
    activeObjectApiName;
    activeRecordName;

    _contextLoadTimeout;

    objectTypeOptions = [
        { label: 'Account', value: 'Account' },
        { label: 'Opportunity', value: 'Opportunity' },
        { label: 'Contact', value: 'Contact' },
        { label: 'Case', value: 'Case' },
        { label: 'Lead', value: 'Lead' },
        { label: 'Custom Object (enter ID)', value: 'custom' }
    ];

    connectedCallback() {
        this.mode = this.recordId ? 'insights' : (this.defaultMode || 'compare');
        this.currentDepth = this.defaultDepth || 1;

        if (this.recordId) {
            this.activeRecordId = this.recordId;
            this.activeObjectApiName = this.objectApiName;
            this.loadAvailableContext();
        }
    }

    get isInsightsMode() { return this.mode === 'insights'; }
    get isCompareMode() { return this.mode === 'compare'; }
    get insightsButtonVariant() { return this.mode === 'insights' ? 'brand' : 'neutral'; }
    get compareButtonVariant() { return this.mode === 'compare' ? 'brand' : 'neutral'; }

    get showSettingsButton() {
        return this.isInsightsMode && this.hasRecordContext;
    }

    get needsRecordSelection() {
        return !this.activeRecordId && !this.isLoadingContext && !this.contextError;
    }

    get hasRecordContext() {
        return this.activeRecordId && this.availableContext && !this.isLoadingContext && !this.contextError;
    }

    get showFieldSelectorSafe() {
        return this.showFieldSelector && this.availableContext;
    }

    get loadRecordDisabled() { return !this.manualRecordId; }
    get contextToggleVariant() { return this.contextPanelOpen ? 'brand' : 'border'; }

    get layoutClass() {
        return this.contextPanelOpen
            ? 'layout-with-context'
            : 'layout-chat-only';
    }

    get storageKey() {
        return this.activeRecordId ? `ari_chat_${this.activeRecordId}` : null;
    }

    get compareStorageKey() {
        return this.activeRecordId ? `ari_compare_${this.activeRecordId}` : 'ari_compare_app';
    }

    handleInsightsMode() { this.mode = 'insights'; }
    handleCompareMode() { this.mode = 'compare'; }
    handleToggleContext() { this.contextPanelOpen = !this.contextPanelOpen; }

    handleObjectTypeChange(event) { this.selectedObjectType = event.detail.value; }
    handleManualRecordIdChange(event) { this.manualRecordId = event.detail.value; }

    handleLoadManualRecord() {
        if (this.manualRecordId) {
            this.activeRecordId = this.manualRecordId;
            this.activeObjectApiName = this.selectedObjectType === 'custom' ? null : this.selectedObjectType;
            this.loadAvailableContext();
        }
    }

    async loadAvailableContext() {
        this.isLoadingContext = true;
        this.contextError = null;
        this.availableContext = null;
        this.recordContextJson = null;

        try {
            const ctx = await getAvailableContext({ recordId: this.activeRecordId });
            this.availableContext = ctx;
            this.activeObjectApiName = ctx.objectApiName;
            this.activeRecordName = ctx.recordName;

            this.includedCategories = ctx.fieldCategories
                .filter(cat => cat.includedByDefault)
                .map(cat => cat.name);

            this.includedRelationships = ctx.relationships
                .filter(rel => rel.includedByDefault)
                .map(rel => rel.relationshipName);

            await this.loadRecordContext();
        } catch (error) {
            this.contextError = this.extractErrorMessage(error);
        } finally {
            this.isLoadingContext = false;
        }
    }

    async loadRecordContext() {
        try {
            const ctx = await getRecordContext({
                recordId: this.activeRecordId,
                depth: this.currentDepth,
                includedCategories: this.includedCategories,
                includedRelationships: this.includedRelationships
            });
            this.recordContextJson = JSON.stringify(ctx);
        } catch (error) {
            console.error('Error loading record context:', error);
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
        this.currentDepth = event.detail.depth;
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

    extractErrorMessage(error) {
        if (typeof error === 'string') return error;
        if (error?.body?.message) return error.body.message;
        if (error?.message) return error.message;
        return 'An unexpected error occurred.';
    }
}
