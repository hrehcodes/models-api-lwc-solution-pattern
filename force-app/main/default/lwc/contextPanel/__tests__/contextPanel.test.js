import { createElement } from 'lwc';
import ContextPanel from 'c/contextPanel';

jest.mock(
    '@salesforce/apex/RecordContextService.getParentChildRelationships',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
import getParentChildRelationships from '@salesforce/apex/RecordContextService.getParentChildRelationships';

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
    beforeEach(() => {
        getParentChildRelationships.mockResolvedValue([]);
    });

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

    it('renders polished context status and usage summaries', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = baseAvailableContext;
        element.includedCategories = ['core'];
        element.contextStatus = 'ready';
        element.showUsageMetrics = true;
        element.contextTokenEstimate = 1234;
        element.sessionTokens = 9876;
        element.sessionCredits = 12;
        document.body.appendChild(element);

        await flushPromises();

        expect(element.shadowRoot.querySelector('.status-pill-ready')).not.toBeNull();
        expect(element.shadowRoot.textContent).toContain('Context ready');
        expect(element.shadowRoot.textContent).toContain('1,234 context tokens');
        expect(element.shadowRoot.textContent).toContain('9,876');
        expect(element.shadowRoot.textContent).toContain('12');
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

    it('renders the Parent Records section when parent references are available', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = {
            ...baseAvailableContext,
            objectApiName: 'Contact',
            parentReferences: [
                {
                    referenceFieldApiName: 'AccountId',
                    referenceFieldLabel: 'Account',
                    parentObjectApiName: 'Account',
                    parentObjectLabel: 'Account',
                    parentRecordId: '001000000000001AAA',
                    parentRecordName: 'Acme',
                    includedByDefault: false
                }
            ]
        };
        element.includedParentReferenceFields = [];
        document.body.appendChild(element);

        await flushPromises();

        expect(element.shadowRoot.textContent).toContain('Parent Records');
        expect(element.shadowRoot.textContent).toContain('Account');
    });

    it('fires parentcontextchange when a parent reference toggle changes', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = {
            ...baseAvailableContext,
            objectApiName: 'Contact',
            parentReferences: [
                {
                    referenceFieldApiName: 'AccountId',
                    referenceFieldLabel: 'Account',
                    parentObjectApiName: 'Account',
                    parentObjectLabel: 'Account',
                    parentRecordId: '001000000000001AAA',
                    parentRecordName: 'Acme',
                    includedByDefault: false
                }
            ]
        };
        element.includedParentReferenceFields = [];
        element.maxParentReferencesSelected = 5;
        document.body.appendChild(element);

        const handler = jest.fn();
        element.addEventListener('parentcontextchange', handler);

        await flushPromises();

        const toggleButton = element.shadowRoot.querySelector('button.section-toggle');
        if (toggleButton) {
            toggleButton.click();
            await flushPromises();
        }

        const parentToggle = element.shadowRoot.querySelector('input[data-reference="AccountId"]');
        expect(parentToggle).not.toBeNull();
        parentToggle.checked = true;
        parentToggle.dispatchEvent(new CustomEvent('change'));
        await flushPromises();

        expect(handler).toHaveBeenCalled();
        const detail = handler.mock.calls[0][0].detail;
        expect(detail.includedParentReferenceFields).toContain('AccountId');
    });

    it('fires parentcontextchange when the same-object siblings toggle changes', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = {
            ...baseAvailableContext,
            objectApiName: 'Contact',
            parentReferences: [
                {
                    referenceFieldApiName: 'AccountId',
                    referenceFieldLabel: 'Account',
                    parentObjectApiName: 'Account',
                    parentObjectLabel: 'Account',
                    parentRecordId: '001000000000001AAA',
                    parentRecordName: 'Acme',
                    includedByDefault: true
                }
            ]
        };
        element.includedParentReferenceFields = ['AccountId'];
        element.includeSameObjectSiblingsThroughParents = false;
        document.body.appendChild(element);

        const handler = jest.fn();
        element.addEventListener('parentcontextchange', handler);

        await flushPromises();

        const toggleButton = element.shadowRoot.querySelector('button.section-toggle');
        if (toggleButton) {
            toggleButton.click();
            await flushPromises();
        }

        const siblingsToggle = element.shadowRoot.querySelector(
            'input[type="checkbox"][onchange], input[type="checkbox"]'
        );
        const allChecks = element.shadowRoot.querySelectorAll('input[type="checkbox"]');
        let siblingsInput = null;
        allChecks.forEach((cb) => {
            const label = cb.closest('label');
            if (label && label.textContent.includes('same-object siblings')) {
                siblingsInput = cb;
            }
        });
        expect(siblingsInput).not.toBeNull();

        siblingsInput.checked = true;
        siblingsInput.dispatchEvent(new CustomEvent('change'));
        await flushPromises();

        expect(handler).toHaveBeenCalled();
        const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0].detail;
        expect(lastCall.includeSameObjectSiblingsThroughParents).toBe(true);
    });

    it('narrows the token estimate to the per-field override count when in field selection mode', async () => {
        const element = createElement('c-context-panel', {
            is: ContextPanel
        });
        element.availableContext = {
            ...baseAvailableContext,
            fieldCategories: [
                {
                    name: 'core',
                    label: 'Core Fields',
                    includedByDefault: true,
                    fieldCount: 20,
                    fields: []
                }
            ]
        };
        element.includedCategories = ['core'];
        element.showUsageMetrics = true;
        element.fieldSelectionMode = 'fields';
        element.includedFields = ['Name', 'Industry'];
        document.body.appendChild(element);

        await flushPromises();

        // 2 fields * 15 tokens = 30 tokens (overrides the 20-field category default).
        expect(element.shadowRoot.textContent).toContain('30 tokens');
        expect(element.shadowRoot.textContent).not.toContain('300 tokens');
    });
});
