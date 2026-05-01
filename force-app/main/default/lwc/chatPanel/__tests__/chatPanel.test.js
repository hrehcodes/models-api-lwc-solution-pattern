import { createElement } from 'lwc';
import ChatPanel from 'c/chatPanel';
import getAvailableModels from '@salesforce/apex/RecordAdvisorController.getAvailableModels';
import sendMessage from '@salesforce/apex/RecordAdvisorController.sendMessage';
import compareModels from '@salesforce/apex/RecordAdvisorController.compareModels';

jest.mock(
    '@salesforce/apex/RecordAdvisorController.getAvailableModels',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordAdvisorController.sendMessage',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordAdvisorController.compareModels',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

const getAvailableModelsAdapter = {
    emit: jest.fn(),
    getLastConfig: () => getAvailableModels.mock.calls[getAvailableModels.mock.calls.length - 1]?.[0]
};
const flushPromises = async (count = 4) => {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
};

describe('c-chat-panel', () => {
    let getItemSpy;
    let setItemSpy;
    let removeItemSpy;

    beforeEach(() => {
        getAvailableModels.mockResolvedValue([]);
        sendMessage.mockResolvedValue({
            success: true,
            response: 'Generated response',
            modelLabel: 'Gemini Pro',
            latencyMs: 120,
            estimatedTokens: 1000,
            estimatedCredits: 4
        });
        compareModels.mockResolvedValue({
            success: true,
            results: []
        });
        getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
        setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
        removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        localStorage.clear();
        jest.clearAllMocks();
    });

    it('requests available models for the configured model set', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.modelSetName = 'Executive';
        document.body.appendChild(element);

        await flushPromises();

        expect(getAvailableModelsAdapter.getLastConfig()).toEqual({
            modelSetName: 'Executive'
        });
    });

    it('does not read or write persisted chat state when persistence is disabled', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.storageKey = 'ari_chat_test';
        element.persistConversation = false;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(getItemSpy).not.toHaveBeenCalled();
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(removeItemSpy).toHaveBeenCalledWith('ari_chat_test');
        expect(removeItemSpy).toHaveBeenCalledWith('ari_chat_test_usage');
    });

    it('restores persisted chat state when persistence is enabled', async () => {
        const usageHandler = jest.fn();

        localStorage.setItem(
            'ari_chat_saved',
            JSON.stringify([
                {
                    role: 'assistant',
                    text: 'Saved reply',
                    timestamp: '2026-03-07T12:00:00.000Z'
                }
            ])
        );
        localStorage.setItem(
            'ari_chat_saved_usage',
            JSON.stringify({
                sessionTokens: 12,
                sessionCredits: 4
            })
        );

        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.storageKey = 'ari_chat_saved';
        element.persistConversation = true;
        element.addEventListener('usageupdate', usageHandler);
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const renderedMessage = element.shadowRoot.querySelector('lightning-formatted-rich-text');
        const usageEvent = usageHandler.mock.calls[usageHandler.mock.calls.length - 1][0];

        expect(getItemSpy).toHaveBeenCalledWith('ari_chat_saved');
        expect(getItemSpy).toHaveBeenCalledWith('ari_chat_saved_usage');
        expect(element.shadowRoot.querySelectorAll('.message-row')).toHaveLength(1);
        expect(renderedMessage.value).toBe('<p>Saved reply</p>');
        expect(usageEvent.detail).toEqual({
            sessionTokens: 12,
            sessionCredits: 4
        });
    });

    it('renders a warning banner for partial context', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.contextStatus = 'partial';
        element.contextWarningSummary = 'Some record context was skipped or truncated.';
        element.contextWarningMessages = ['Some field values could not be included in the record context.'];
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const warning = element.shadowRoot.querySelector('.context-warning');
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('Some record context was skipped or truncated.');
    });

    it('renders a compact usage footer near the composer when enabled', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        localStorage.setItem(
            'ari_chat_usage_footer_usage',
            JSON.stringify({
                sessionTokens: 1234,
                sessionCredits: 8
            })
        );
        element.storageKey = 'ari_chat_usage_footer';
        element.persistConversation = true;
        element.showInlineUsageStatus = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const usageFooter = element.shadowRoot.querySelector('.usage-status-bar');
        expect(usageFooter).not.toBeNull();
        expect(usageFooter.textContent).toContain('Usage');
        expect(usageFooter.textContent).toContain('1,234');
        expect(usageFooter.textContent).toContain('8');
    });

    it('escapes HTML content and strips dangerous markdown link protocols', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        localStorage.setItem(
            'ari_chat_sanitized',
            JSON.stringify([
                {
                    role: 'assistant',
                    text: '<script>alert("boom")</script>\n\n[bad](javascript:evil)\n\n[good](https://example.com)',
                    timestamp: '2026-03-12T14:00:00.000Z'
                }
            ])
        );
        element.storageKey = 'ari_chat_sanitized';
        element.persistConversation = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const renderedMessage = element.shadowRoot.querySelector('lightning-formatted-rich-text');
        const html = renderedMessage.value;

        expect(html).toContain('&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;');
        expect(html).toContain('<p>bad</p>');
        expect(html).not.toContain('javascript:');
        expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener">good</a>');
    });

    it('renders a failed warning banner for ungrounded chat state', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.contextStatus = 'failed';
        element.contextWarningSummary = 'Record context could not be loaded.';
        element.contextWarningMessages = ['Context query failed'];
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const warning = element.shadowRoot.querySelector('.context-warning-failed');
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('Context query failed');
    });

    it('suppresses warning banners when hideContextWarnings is enabled', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.contextStatus = 'partial';
        element.contextWarningSummary = 'Some record context was skipped or truncated.';
        element.contextWarningMessages = ['Some field values could not be included in the record context.'];
        element.hideContextWarnings = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.shadowRoot.querySelector('.context-warning')).toBeNull();
    });

    it('suppresses suggested prompts when chat is ungrounded', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.contextStatus = 'failed';
        element.contextWarningSummary = 'Record context could not be loaded.';
        element.showSuggestedPrompts = true;
        element.recordContextJson = null;
        element.objectApiName = 'Account';
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.shadowRoot.querySelector('.suggested-prompts')).toBeNull();
        expect(element.shadowRoot.querySelector('.context-warning-failed')).not.toBeNull();
    });

    it('shows a confirmation modal before sending prompts above the configured token threshold', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.recordContextJson = JSON.stringify({
            fields: {
                Name: { label: 'Name', value: 'Acme' }
            }
        }).repeat(800);
        element.tokenWarningThreshold = 100;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const textarea = element.shadowRoot.querySelector('textarea');
        textarea.value = 'Summarize this record.';
        textarea.dispatchEvent(new Event('input'));
        await flushPromises();

        const sendButton = element.shadowRoot.querySelector('.send-btn');
        sendButton.click();
        await flushPromises();

        expect(element.shadowRoot.querySelector('.slds-modal')).not.toBeNull();
        expect(element.shadowRoot.querySelectorAll('.message-row')).toHaveLength(0);
    });

    it('renders the rich model picker and updates the selected model', async () => {
        getAvailableModels.mockResolvedValue([
            {
                label: 'Gemini Pro',
                provider: 'Google',
                creditType: 'standard',
                apiName: 'sfdc_ai__DefaultVertexAIGeminiPro31'
            },
            {
                label: 'GPT-5',
                provider: 'OpenAI',
                creditType: 'advanced',
                apiName: 'sfdc_ai__DefaultGPT5'
            },
            {
                label: 'Amazon Nova Lite',
                provider: 'Amazon Bedrock',
                creditType: 'standard',
                apiName: 'sfdc_ai__DefaultBedrockAmazonNovaLite'
            }
        ]);

        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.showModelPicker = true;
        document.body.appendChild(element);

        await flushPromises();

        const pickerButton = element.shadowRoot.querySelector('.model-picker-button');
        expect(pickerButton).not.toBeNull();
        expect(pickerButton.textContent).toContain('Gemini Pro');
        expect(pickerButton.querySelector('img')).not.toBeNull();

        pickerButton.click();
        await flushPromises();

        const options = element.shadowRoot.querySelectorAll('.model-option');
        expect(options).toHaveLength(3);
        expect(element.shadowRoot.querySelectorAll('.model-option-logo img')).toHaveLength(3);
        expect(options[2].querySelector('.model-option-logo img').src).toContain('ModelLogoAmazon');
        options[1].click();
        await flushPromises();

        expect(element.shadowRoot.querySelector('.model-picker-button').textContent).toContain('GPT-5');
    });

    it('renders grounding citations from the model response as source links', async () => {
        sendMessage.mockResolvedValue({
            success: true,
            response: 'Executive Summary\nAcme is active [src1].',
            citations: [
                {
                    sourceId: 'src1',
                    displayLabel: 'Acme · Account Name',
                    objectApiName: 'Account',
                    recordId: '001000000000001AAA',
                    valueSummary: 'Acme'
                }
            ],
            modelLabel: 'Gemini Pro',
            latencyMs: 140,
            estimatedTokens: 900,
            estimatedCredits: 4
        });

        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.recordContextJson = JSON.stringify({
            selectionSummary: { objectLabel: 'Account', recordName: 'Acme' },
            sourceRegistry: [{ sourceId: 'src1', displayLabel: 'Acme · Account Name' }],
            recordContext: {
                fields: {
                    Name: { label: 'Account Name', value: 'Acme' }
                }
            }
        });
        document.body.appendChild(element);
        await flushPromises();

        const textarea = element.shadowRoot.querySelector('textarea');
        textarea.value = 'Summarize this record.';
        textarea.dispatchEvent(new Event('input'));
        element.shadowRoot.querySelector('.send-btn').click();
        await flushPromises();

        const citation = element.shadowRoot.querySelector('.citation-pill');
        expect(citation).not.toBeNull();
        expect(citation.textContent).toContain('Acme · Account Name');
        expect(citation.href).toContain('/lightning/r/Account/001000000000001AAA/view');
        expect(element.shadowRoot.querySelector('lightning-formatted-rich-text').value).toContain('inline-citation');
        expect(element.shadowRoot.querySelector('lightning-formatted-rich-text').value).toContain('md-h3');
        expect(element.shadowRoot.querySelector('.model-response-metrics').textContent).toContain('Gemini Pro');
    });

    it('shows context preview and session guardrails when configured thresholds are exceeded', async () => {
        localStorage.setItem(
            'ari_chat_guardrail_usage',
            JSON.stringify({
                sessionTokens: 51,
                sessionCredits: 6
            })
        );

        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.storageKey = 'ari_chat_guardrail';
        element.persistConversation = true;
        element.sessionTokenWarningThreshold = 50;
        element.sessionCreditWarningThreshold = 5;
        element.recordContextJson = JSON.stringify({
            selectionSummary: {
                objectLabel: 'Account',
                recordName: 'Acme',
                selectedRelationships: ['Contacts'],
                sourceCount: 1
            },
            sourceRegistry: [{ sourceId: 'src1', displayLabel: 'Acme' }],
            recordContext: {
                fields: {
                    Name: { label: 'Account Name', value: 'Acme' }
                }
            }
        });
        document.body.appendChild(element);
        await flushPromises();

        expect(element.shadowRoot.querySelector('.context-preview-card').textContent).toContain('Context preview');
        expect(element.shadowRoot.querySelector('.context-preview-card').textContent).toContain('1 relationship');
        expect(element.shadowRoot.querySelector('.context-preview-grid')).toBeNull();
        element.shadowRoot.querySelector('.context-preview-toggle').click();
        await flushPromises();
        expect(element.shadowRoot.querySelector('.context-preview-grid')).not.toBeNull();
        expect(element.shadowRoot.querySelector('.usage-guardrail').textContent).toContain('Session token estimate');
        expect(element.shadowRoot.querySelector('.usage-guardrail').textContent).toContain('Session flex credit estimate');
    });

    it('sends one prompt to two models when model comparison is enabled', async () => {
        getAvailableModels.mockResolvedValue([
            {
                label: 'Gemini Pro',
                provider: 'Google',
                creditType: 'standard',
                apiName: 'sfdc_ai__DefaultVertexAIGeminiPro31'
            },
            {
                label: 'GPT-5',
                provider: 'OpenAI',
                creditType: 'advanced',
                apiName: 'sfdc_ai__DefaultGPT5'
            }
        ]);
        compareModels.mockResolvedValue({
            success: true,
            results: [
                {
                    success: true,
                    modelLabel: 'Gemini Pro',
                    response: 'Gemini answer',
                    latencyMs: 100,
                    estimatedTokens: 500,
                    estimatedCredits: 4,
                    citations: []
                },
                {
                    success: true,
                    modelLabel: 'GPT-5',
                    response: 'GPT answer',
                    latencyMs: 180,
                    estimatedTokens: 600,
                    estimatedCredits: 16,
                    citations: []
                }
            ]
        });

        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.showModelPicker = true;
        element.enableModelComparison = true;
        element.recordContextJson = JSON.stringify({
            selectionSummary: { objectLabel: 'Account', recordName: 'Acme' },
            recordContext: { fields: { Name: { label: 'Name', value: 'Acme' } } }
        });
        document.body.appendChild(element);
        await flushPromises();

        element.shadowRoot.querySelector('lightning-input').checked = true;
        element.shadowRoot.querySelector('lightning-input').dispatchEvent(new CustomEvent('change'));
        await flushPromises();

        const textarea = element.shadowRoot.querySelector('textarea');
        textarea.value = 'Compare model answers.';
        textarea.dispatchEvent(new Event('input'));
        element.shadowRoot.querySelector('.send-btn').click();
        await flushPromises();

        expect(compareModels).toHaveBeenCalledWith(expect.objectContaining({
            primaryModelApiName: 'sfdc_ai__DefaultVertexAIGeminiPro31',
            secondaryModelApiName: 'sfdc_ai__DefaultGPT5',
            mode: 'insights'
        }));
        expect(element.shadowRoot.querySelectorAll('.model-comparison-card')).toHaveLength(2);
        expect(element.shadowRoot.textContent).toContain('Gemini answer');
        expect(element.shadowRoot.textContent).toContain('GPT answer');
    });

    it('sends starter prompts when nested prompt content is clicked', async () => {
        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.recordContextJson = JSON.stringify({
            fields: {
                Name: { label: 'Name', value: 'Acme' }
            }
        });
        element.objectApiName = 'Account';
        element.recordName = 'Acme';
        element.showSuggestedPrompts = true;
        document.body.appendChild(element);

        await flushPromises();

        const promptLabel = element.shadowRoot.querySelector('.prompt-chip span');
        expect(promptLabel).not.toBeNull();
        promptLabel.click();
        await flushPromises();

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            userMessage: 'Give me a complete overview of this account.'
        }));
    });

    it('shows staged progress copy while a model response is pending', async () => {
        sendMessage.mockReturnValue(new Promise(() => {}));

        const element = createElement('c-chat-panel', {
            is: ChatPanel
        });
        element.recordContextJson = JSON.stringify({
            fields: {
                Name: { label: 'Name', value: 'Acme' }
            }
        });
        document.body.appendChild(element);

        await flushPromises();

        const textarea = element.shadowRoot.querySelector('textarea');
        textarea.value = 'Summarize this record.';
        textarea.dispatchEvent(new Event('input'));
        await flushPromises();

        const sendButton = element.shadowRoot.querySelector('.send-btn');
        sendButton.click();
        await flushPromises();

        const progressCopy = element.shadowRoot.querySelector('.progress-copy');
        expect(progressCopy).not.toBeNull();
        expect(progressCopy.textContent).toContain('Preparing selected record context');
    });
});
