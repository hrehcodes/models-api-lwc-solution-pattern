import { createElement } from 'lwc';
import ContextPanel from 'c/contextPanel';

const flushPromises = async (count = 2) => {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
};

const baseAvailableContext = {
    objectApiName: 'Account',
    objectLabel: 'Account',
    recordName: 'Acme',
    fieldCategories: [
        {
            name: 'core',
            label: 'Core Fields',
            includedByDefault: true,
            fieldCount: 4,
            fields: []
        }
    ],
    relationships: []
};

describe('c-context-panel', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('shows a large context warning when the estimate exceeds the configured threshold', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = baseAvailableContext;
        element.includedCategories = ['core'];
        element.showUsageMetrics = true;
        element.contextTokenEstimate = 250;
        element.tokenWarningThreshold = 100;
        document.body.appendChild(element);

        await flushPromises();

        const warning = element.shadowRoot.querySelector('.context-warning-token');
        expect(warning).not.toBeNull();
        expect(warning.textContent).toContain('configured warning threshold of 100 tokens');
    });

    it('disables threshold-based warning visuals when the threshold is zero but keeps the usage estimate visible', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = baseAvailableContext;
        element.includedCategories = ['core'];
        element.showUsageMetrics = true;
        element.contextTokenEstimate = 250;
        element.tokenWarningThreshold = 0;
        document.body.appendChild(element);

        await flushPromises();

        expect(element.shadowRoot.querySelector('.context-warning-token')).toBeNull();
        expect(element.shadowRoot.textContent).toContain('250 tokens');
        expect(element.shadowRoot.querySelector('.token-meter-fill')).not.toBeNull();
    });

    it('shows a local related-record count note when some relationship counts are unavailable', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = {
            ...baseAvailableContext,
            recordId: '001000000000001AAA',
            relationships: [
                {
                    relationshipName: 'Contacts',
                    childObjectLabel: 'Contact',
                    countStatus: 'unknown',
                    includedByDefault: true
                }
            ]
        };
        document.body.appendChild(element);

        await flushPromises();

        expect(element.shadowRoot.textContent).toContain(
            'Some relationship counts are unavailable and are shown without counts.'
        );
    });
});
