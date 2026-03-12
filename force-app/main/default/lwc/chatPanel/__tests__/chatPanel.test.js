import { createElement } from 'lwc';
import { registerApexTestWireAdapter } from '@salesforce/sfdx-lwc-jest';
import ChatPanel from 'c/chatPanel';
import getAvailableModels from '@salesforce/apex/RecordAdvisorController.getAvailableModels';

const getAvailableModelsAdapter = registerApexTestWireAdapter(getAvailableModels);
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

        const sendButton = element.shadowRoot.querySelector('lightning-button-icon');
        sendButton.click();
        await flushPromises();

        expect(element.shadowRoot.querySelector('.slds-modal')).not.toBeNull();
        expect(element.shadowRoot.querySelectorAll('.message-row')).toHaveLength(0);
    });
});
