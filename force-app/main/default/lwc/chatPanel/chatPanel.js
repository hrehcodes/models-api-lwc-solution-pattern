import { LightningElement, api, track } from 'lwc';
import AGENTFORCE_ICON from '@salesforce/resourceUrl/Agentforce_Icon';
import MODEL_LOGO_AMAZON from '@salesforce/resourceUrl/ModelLogoAmazon';
import MODEL_LOGO_ANTHROPIC from '@salesforce/resourceUrl/ModelLogoAnthropic';
import MODEL_LOGO_GOOGLE from '@salesforce/resourceUrl/ModelLogoGoogle';
import MODEL_LOGO_NVIDIA from '@salesforce/resourceUrl/ModelLogoNvidia';
import MODEL_LOGO_OPENAI from '@salesforce/resourceUrl/ModelLogoOpenAI';
import sendMessage from '@salesforce/apex/RecordAdvisorController.sendMessage';
import sendCompareMessage from '@salesforce/apex/RecordAdvisorController.sendCompareMessage';
import compareModels from '@salesforce/apex/RecordAdvisorController.compareModels';
import generateFollowUpPrompts from '@salesforce/apex/RecordAdvisorController.generateFollowUpPrompts';
import getAvailableModels from '@salesforce/apex/RecordAdvisorController.getAvailableModels';

const SUGGESTED_PROMPTS = {
    Account: [
        { id: 'a1', text: 'Give me a complete overview of this account.' },
        { id: 'a2', text: 'What opportunities are in the pipeline?' },
        { id: 'a3', text: 'Are there any open support cases I should know about?' },
        { id: 'a4', text: 'Summarize the recent engagement activity.' }
    ],
    Opportunity: [
        { id: 'o1', text: 'What is the current status of this deal?' },
        { id: 'o2', text: 'What risks do you see with this opportunity?' },
        { id: 'o3', text: 'Summarize the engagement history and next steps.' },
        { id: 'o4', text: 'Who are the key stakeholders and their roles?' }
    ],
    Contact: [
        { id: 'c1', text: 'Give me a summary of this contact and their engagement.' },
        { id: 'c2', text: 'What open cases or activities are associated?' },
        { id: 'c3', text: 'What is this contact\'s role in their organization?' }
    ],
    Case: [
        { id: 'cs1', text: 'Summarize this case and its current status.' },
        { id: 'cs2', text: 'What has been done so far to resolve this?' },
        { id: 'cs3', text: 'Are there similar cases or patterns?' }
    ],
    default: [
        { id: 'd1', text: 'Give me a complete overview of this record.' },
        { id: 'd2', text: 'What are the key things I should know?' },
        { id: 'd3', text: 'Are there any risks or concerns?' }
    ],
    compare: [
        { id: 'cmp1', text: 'Compare these records and highlight key differences.' },
        { id: 'cmp2', text: 'Which record should I prioritize and why?' },
        { id: 'cmp3', text: 'What patterns or trends do you see across these records?' }
    ]
};

const MODEL_CREDIT_MAP = {};
const MODEL_LOGO_MAP = {
    amazon: MODEL_LOGO_AMAZON,
    aws: MODEL_LOGO_AMAZON,
    anthropic: MODEL_LOGO_ANTHROPIC,
    claude: MODEL_LOGO_ANTHROPIC,
    google: MODEL_LOGO_GOOGLE,
    gemini: MODEL_LOGO_GOOGLE,
    nvidia: MODEL_LOGO_NVIDIA,
    openai: MODEL_LOGO_OPENAI
};
const DEFAULT_MODEL_SET_NAME = 'Default';
const PROMPT_OVERHEAD_TOKENS = 800;
const PROGRESS_ROTATION_MS = 1700;
const PROGRESS_MESSAGES = [
    'Preparing selected record context',
    'Sending grounded prompt to the model',
    'Reviewing related records',
    'Drafting response',
    'Preparing suggested follow-ups'
];
const ANSWER_DENSITY_OPTIONS = [
    {
        value: 'brief',
        label: 'Brief',
        description: 'Concise answer with only the most important facts.'
    },
    {
        value: 'standard',
        label: 'Standard',
        description: 'Balanced answer with key observations and next steps.'
    },
    {
        value: 'detailed',
        label: 'Detailed',
        description: 'Expanded rationale, caveats, and supporting context.'
    }
];

export default class ChatPanel extends LightningElement {
    agentforceIcon = AGENTFORCE_ICON;

    @api recordContextJson;
    @api objectApiName;
    @api recordName;
    @api mode = 'insights';
    @api comparisonContextJson;
    @api showModelPicker;
    @api defaultModelApiName;
    @api showSuggestedPrompts;
    @api showInlineUsageStatus = false;
    @api persistConversation;
    @api enableSuggestedFollowUps;
    @api contextStatus;
    @api contextWarningSummary;
    @api contextWarningMessages = [];
    @api hideContextWarnings;
    @api tokenWarningThreshold = 20000;
    @api enableSourceGrounding;
    @api enableModelComparison = false;
    @api showContextPreview;
    @api showAnswerDensityToggle;
    @api answerDensityLabel = 'Answer length';
    @api answerDensityHelpText = 'Controls how much detail the AI asks the model to include. Brief is shorter, while Detailed includes more rationale and caveats.';
    @api contextTokenEstimate;
    @api sessionTokenWarningThreshold = 50000;
    @api sessionCreditWarningThreshold = 100;

    @track messages = [];
    userInput = '';
    isLoading = false;
    selectedModel = null;
    secondarySelectedModel = null;
    @track modelOptions = [];
    @track followUpPrompts = [];
    sessionTokens = 0;
    sessionCredits = 0;
    showLargePromptWarningModal = false;
    pendingLargePromptText;
    pendingLargePromptTokenEstimate = 0;
    isModelPickerOpen = false;
    isAnswerDensityPickerOpen = false;
    isCompareSettingsOpen = false;
    isPromptReadinessExpanded = false;
    useModelComparison = false;
    isContextPreviewExpanded = false;
    isFollowUpExpanded = false;
    progressMessageIndex = 0;
    selectedAnswerDensity = 'standard';

    _messageCounter = 0;
    _modelData = [];
    _storageKey;
    _modelSetName = DEFAULT_MODEL_SET_NAME;
    _isConnected = false;
    _modelLoadRequestId = 0;
    _progressInterval;

    @api
    get storageKey() {
        return this._storageKey;
    }
    set storageKey(value) {
        const previousValue = this._storageKey;
        this._storageKey = value;

        // Reload persisted state when the parent switches records in-place.
        if (previousValue !== undefined && previousValue !== value) {
            this.resetForStorageChange();
        }
    }

    @api
    get modelSetName() {
        return this._modelSetName;
    }
    set modelSetName(value) {
        const normalizedValue = this.normalizeModelSetName(value);
        if (normalizedValue === this._modelSetName) {
            return;
        }

        this._modelSetName = normalizedValue;
        if (this._isConnected) {
            this.loadModelOptions();
        }
    }

