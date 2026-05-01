import { LightningElement, api, track } from 'lwc';
import AGENTFORCE_ICON from '@salesforce/resourceUrl/Agentforce_Icon';
import MODEL_LOGO_AMAZON from '@salesforce/resourceUrl/ModelLogoAmazon';
import MODEL_LOGO_ANTHROPIC from '@salesforce/resourceUrl/ModelLogoAnthropic';
import MODEL_LOGO_GOOGLE from '@salesforce/resourceUrl/ModelLogoGoogle';
import MODEL_LOGO_NVIDIA from '@salesforce/resourceUrl/ModelLogoNvidia';
import MODEL_LOGO_OPENAI from '@salesforce/resourceUrl/ModelLogoOpenAI';
import sendMessage from '@salesforce/apex/RecordAdvisorController.sendMessage';
import sendCompareMessage from '@salesforce/apex/RecordAdvisorController.sendCompareMessage';
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

    @track messages = [];
    userInput = '';
    isLoading = false;
    selectedModel = null;
    @track modelOptions = [];
    @track followUpPrompts = [];
    sessionTokens = 0;
    sessionCredits = 0;
    showLargePromptWarningModal = false;
    pendingLargePromptText;
    pendingLargePromptTokenEstimate = 0;
    isModelPickerOpen = false;
    progressMessageIndex = 0;

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
        return this.showModelPickerEnabled || this.hasMessages;
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
        this.isModelPickerOpen = false;
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
        this.isLoading = true;
        this.startProgressCarousel();
        this.resetInputHeight();
        this.scrollToBottom();

        try {
            const historyJson = this.buildConversationHistory();
            const modelToUse = this.selectedModel || undefined;
            let result;

            if (this.mode === 'compare') {
                result = await sendCompareMessage({
                    comparisonContextJson: this.comparisonContextJson,
                    userMessage: text,
                    conversationHistoryJson: historyJson,
                    modelApiName: modelToUse
                });
            } else {
                result = await sendMessage({
                    recordContextJson: this.recordContextJson,
                    userMessage: text,
                    conversationHistoryJson: historyJson,
                    modelApiName: modelToUse
                });
            }

            if (result.success) {
                this.addMessage('assistant', result.response);
                this.trackUsage(text, result.response);
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
        this.sessionTokens = 0;
        this.sessionCredits = 0;
        this.saveConversation();
        this.saveUsageMetrics();
        this.dispatchUsageUpdate();
    }

    // ── Usage Tracking ──

    trackUsage(userText, assistantText) {
        const contextTokens = this.estimateContextTokens();
        const messageTokens = Math.ceil((userText.length + assistantText.length) / 4);
        const totalTokens = contextTokens + messageTokens;

        // Each 2,000-token chunk counts as one prompt (rounded up)
        const promptChunks = Math.ceil(totalTokens / 2000);

        // Flex credit cost per prompt chunk depends on model tier:
        //   Starter = 2 credits, Basic = 2 credits, Standard = 4 credits, Advanced = 16 credits
        const CREDIT_COSTS = { starter: 2, basic: 2, standard: 4, advanced: 16 };
        const creditType = MODEL_CREDIT_MAP[this.selectedModel] || 'standard';
        const costPerChunk = CREDIT_COSTS[creditType] || 4;
        const creditsUsed = promptChunks * costPerChunk;

        this.sessionTokens += totalTokens;
        this.sessionCredits += creditsUsed;

        this.saveUsageMetrics();
        this.dispatchUsageUpdate();
    }

    estimateContextTokens() {
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

    addMessage(role, text) {
        this._messageCounter++;
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
            htmlContent: role === 'assistant' ? this.renderMarkdown(text) : null,
            isLastAssistant: role === 'assistant',
            timestampLabel: this.formatMessageTimestamp(new Date())
        };

        if (role === 'assistant') {
            this.messages = this.messages.map(m => ({ ...m, isLastAssistant: false }));
        }

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
            return;
        }

        const configuredModel = (this.defaultModelApiName || '').trim();
        if (configuredModel && availableModels.includes(configuredModel)) {
            this.selectedModel = configuredModel;
            return;
        }

        this.selectedModel = availableModels[0] || null;
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

    renderMarkdown(text) {
        if (!text) return '';
        let html = this.escapeHtml(text);

        // Code blocks (before other processing)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="md-code-block"><code>$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

        // Tables - must be processed before paragraph handling
        html = this.renderTables(html);

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