    connectedCallback() {
        this._isConnected = true;
        this.loadModelOptions();
        if (!this.persistConversationEnabled) {
            this.clearPersistedState();
        }
        this.loadConversation();
        this.loadUsageMetrics();
    }

    disconnectedCallback() {
        this.stopProgressCarousel();
    }

    async loadModelOptions() {
        const requestId = ++this._modelLoadRequestId;
        try {
            const data = await getAvailableModels({ modelSetName: this.modelSetName });
            if (requestId !== this._modelLoadRequestId) {
                return;
            }
            this.applyModelData(data || []);
        } catch (error) {
            if (requestId !== this._modelLoadRequestId) {
                return;
            }
            this.applyFallbackModelOptions();
        }
    }

    applyModelData(data) {
        this._modelData = data;
        this.modelOptions = data.map(m => ({
            label: `${m.label} (${m.provider}) [${m.creditType}]`,
            value: m.apiName
        }));
        data.forEach(m => { MODEL_CREDIT_MAP[m.apiName] = m.creditType; });
        this.applyPreferredModelSelection(data.map(m => m.apiName));
    }

    applyFallbackModelOptions() {
        const fallbackData = [
            {
                label: 'Gemini 3.1 Pro',
                provider: 'Google',
                creditType: 'standard',
                apiName: 'sfdc_ai__DefaultVertexAIGeminiPro31'
            },
            {
                label: 'GPT-4o',
                provider: 'OpenAI',
                creditType: 'standard',
                apiName: 'sfdc_ai__DefaultGPT4Omni'
            }
        ];
        this._modelData = fallbackData;
        this.modelOptions = fallbackData.map(m => ({
            label: `${m.label} (${m.provider}) [${m.creditType}]`,
            value: m.apiName
        }));
        fallbackData.forEach(m => { MODEL_CREDIT_MAP[m.apiName] = m.creditType; });
        this.applyPreferredModelSelection(
            this.modelOptions.map(option => option.value),
            this.modelOptions[0]?.value
        );
    }

    resetForStorageChange() {
        this.messages = [];
        this.followUpPrompts = [];
        this.isFollowUpExpanded = false;
        this.sessionTokens = 0;
        this.sessionCredits = 0;
        this._messageCounter = 0;
        this.dispatchUsageUpdate();
        this.loadConversation();
        this.loadUsageMetrics();
        this.scrollToBottom();
    }

    // ── Getters ──

    get showWelcome() {
        return this.messages.length === 0 && !this.isLoading;
    }

    get hasMessages() {
        return this.messages.length > 0;
    }

    get showModelBar() {
        return this.showModelPickerEnabled || this.hasMessages || this.showModelComparisonControls;
    }

    get sendDisabled() {
        return !this.userInput?.trim() || this.isLoading;
    }

    get inputPlaceholder() {
        return this.mode === 'compare'
            ? 'Ask a question about these records...'
            : `Ask about ${this.recordName || 'this record'}...`;
    }

    get suggestedPrompts() {
        if (this.mode === 'compare') return SUGGESTED_PROMPTS.compare;
        return SUGGESTED_PROMPTS[this.objectApiName] || SUGGESTED_PROMPTS.default;
    }

    get hasGroundedContext() {
        if (this.mode === 'compare') {
            return Boolean(this.comparisonContextJson);
        }
        return Boolean(this.recordContextJson);
    }

    get showSuggestedPromptButtons() {
        return this.hasGroundedContext
            && this.showSuggestedPromptsEnabled
            && this.suggestedPrompts.length > 0;
    }

    get followUpPromptsKeyed() {
        return this.followUpPrompts.map((text, idx) => ({ id: `fp_${idx}`, text }));
    }

    get hasFollowUpPrompts() {
        return this.hasGroundedContext
            && this.enableSuggestedFollowUpsEnabled
            && this.followUpPromptsKeyed.length > 0;
    }

    get showModelPickerEnabled() {
        return this.isBooleanEnabled(this.showModelPicker);
    }

    get selectedModelData() {
        return this._modelData.find(model => model.apiName === this.selectedModel);
    }

    get selectedModelLabel() {
        return this.selectedModelData?.label || 'Choose model';
    }

    get selectedModelMeta() {
        const model = this.selectedModelData;
        if (!model) {
            return 'Model catalog';
        }
        const provider = model.provider || 'Provider';
        const tier = this.formatCreditTier(model.creditType);
        return `${provider} · ${tier}`;
    }

    get selectedModelInitial() {
        const label = this.selectedModelLabel || 'M';
        return label.trim().slice(0, 1).toUpperCase();
    }

    get selectedModelLogo() {
        return this.resolveModelLogo(this.selectedModelData);
    }

    get selectedModelLogoAlt() {
        const model = this.selectedModelData;
        const provider = model?.provider || model?.label || 'Selected model';
        return `${provider} logo`;
    }

    get modelPickerItems() {
        const data = this._modelData.length
            ? this._modelData
            : this.modelOptions.map(option => ({
                label: option.label,
                apiName: option.value,
                provider: '',
                creditType: MODEL_CREDIT_MAP[option.value] || 'standard'
            }));

        return data.map(model => {
            const isActive = model.apiName === this.selectedModel;
            return {
                id: model.apiName,
                label: model.label,
                provider: model.provider || 'Configured model',
                creditLabel: this.formatCreditTier(model.creditType),
                logo: this.resolveModelLogo(model),
                logoAlt: `${model.provider || model.label || 'Model'} logo`,
                itemClass: isActive ? 'model-option model-option-active' : 'model-option',
                isActive
            };
        });
    }

    get modelPickerButtonClass() {
        return this.isModelPickerOpen
            ? 'model-picker-button model-picker-button-open'
            : 'model-picker-button';
    }

    get secondaryModelOptions() {
        return this.modelOptions
            .filter(option => option.value !== this.selectedModel)
            .map(option => ({ label: option.label, value: option.value }));
    }

    get secondaryModelData() {
        return this._modelData.find(model => model.apiName === this.secondarySelectedModel);
    }

    get secondaryModelLabel() {
        return this.secondaryModelData?.label
            || this.secondaryModelOptions.find(option => option.value === this.secondarySelectedModel)?.label
            || 'Second model';
    }

    get secondaryModelMeta() {
        const model = this.secondaryModelData;
        if (!model) {
            return 'Choose another model';
        }
        return `${model.provider || 'Provider'} · ${this.formatCreditTier(model.creditType)}`;
    }

    get showModelComparisonControls() {
        return this.enableModelComparisonEnabled && this.showModelPickerEnabled && this.modelOptions.length > 1;
    }

    get showSecondaryModelPicker() {
        return this.showModelComparisonControls && this.useModelComparison;
    }

    get modelComparisonLabel() {
        return this.useModelComparison ? 'Comparing models' : 'Compare models';
    }

    get compareSettingsButtonClass() {
        return this.isCompareSettingsOpen
            ? 'compare-settings-button compare-settings-button-open'
            : 'compare-settings-button';
    }

    get compareSettingsLabel() {
        return this.useModelComparison ? 'Comparing models' : 'Compare models';
    }

    get compareSettingsMeta() {
        return this.useModelComparison
            ? `${this.selectedModelLabel} + ${this.secondaryModelLabel}`
            : 'Single model response';
    }

    get compareSettingsButtonLabel() {
        return `${this.compareSettingsLabel}: ${this.compareSettingsMeta}`;
    }

    get compareSettingsCostLabel() {
        if (!this.hasGroundedContext) {
            return 'Load context to estimate usage.';
        }
        if (!this.useModelComparison) {
            return `Single-model prompt estimate: ~${this.comparePromptTokenEstimate.toLocaleString()} tokens and ~${this.estimateCreditsForModel(this.comparePromptTokenEstimate, this.selectedModel).toLocaleString()} credits.`;
        }
        return `Dual-model prompt estimate: ~${(this.comparePromptTokenEstimate * 2).toLocaleString()} total tokens and ~${this.comparePromptCreditEstimate.toLocaleString()} credits.`;
    }

    get showAnswerDensityToggleEnabled() {
        return this.showAnswerDensityToggle !== false && this.showAnswerDensityToggle !== 'false';
    }

    get selectedAnswerDensityOption() {
        return ANSWER_DENSITY_OPTIONS.find(option => option.value === this.selectedAnswerDensity)
            || ANSWER_DENSITY_OPTIONS.find(option => option.value === 'standard')
            || ANSWER_DENSITY_OPTIONS[0];
    }

    get selectedAnswerDensityLabel() {
        return this.selectedAnswerDensityOption?.label || 'Standard';
    }

    get answerDensityButtonClass() {
        return this.isAnswerDensityPickerOpen
            ? 'answer-density-button answer-density-button-open'
            : 'answer-density-button';
    }

    get answerDensityButtonLabel() {
        return `${this.normalizedAnswerDensityLabel}: ${this.selectedAnswerDensityLabel}`;
    }

    get answerDensityPickerItems() {
        return ANSWER_DENSITY_OPTIONS.map(option => ({
            ...option,
            id: `density_${option.value}`,
            isActive: option.value === this.selectedAnswerDensity,
            itemClass: option.value === this.selectedAnswerDensity
                ? 'answer-density-option answer-density-option-active'
                : 'answer-density-option'
        }));
    }

    get normalizedAnswerDensityLabel() {
        return (this.answerDensityLabel || 'Answer length').trim() || 'Answer length';
    }

    get normalizedAnswerDensityHelpText() {
        return (this.answerDensityHelpText || 'Controls how much detail the AI asks the model to include. Brief is shorter, while Detailed includes more rationale and caveats.').trim();
    }

    get sourceGroundingEnabled() {
        return this.isBooleanEnabled(this.enableSourceGrounding);
    }

    get enableModelComparisonEnabled() {
        return this.isBooleanEnabled(this.enableModelComparison);
    }

    get showContextPreviewEnabled() {
        return this.isBooleanEnabled(this.showContextPreview);
    }

    get normalizedContextTokenEstimate() {
        const explicitEstimate = parseInt(this.contextTokenEstimate, 10);
        if (!Number.isNaN(explicitEstimate) && explicitEstimate > 0) {
            return explicitEstimate;
        }
        return null;
    }

    get contextPreview() {
        const payload = this.getActiveContextPayload();
        const summary = payload?.selectionSummary || {};
        const sources = payload?.sourceRegistry || [];
        const tokenEstimate = this.estimateContextTokens();
        const selectedFields = summary.selectedFields?.length
            ? summary.selectedFields.length
            : this.countPayloadFields(payload);
        const selectedRelationships = summary.selectedRelationships?.length || 0;
        const parentRefs = summary.selectedParentReferenceFields?.length || summary.selectedParentReferences?.length || 0;
        return {
            title: this.mode === 'compare' ? 'Comparison context preview' : 'Context preview',
            modeLabel: this.mode === 'compare' ? 'Compare mode' : 'Insights mode',
            objectLabel: summary.objectLabel || summary.objectApiName || this.objectApiName || 'Current object',
            recordLabel: summary.recordName || this.recordName || `${summary.comparedRecordCount || 0} records`,
            fieldLabel: selectedFields === 1 ? '1 field source' : `${selectedFields.toLocaleString()} field sources`,
            relationshipLabel: selectedRelationships === 1 ? '1 relationship' : `${selectedRelationships} relationships`,
            parentLabel: parentRefs === 1 ? '1 parent reference' : `${parentRefs} parent references`,
            sourceLabel: sources.length === 1 ? '1 citation source' : `${sources.length} citation sources`,
            tokenLabel: `~${tokenEstimate.toLocaleString()} context tokens`,
            warningLabel: summary.warningSummary || null
        };
    }

    get showContextPreviewCard() {
        return this.showContextPreviewEnabled && this.hasGroundedContext;
    }

    get showCompareCostBanner() {
        return this.useModelComparison && this.showModelComparisonControls && this.hasGroundedContext;
    }

    get comparePromptTokenEstimate() {
        return this.estimatePromptTokens(this.userInput || '');
    }

    get comparePromptCreditEstimate() {
        const tokens = this.comparePromptTokenEstimate;
        return this.estimateCreditsForModel(tokens, this.selectedModel)
            + this.estimateCreditsForModel(tokens, this.secondarySelectedModel);
    }

    get compareCostEstimateLabel() {
        return `Dual-model compare will send this context twice: ~${(this.comparePromptTokenEstimate * 2).toLocaleString()} total tokens and ~${this.comparePromptCreditEstimate.toLocaleString()} estimated credits.`;
    }

    get showPromptReadinessPanel() {
        return this.showUsageGuardrail || this.showCompareCostBanner || this.showContextPreviewCard;
    }

    get promptReadinessToggleIcon() {
        return this.isPromptReadinessExpanded ? 'utility:chevronup' : 'utility:chevrondown';
    }

    get promptReadinessToggleLabel() {
        return this.isPromptReadinessExpanded ? 'Collapse prompt readiness' : 'Expand prompt readiness';
    }

    get promptReadinessClass() {
        return this.showUsageGuardrail
            ? 'prompt-readiness-panel prompt-readiness-panel-warning'
            : 'prompt-readiness-panel';
    }

    get promptReadinessSummaryLabel() {
        const parts = [];
        const warningCount = this.usageGuardrailMessages.length;
        if (warningCount) {
            parts.push(`${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`);
        } else {
            parts.push('Ready');
        }
        if (this.showCompareCostBanner) {
            parts.push(`~${(this.comparePromptTokenEstimate * 2).toLocaleString()} tokens`);
            parts.push(`~${this.comparePromptCreditEstimate.toLocaleString()} credits`);
        } else if (this.showContextPreviewCard) {
            parts.push(this.contextPreview.tokenLabel);
        }
        return parts.join(' · ');
    }

    get contextPreviewToggleIcon() {
        return this.isContextPreviewExpanded ? 'utility:chevronup' : 'utility:chevrondown';
    }

    get contextPreviewToggleLabel() {
        return this.isContextPreviewExpanded ? 'Collapse context preview' : 'Expand context preview';
    }

    get contextPreviewSummaryLabel() {
        return `${this.contextPreview.fieldLabel} · ${this.contextPreview.relationshipLabel} · ${this.contextPreview.tokenLabel}`;
    }

    get followUpToggleIcon() {
        return this.isFollowUpExpanded ? 'utility:chevronup' : 'utility:chevrondown';
    }

    get followUpToggleLabel() {
        return this.isFollowUpExpanded ? 'Hide suggested follow-ups' : 'Show suggested follow-ups';
    }

    get followUpSummaryLabel() {
        const count = this.followUpPromptsKeyed.length;
        return count === 1 ? '1 suggestion ready' : `${count} suggestions ready`;
    }

    get normalizedSessionTokenWarningThreshold() {
        const parsedThreshold = parseInt(this.sessionTokenWarningThreshold, 10);
        if (Number.isNaN(parsedThreshold)) {
            return 50000;
        }
        return Math.max(parsedThreshold, 0);
    }

    get normalizedSessionCreditWarningThreshold() {
        const parsedThreshold = parseInt(this.sessionCreditWarningThreshold, 10);
        if (Number.isNaN(parsedThreshold)) {
            return 100;
        }
        return Math.max(parsedThreshold, 0);
    }

    get usageGuardrailMessages() {
        const messages = [];
        if (this.normalizedSessionTokenWarningThreshold > 0
            && this.sessionTokens >= this.normalizedSessionTokenWarningThreshold) {
            messages.push(`Session token estimate is over ${this.normalizedSessionTokenWarningThreshold.toLocaleString()}.`);
        }
        if (this.normalizedSessionCreditWarningThreshold > 0
            && this.sessionCredits >= this.normalizedSessionCreditWarningThreshold) {
            messages.push(`Session flex credit estimate is over ${this.normalizedSessionCreditWarningThreshold.toLocaleString()}.`);
        }
        return messages.map((message, index) => ({ id: `guardrail_${index}`, message }));
    }

    get showUsageGuardrail() {
        return this.usageGuardrailMessages.length > 0;
    }

    get currentProgressMessage() {
        return PROGRESS_MESSAGES[this.progressMessageIndex] || PROGRESS_MESSAGES[0];
    }

    get showSuggestedPromptsEnabled() {
        return this.isBooleanEnabled(this.showSuggestedPrompts);
    }

    get persistConversationEnabled() {
        return this.isBooleanEnabled(this.persistConversation);
    }

    get showInlineUsageStatusEnabled() {
        return this.showInlineUsageStatus === true || this.showInlineUsageStatus === 'true';
    }

    get enableSuggestedFollowUpsEnabled() {
        return this.isBooleanEnabled(this.enableSuggestedFollowUps);
    }

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

    get normalizedTokenWarningThreshold() {
        const parsedThreshold = parseInt(this.tokenWarningThreshold, 10);
        if (Number.isNaN(parsedThreshold)) {
            return 20000;
        }
        return Math.max(parsedThreshold, 0);
    }

    get largePromptWarningHeading() {
        return `This prompt is estimated at ~${this.pendingLargePromptTokenEstimate.toLocaleString()} tokens.`;
    }

    get largePromptWarningBody() {
        return `That exceeds the configured warning threshold of ${this.normalizedTokenWarningThreshold.toLocaleString()} tokens. Large prompts can be slower, use more flex credits, and may cause some context to be truncated before the model responds.`;
    }

    get formattedSessionTokens() {
        return this.formatMetricValue(this.sessionTokens);
    }

    get formattedSessionCredits() {
        return this.formatMetricValue(this.sessionCredits);
    }

    // ── Event Handlers ──

    handleModelPickerToggle() {
        this.isModelPickerOpen = !this.isModelPickerOpen;
        if (this.isModelPickerOpen) {
            this.isAnswerDensityPickerOpen = false;
            this.isCompareSettingsOpen = false;
        }
    }

    handleModelPickerClose() {
        this.isModelPickerOpen = false;
    }

    handleModelSelect(event) {
        const modelId = event.currentTarget?.dataset?.modelId;
        if (!modelId) {
            return;
        }
        this.selectedModel = modelId;
        this.ensureSecondaryModelSelection();
        this.isModelPickerOpen = false;
    }

    handleAnswerDensityToggle() {
        this.isAnswerDensityPickerOpen = !this.isAnswerDensityPickerOpen;
        if (this.isAnswerDensityPickerOpen) {
            this.isModelPickerOpen = false;
            this.isCompareSettingsOpen = false;
        }
    }

    handleAnswerDensityClose() {
        this.isAnswerDensityPickerOpen = false;
    }

    handleAnswerDensitySelect(event) {
        const value = event.currentTarget?.dataset?.densityValue;
        if (!value) {
            return;
        }
        this.selectedAnswerDensity = value;
        this.isAnswerDensityPickerOpen = false;
    }

    handleCompareSettingsToggle() {
        this.isCompareSettingsOpen = !this.isCompareSettingsOpen;
        if (this.isCompareSettingsOpen) {
            this.isModelPickerOpen = false;
            this.isAnswerDensityPickerOpen = false;
        }
    }

    handleCompareSettingsClose() {
        this.isCompareSettingsOpen = false;
    }

    handleModelComparisonToggle(event) {
        this.useModelComparison = event.target.checked;
        this.ensureSecondaryModelSelection();
    }

    handleSecondaryModelChange(event) {
        this.secondarySelectedModel = event.detail.value;
    }

    handleToggleContextPreview() {
        this.isContextPreviewExpanded = !this.isContextPreviewExpanded;
    }

    handleTogglePromptReadiness() {
        this.isPromptReadinessExpanded = !this.isPromptReadinessExpanded;
    }

    handleToggleFollowUps() {
        this.isFollowUpExpanded = !this.isFollowUpExpanded;
    }

    handleToggleMessageSources(event) {
        const messageId = event.currentTarget?.dataset?.messageId;
        if (!messageId) {
            return;
        }

        this.messages = this.messages.map(message => {
            if (message.id !== messageId) {
                return message;
            }
            const sourcesExpanded = !message.sourcesExpanded;
            return this.withSourceDisclosureState(message, sourcesExpanded);
        });
    }

    handleToggleComparisonSources(event) {
        const messageId = event.currentTarget?.dataset?.messageId;
        const cardId = event.currentTarget?.dataset?.cardId;
        if (!messageId || !cardId) {
            return;
        }

        this.messages = this.messages.map(message => {
            if (message.id !== messageId || !Array.isArray(message.comparisonCards)) {
                return message;
            }
            return {
                ...message,
                comparisonCards: message.comparisonCards.map(card => {
                    if (card.id !== cardId) {
                        return card;
                    }
                    const sourcesExpanded = !card.sourcesExpanded;
                    return this.withSourceDisclosureState(card, sourcesExpanded);
                })
            };
        });
    }

    handleInputChange(event) {
        this.userInput = event.target.value;
        this.resizeInput(event.target);
    }

    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey && !this.sendDisabled) {
            event.preventDefault();
            this.handleSend();
        }
    }

    handleSuggestedPrompt(event) {
        this.userInput = event.currentTarget?.dataset?.prompt;
        this.handleSend();
    }

    handleFollowUpPrompt(event) {
        this.userInput = event.currentTarget?.dataset?.prompt;
        this.followUpPrompts = [];
        this.isFollowUpExpanded = false;
        this.handleSend();
    }

    async handleSend() {
        const text = this.userInput?.trim();
        if (!text) return;

        const promptTokenEstimate = this.estimatePromptTokens(text);
        if (this.shouldWarnAboutLargePrompt(promptTokenEstimate)) {
            this.pendingLargePromptText = text;
            this.pendingLargePromptTokenEstimate = promptTokenEstimate;
            this.showLargePromptWarningModal = true;
            return;
        }

        await this.sendPrompt(text);
    }

    async handleContinueLargePrompt() {
        const text = this.pendingLargePromptText;
        this.showLargePromptWarningModal = false;
        this.pendingLargePromptText = null;
        this.pendingLargePromptTokenEstimate = 0;

        if (!text) {
            return;
        }

        await this.sendPrompt(text);
    }

    handleCancelLargePrompt() {
        this.showLargePromptWarningModal = false;
        this.pendingLargePromptText = null;
        this.pendingLargePromptTokenEstimate = 0;
    }

    async sendPrompt(text) {
        if (!text) return;

        this.addMessage('user', text);
        this.userInput = '';
        this.followUpPrompts = [];
        this.isFollowUpExpanded = false;
        this.isLoading = true;
        this.startProgressCarousel();
        this.resetInputHeight();
        this.scrollToBottom();

        try {
            const historyJson = this.buildConversationHistory();
            const modelToUse = this.selectedModel || undefined;
            const promptText = this.buildPromptWithAnswerDensity(text);
            let result;

            if (this.useModelComparison && this.showModelComparisonControls) {
                this.ensureSecondaryModelSelection();
                result = await compareModels({
                    contextJson: this.getRequestContextJson(),
                    userMessage: promptText,
                    conversationHistoryJson: historyJson,
                    primaryModelApiName: modelToUse,
                    secondaryModelApiName: this.secondarySelectedModel,
                    mode: this.mode
                });
            } else if (this.mode === 'compare') {
                result = await sendCompareMessage({
                    comparisonContextJson: this.getRequestContextJson(),
                    userMessage: promptText,
                    conversationHistoryJson: historyJson,
                    modelApiName: modelToUse
                });
            } else {
                result = await sendMessage({
                    recordContextJson: this.getRequestContextJson(),
                    userMessage: promptText,
                    conversationHistoryJson: historyJson,
                    modelApiName: modelToUse
                });
            }

            if (result.success && result.results) {
                this.addModelComparisonMessage(result.results);
                this.trackComparisonUsage(result.results);
                if (this.enableSuggestedFollowUpsEnabled && this.hasGroundedContext) {
                    this.generateFollowUps();
                }
            } else if (result.success) {
                this.addMessage('assistant', result.response, this.buildAssistantMetadata(result));
                this.trackUsage(text, result.response, result);
                if (this.enableSuggestedFollowUpsEnabled && this.hasGroundedContext) {
                    this.generateFollowUps();
                }
            } else {
                this.addMessage('assistant', `Error: ${result.error || 'Failed to get response.'}`);
            }
        } catch (error) {
            const errMsg = error?.body?.message || error?.message || 'An unexpected error occurred.';
            this.addMessage('assistant', `Error: ${errMsg}`);
        } finally {
            this.isLoading = false;
            this.stopProgressCarousel();
            this.scrollToBottom();
        }
    }

    async handleRetryMessage() {
        const lastUserMsg = [...this.messages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg || this.isLoading) {
            return;
        }
        await this.handleRegenerate();
    }

    async handleRegenerate() {
        const lastUserMsg = [...this.messages].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return;

        const lastAssistantIdx = this.findLastAssistantIndex();
        if (lastAssistantIdx >= 0) {
            this.messages = this.messages.filter((_, i) => i !== lastAssistantIdx);
        }

        this.userInput = lastUserMsg.text;
        const lastUserIdx = this.messages.length - 1;
        if (this.messages[lastUserIdx]?.role === 'user') {
            this.messages = this.messages.slice(0, lastUserIdx);
        }

        await this.handleSend();
    }

    handleCopyMessage(event) {
        const idx = parseInt(event.currentTarget?.dataset?.index, 10);
        const msg = this.messages[idx];
        if (msg) {
            navigator.clipboard.writeText(msg.text);
        }
    }

    handleClearConversation() {
        this.messages = [];
        this.followUpPrompts = [];
        this.isFollowUpExpanded = false;
        this.sessionTokens = 0;
        this.sessionCredits = 0;
        this.saveConversation();
        this.saveUsageMetrics();
        this.dispatchUsageUpdate();
    }

    // ── Usage Tracking ──

    trackUsage(userText, assistantText, result = {}) {
        const contextTokens = this.estimateContextTokens();
        const messageTokens = Math.ceil((userText.length + assistantText.length) / 4);
        const totalTokens = result.estimatedTokens || (contextTokens + messageTokens);

        // Each 2,000-token chunk counts as one prompt (rounded up)
        const promptChunks = Math.ceil(totalTokens / 2000);

        // Flex credit cost per prompt chunk depends on model tier:
        //   Starter = 2 credits, Basic = 2 credits, Standard = 4 credits, Advanced = 16 credits
        const CREDIT_COSTS = { starter: 2, basic: 2, standard: 4, advanced: 16 };
        const creditType = MODEL_CREDIT_MAP[this.selectedModel] || 'standard';
        const costPerChunk = CREDIT_COSTS[creditType] || 4;
        const creditsUsed = result.estimatedCredits || (promptChunks * costPerChunk);

        this.sessionTokens += totalTokens;
        this.sessionCredits += creditsUsed;

        this.saveUsageMetrics();
        this.dispatchUsageUpdate();
    }

    trackComparisonUsage(results = []) {
        const successfulResults = results.filter(result => result.success);
        const totalTokens = successfulResults.reduce(
            (sum, result) => sum + (Number(result.estimatedTokens) || 0),
            0
        );
        const totalCredits = successfulResults.reduce(
            (sum, result) => sum + (Number(result.estimatedCredits) || 0),
            0
        );

        this.sessionTokens += totalTokens;
        this.sessionCredits += totalCredits;
        this.saveUsageMetrics();
        this.dispatchUsageUpdate();
    }

    estimateContextTokens() {
        if (this.mode !== 'compare' && this.normalizedContextTokenEstimate) {
            return this.normalizedContextTokenEstimate;
        }

        let contextSize = 0;
        if (this.mode === 'compare' && this.comparisonContextJson) {
            contextSize = this.comparisonContextJson.length;
        } else if (this.recordContextJson) {
            contextSize = this.recordContextJson.length;
        }
        return Math.ceil(contextSize / 4);
    }

    estimatePromptTokens(userText) {
        const historyJson = this.buildConversationHistory();
        const historyTokens = historyJson ? Math.ceil(historyJson.length / 4) : 0;
        const userTokens = userText ? Math.ceil(userText.length / 4) : 0;
        return this.estimateContextTokens() + historyTokens + userTokens + PROMPT_OVERHEAD_TOKENS;
    }

    estimateCreditsForModel(tokens, modelApiName) {
        const chunks = Math.max(1, Math.ceil((Number(tokens) || 0) / 2000));
        const model = this._modelData.find(item => item.apiName === modelApiName);
        const creditType = model?.creditType || MODEL_CREDIT_MAP[modelApiName] || 'standard';
        const costPerChunk = creditType === 'advanced' ? 16 : (creditType === 'basic' ? 2 : 4);
        return chunks * costPerChunk;
    }

    buildPromptWithAnswerDensity(text) {
        if (!this.showAnswerDensityToggleEnabled || this.selectedAnswerDensity === 'standard') {
            return text;
        }
        const instruction = this.selectedAnswerDensity === 'brief'
            ? 'Answer length preference: Brief. Keep the response concise and prioritize only the most important facts and next steps.'
            : 'Answer length preference: Detailed. Include more rationale, relevant caveats, and supporting context while staying grounded in the provided data.';
        return `${instruction}\n\nUser question: ${text}`;
    }

    shouldWarnAboutLargePrompt(promptTokenEstimate) {
        return this.normalizedTokenWarningThreshold > 0
            && promptTokenEstimate > this.normalizedTokenWarningThreshold;
    }

    dispatchUsageUpdate() {
        this.dispatchEvent(new CustomEvent('usageupdate', {
            detail: {
                sessionTokens: this.sessionTokens,
                sessionCredits: this.sessionCredits
            }
        }));
    }

    // ── Message Management ──

    findLastAssistantIndex() {
        for (let i = this.messages.length - 1; i >= 0; i--) {
            if (this.messages[i].role === 'assistant') return i;
        }
        return -1;
    }

    addMessage(role, text, metadata = {}) {
        this._messageCounter++;
        const citationItems = this.buildCitationItems(metadata.citations || []);
        const sourceDisclosureId = `${role}_sources_${this._messageCounter}`;
        const hasCitations = citationItems.length > 0;
        const formatted = {
            id: `msg_${this._messageCounter}_${Date.now()}`,
            role,
            text,
            timestamp: new Date().toISOString(),
            index: this.messages.length,
            containerClass: `message-row ${role === 'user' ? 'user-row' : 'assistant-row'}`,
            bubbleClass: `message-bubble ${role === 'user' ? 'user-bubble' : 'assistant-bubble'}`,
            isUser: role === 'user',
            isAssistant: role === 'assistant',
            isError: role === 'assistant' && this.isErrorMessage(text),
            htmlContent: role === 'assistant' ? this.renderMarkdown(text, citationItems) : null,
            citations: citationItems,
            hasCitations,
            sourcesExpanded: false,
            sourcesToggleIcon: 'utility:chevronright',
            sourcesToggleLabel: hasCitations ? this.buildSourcesToggleLabel(citationItems) : null,
            sourcesAriaLabel: 'Show grounding sources',
            sourceDisclosureId,
            modelLabel: metadata.modelLabel,
            metricsLabel: this.buildMetricsLabel(metadata),
            hasMetrics: Boolean(this.buildMetricsLabel(metadata)),
            isModelComparison: false,
            isLastAssistant: role === 'assistant',
            timestampLabel: this.formatMessageTimestamp(new Date())
        };

        if (role === 'assistant') {
            this.messages = this.messages.map(m => ({ ...m, isLastAssistant: false }));
        }

        this.messages = [...this.messages, formatted];
        this.saveConversation();
    }

    addModelComparisonMessage(results = []) {
        this._messageCounter++;
        const cards = results.map((result, index) => {
            const responseText = result.response || result.error || 'No response returned.';
            const citationItems = this.buildCitationItems(result.citations || []);
            const hasCitations = citationItems.length > 0;
            return {
                id: `${result.modelApiName || 'model'}_${index}`,
                modelLabel: result.modelLabel || result.modelApiName || `Model ${index + 1}`,
                statusLabel: result.success ? 'Response ready' : 'Response failed',
                cardClass: result.success ? 'model-comparison-card' : 'model-comparison-card model-comparison-card-error',
                htmlContent: this.renderMarkdown(responseText, citationItems),
                citations: citationItems,
                hasCitations,
                sourcesExpanded: false,
                sourcesToggleIcon: 'utility:chevronright',
                sourcesToggleLabel: hasCitations ? this.buildSourcesToggleLabel(citationItems) : null,
                sourcesAriaLabel: 'Show grounding sources',
                sourceDisclosureId: `compare_sources_${this._messageCounter}_${index}`,
                metricsLabel: this.buildMetricsLabel(result)
            };
        });
        const text = results.map(result => `${result.modelLabel || result.modelApiName}: ${result.response || result.error || ''}`).join('\n\n');
        const formatted = {
            id: `msg_${this._messageCounter}_${Date.now()}`,
            role: 'assistant',
            text,
            timestamp: new Date().toISOString(),
            index: this.messages.length,
            containerClass: 'message-row assistant-row',
            bubbleClass: 'message-bubble assistant-bubble model-comparison-bubble',
            isUser: false,
            isAssistant: true,
            isError: false,
            htmlContent: null,
            isModelComparison: true,
            comparisonCards: cards,
            isLastAssistant: true,
            timestampLabel: this.formatMessageTimestamp(new Date())
        };

        this.messages = this.messages.map(m => ({ ...m, isLastAssistant: false }));
        this.messages = [...this.messages, formatted];
        this.saveConversation();
    }

    buildConversationHistory() {
        const history = this.messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(0, -1)
            .map(m => ({ role: m.role, message: m.text }));
        return history.length > 0 ? JSON.stringify(history) : null;
    }

    // ── Follow-up Generation ──

    async generateFollowUps() {
        if (!this.enableSuggestedFollowUpsEnabled || !this.hasGroundedContext) {
            return;
        }

        try {
            const contextJson = this.mode === 'compare' ? this.comparisonContextJson : this.recordContextJson;
            const recentMessages = this.messages.slice(-4).map(m => `${m.role}: ${m.text}`).join('\n');
            const result = await generateFollowUpPrompts({
                recordContextJson: contextJson,
                recentConversationJson: recentMessages
            });
            if (result.success) {
                this.followUpPrompts = JSON.parse(result.response);
            }
        } catch (error) {
            // Non-critical
        }
    }

    // ── localStorage Persistence ──

    saveConversation() {
        if (!this.storageKey || !this.persistConversationEnabled) {
            this.clearPersistedState();
            return;
        }
        try {
            const data = this.messages.map(m => ({ role: m.role, text: m.text, timestamp: m.timestamp }));
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (e) { /* storage full or unavailable */ }
    }

    loadConversation() {
        if (!this.storageKey || !this.persistConversationEnabled) {
            this.messages = [];
            return;
        }
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const data = JSON.parse(stored);
                this._messageCounter = 0;
                this.messages = data.map((m, idx) => {
                    this._messageCounter++;
                    return {
                        id: `msg_${this._messageCounter}_restored`,
                        role: m.role, text: m.text, timestamp: m.timestamp,
                        index: idx,
                        containerClass: `message-row ${m.role === 'user' ? 'user-row' : 'assistant-row'}`,
                        bubbleClass: `message-bubble ${m.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`,
                        isUser: m.role === 'user',
                        isAssistant: m.role === 'assistant',
                        isError: m.role === 'assistant' && this.isErrorMessage(m.text),
                        htmlContent: m.role === 'assistant' ? this.renderMarkdown(m.text) : null,
                        citations: [],
                        hasCitations: false,
                        metricsLabel: null,
                        hasMetrics: false,
                        isModelComparison: false,
                        isLastAssistant: false,
                        timestampLabel: this.formatMessageTimestamp(m.timestamp)
                    };
                });
                for (let i = this.messages.length - 1; i >= 0; i--) {
                    if (this.messages[i].role === 'assistant') {
                        this.messages[i].isLastAssistant = true;
                        break;
                    }
                }
            }
        } catch (e) { /* corrupted, start fresh */ }
    }

    saveUsageMetrics() {
        if (!this.storageKey || !this.persistConversationEnabled) {
            this.clearPersistedState();
            return;
        }
        try {
            localStorage.setItem(`${this.storageKey}_usage`, JSON.stringify({
                sessionTokens: this.sessionTokens,
                sessionCredits: this.sessionCredits
            }));
        } catch (e) { /* ignore */ }
    }

    loadUsageMetrics() {
        if (!this.storageKey || !this.persistConversationEnabled) {
            this.sessionTokens = 0;
            this.sessionCredits = 0;
            this.dispatchUsageUpdate();
            return;
        }
        try {
            const stored = localStorage.getItem(`${this.storageKey}_usage`);
            if (stored) {
                const data = JSON.parse(stored);
                this.sessionTokens = data.sessionTokens || 0;
                this.sessionCredits = data.sessionCredits || 0;
                this.dispatchUsageUpdate();
            }
        } catch (e) { /* ignore */ }
    }

    clearPersistedState() {
        if (!this.storageKey) {
            return;
        }

        try {
            localStorage.removeItem(this.storageKey);
            localStorage.removeItem(`${this.storageKey}_usage`);
        } catch (e) { /* ignore */ }
    }

    applyPreferredModelSelection(availableModels) {
        if (this.selectedModel && availableModels.includes(this.selectedModel)) {
            this.ensureSecondaryModelSelection();
            return;
        }

        const configuredModel = (this.defaultModelApiName || '').trim();
        if (configuredModel && availableModels.includes(configuredModel)) {
            this.selectedModel = configuredModel;
            this.ensureSecondaryModelSelection();
            return;
        }

        this.selectedModel = availableModels[0] || null;
        this.ensureSecondaryModelSelection();
    }

    ensureSecondaryModelSelection() {
        if (!this.modelOptions.length) {
            this.secondarySelectedModel = null;
            return;
        }
        const availableSecondaryModels = this.modelOptions
            .map(option => option.value)
            .filter(value => value !== this.selectedModel);
        if (this.secondarySelectedModel && availableSecondaryModels.includes(this.secondarySelectedModel)) {
            return;
        }
        this.secondarySelectedModel = availableSecondaryModels[0] || null;
    }

    buildAssistantMetadata(result = {}) {
        return {
            citations: this.sourceGroundingEnabled ? result.citations : [],
            modelLabel: result.modelLabel,
            latencyMs: result.latencyMs,
            estimatedTokens: result.estimatedTokens,
            estimatedCredits: result.estimatedCredits
        };
    }

    buildMetricsLabel(result = {}) {
        const parts = [];
        if (result.modelLabel) {
            parts.push(result.modelLabel);
        }
        if (result.latencyMs !== undefined && result.latencyMs !== null) {
            parts.push(`${Number(result.latencyMs).toLocaleString()} ms`);
        }
        if (result.estimatedTokens) {
            parts.push(`~${Number(result.estimatedTokens).toLocaleString()} tokens`);
        }
        if (result.estimatedCredits) {
            parts.push(`~${Number(result.estimatedCredits).toLocaleString()} credits`);
        }
        return parts.join(' · ');
    }

    buildCitationItems(citations = []) {
        if (!this.sourceGroundingEnabled || !Array.isArray(citations)) {
            return [];
        }
        return citations.map((citation, index) => ({
            id: citation.sourceId || `citation_${index}`,
            sourceId: citation.sourceId,
            label: citation.displayLabel || citation.sourceId || 'Source',
            summary: citation.valueSummary,
            href: this.buildCitationHref(citation) || '#',
            className: this.buildCitationHref(citation)
                ? 'citation-pill'
                : 'citation-pill citation-pill-static'
        }));
    }

    buildSourcesToggleLabel(citations = []) {
        const count = Array.isArray(citations) ? citations.length : 0;
        return count === 1 ? 'Sources · 1 source' : `Sources · ${count} sources`;
    }

    withSourceDisclosureState(item, sourcesExpanded = false) {
        const citations = Array.isArray(item.citations) ? item.citations : [];
        return {
            ...item,
            sourcesExpanded,
            sourcesToggleIcon: sourcesExpanded ? 'utility:chevrondown' : 'utility:chevronright',
            sourcesToggleLabel: this.buildSourcesToggleLabel(citations),
            sourcesAriaLabel: sourcesExpanded ? 'Hide grounding sources' : 'Show grounding sources'
        };
    }

    buildCitationHref(citation = {}) {
        if (!citation.recordId) {
            return null;
        }
        if (citation.objectApiName) {
            return `/lightning/r/${citation.objectApiName}/${citation.recordId}/view`;
        }
        return `/lightning/r/${citation.recordId}/view`;
    }

    getActiveContextPayload() {
        const contextJson = this.mode === 'compare' ? this.comparisonContextJson : this.recordContextJson;
        if (!contextJson) {
            return null;
        }
        try {
            return JSON.parse(contextJson);
        } catch (error) {
            return null;
        }
    }

    getRequestContextJson() {
        const contextJson = this.mode === 'compare' ? this.comparisonContextJson : this.recordContextJson;
        if (this.sourceGroundingEnabled || !contextJson) {
            return contextJson;
        }
        try {
            const payload = JSON.parse(contextJson);
            delete payload.sourceRegistry;
            if (payload.selectionSummary) {
                delete payload.selectionSummary.sourceCount;
            }
            return JSON.stringify(payload);
        } catch (error) {
            return contextJson;
        }
    }

    countPayloadFields(payload) {
        if (!payload) {
            return 0;
        }
        if (payload.recordContext?.fields) {
            return Object.keys(payload.recordContext.fields).length;
        }
        if (payload.comparisonContext?.records) {
            return payload.comparisonContext.records.reduce(
                (sum, record) => sum + Object.keys(record.fields || {}).length,
                0
            );
        }
        return 0;
    }

    normalizeModelSetName(value) {
        const normalizedValue = (value || '').trim();
        return normalizedValue || DEFAULT_MODEL_SET_NAME;
    }

    isBooleanEnabled(value) {
        return value !== false && value !== 'false';
    }

    formatMetricValue(value) {
        const numericValue = Number(value) || 0;
        return numericValue.toLocaleString();
    }

    formatCreditTier(value) {
        const normalized = value ? String(value).trim().toLowerCase() : 'standard';
        return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)} tier`;
    }

    resolveModelLogo(model) {
        const key = this.resolveModelLogoKey(model);
        return MODEL_LOGO_MAP[key] || MODEL_LOGO_OPENAI;
    }

    resolveModelLogoKey(model) {
        const searchable = [
            model?.provider,
            model?.label,
            model?.apiName
        ].filter(Boolean).join(' ').toLowerCase();

        if (searchable.includes('anthropic') || searchable.includes('claude')) {
            return 'anthropic';
        }
        if (searchable.includes('google') || searchable.includes('gemini') || searchable.includes('vertex')) {
            return 'google';
        }
        if (searchable.includes('nvidia') || searchable.includes('nemotron')) {
            return 'nvidia';
        }
        if (searchable.includes('amazon') || searchable.includes('nova')) {
            return 'amazon';
        }
        if (searchable.includes('openai') || searchable.includes('gpt')) {
            return 'openai';
        }
        return 'openai';
    }

    formatMessageTimestamp(value) {
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    isErrorMessage(text) {
        return typeof text === 'string' && text.trim().toLowerCase().startsWith('error:');
    }

    startProgressCarousel() {
        this.stopProgressCarousel(false);
        this.progressMessageIndex = 0;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._progressInterval = setInterval(() => {
            this.progressMessageIndex = (this.progressMessageIndex + 1) % PROGRESS_MESSAGES.length;
        }, PROGRESS_ROTATION_MS);
    }

    stopProgressCarousel(resetIndex = true) {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = null;
        }
        if (resetIndex) {
            this.progressMessageIndex = 0;
        }
    }

    // ── Markdown Rendering ──

    renderMarkdown(text, citations = []) {
        if (!text) return '';
        let html = this.escapeHtml(text);

        // Code blocks (before other processing)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="md-code-block"><code>$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

        // Tables - must be processed before paragraph handling
        html = this.renderTables(html);
        html = this.normalizeSectionHeadings(html);

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h4 class="md-h3">$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3 class="md-h2">$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2 class="md-h1">$1</h2>');

        // Bold and italic
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Bullet lists — convert runs of "- item" / "* item" lines into <ul>
        html = html.replace(/(^[\s]*[-*]\s+.+$(\n|$))+/gm, (block) => {
            const items = block.trim().split('\n')
                .map(line => line.replace(/^[\s]*[-*]\s+/, '').trim())
                .filter(Boolean)
                .map(item => `<li>${item}</li>`)
                .join('');
            return `<ul class="md-list">${items}</ul>\n`;
        });

        // Numbered lists — convert runs of "1. item" lines into <ol>
        html = html.replace(/(^\d+\.\s+.+$(\n|$))+/gm, (block) => {
            const items = block.trim().split('\n')
                .map(line => line.replace(/^\d+\.\s+/, '').trim())
                .filter(Boolean)
                .map(item => `<li>${item}</li>`)
                .join('');
            return `<ol class="md-list">${items}</ol>\n`;
        });

        // Links - sanitize dangerous protocols
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
            const normalized = url.trim().toLowerCase();
            if (normalized.startsWith('javascript:') || normalized.startsWith('data:')) return linkText;
            return `<a href="${url}" target="_blank" rel="noopener">${linkText}</a>`;
        });

        html = this.renderInlineCitations(html, citations);

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // Clean up
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>\s*(<h[234])/g, '$1');
        html = html.replace(/(<\/h[234]>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<ul)/g, '$1');
        html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<ol)/g, '$1');
        html = html.replace(/(<\/ol>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<pre)/g, '$1');
        html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
        html = html.replace(/<p>\s*(<table)/g, '$1');
        html = html.replace(/(<\/table>)\s*<\/p>/g, '$1');

        return html;
    }

    renderInlineCitations(html, citations = []) {
        return html.replace(/\s*\[((?:src\d+\s*,\s*)*src\d+)\]/g, '');
    }

    normalizeSectionHeadings(html) {
        const headingPattern = /^(Executive Summary|Key Observations|Key Risks Identified|Risks Identified|Recommended Next Steps|Recommendations|Recommendation|Risks or Differentiators|Data-Grounded Observations)$/gm;
        return html.replace(headingPattern, '### $1');
    }

    renderTables(html) {
        const tableRegex = /^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm;

        return html.replace(tableRegex, (match, headerRow, separatorRow, bodyRows) => {
            const alignments = separatorRow.split('|').filter(c => c.trim()).map(c => {
                const trimmed = c.trim();
                if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
                if (trimmed.endsWith(':')) return 'right';
                return 'left';
            });

            const headers = headerRow.split('|').filter(c => c.trim());
            let table = '<table class="md-table"><thead><tr>';
            headers.forEach((h, i) => {
                const align = alignments[i] || 'left';
                table += `<th style="text-align:${align}">${h.trim()}</th>`;
            });
            table += '</tr></thead><tbody>';

            const rows = bodyRows.trim().split('\n');
            rows.forEach(row => {
                const cleanCells = row.split('|').slice(1, -1);
                table += '<tr>';
                cleanCells.forEach((cell, i) => {
                    const align = alignments[i] || 'left';
                    table += `<td style="text-align:${align}">${cell.trim()}</td>`;
                });
                table += '</tr>';
            });

            table += '</tbody></table>';
            return table;
        });
    }

    escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (char) => {
            switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case '\'':
                return '&#39;';
            default:
                return char;
            }
        });
    }

    // ── Scroll Management ──

    scrollToBottom() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const container = this.refs.chatContainer;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 100);
    }

    resizeInput(textarea) {
        if (!textarea) {
            return;
        }

        const maxHeight = 72;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
        textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    resetInputHeight() {
        const textarea = this.refs?.messageInput;
        if (!textarea) {
            return;
        }

        textarea.value = this.userInput || '';
        this.resizeInput(textarea);
    }
}
