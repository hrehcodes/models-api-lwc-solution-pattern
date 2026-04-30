import { createElement } from 'lwc';
import AgentforceRecordInsights from 'c/agentforceRecordInsights';
import getAvailableContext from '@salesforce/apex/RecordContextService.getAvailableContext';
import getRecordContext from '@salesforce/apex/RecordContextService.getRecordContext';
import getAvailableCompareObjects from '@salesforce/apex/RecordCompareService.getAvailableCompareObjects';
import searchRecords from '@salesforce/apex/RecordCompareService.searchRecords';
import getAvailableModels from '@salesforce/apex/RecordAdvisorController.getAvailableModels';

jest.mock(
    '@salesforce/apex/RecordContextService.getAvailableContext',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordContextService.getRecordContext',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordCompareService.getAvailableCompareObjects',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordCompareService.searchRecords',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordAdvisorController.getAvailableModels',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

const getAvailableModelsAdapter = {
    emit: jest.fn()
};
const flushPromises = async (count = 4) => {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
};

const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
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
            fieldCount: 1,
            fields: [{ apiName: 'Name', label: 'Account Name', fieldType: 'STRING' }]
        }
    ],
    relationships: [],
    completeness: {
        isComplete: true,
        hasWarnings: false,
        warningMessages: []
    }
};

const baseRecordContext = {
    objectApiName: 'Account',
    objectLabel: 'Account',
    recordName: 'Acme',
    fields: {
        Name: {
            label: 'Account Name',
            value: 'Acme'
        }
    },
    relatedRecordSets: [],
    completeness: {
        isComplete: true,
        hasWarnings: false,
        warningMessages: []
    }
};

const originalResizeObserver = global.ResizeObserver;

describe('c-agentforce-record-insights', () => {
    beforeEach(() => {
        global.ResizeObserver = class {
            observe() {}
            disconnect() {}
        };
        window.ResizeObserver = global.ResizeObserver;

        getAvailableContext.mockResolvedValue(baseAvailableContext);
        getRecordContext.mockResolvedValue(baseRecordContext);
        getAvailableModels.mockResolvedValue([]);
        getAvailableCompareObjects.mockResolvedValue([
            { apiName: 'Account', label: 'Account' }
        ]);
        searchRecords.mockResolvedValue([
            { id: '001000000000010AAA', name: 'App Picker Account' }
        ]);
    });

    afterEach(() => {
        jest.useRealTimers();
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        global.ResizeObserver = originalResizeObserver;
        window.ResizeObserver = originalResizeObserver;
        jest.clearAllMocks();
    });

    it('passes ready context state to child panels and wraps chat JSON with selection metadata', async () => {
        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        element.showInlineUsageStatus = true;
        element.relatedRecordsPerRelationship = 7;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const contextPanel = element.shadowRoot.querySelector('c-context-panel');
        const chatPanel = element.shadowRoot.querySelector('c-chat-panel');

        expect(contextPanel.contextStatus).toBe('ready');
        expect(chatPanel.contextStatus).toBe('ready');
        expect(getRecordContext).toHaveBeenCalledWith({
            recordId: '001000000000001AAA',
            depth: 1,
            includedCategories: ['core'],
            includedRelationships: [],
            maxRelatedRecords: 7,
            includedParentReferenceFields: [],
            includeSameObjectSiblingsThroughParents: false,
            parentSiblingRelationshipByReferenceField: {},
            includedFields: null
        });
        expect(chatPanel.recordContextJson).toContain('"selectionSummary"');
        expect(chatPanel.recordContextJson).toContain('"recordContext"');
        expect(chatPanel.recordContextJson).toContain('"completeness"');
        expect(chatPanel.showInlineUsageStatus).toBe(true);
        expect(element.shadowRoot.querySelector('c-record-compare')).not.toBeNull();
        expect(element.shadowRoot.querySelector('c-record-compare').showInlineUsageStatus).toBe(true);
    });

    it('does not mount compare mode in the background when preload compare mode is turned off', async () => {
        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.preloadCompareMode = false;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.shadowRoot.querySelector('c-record-compare')).toBeNull();
    });

    it('renders with the default header layout when ResizeObserver is unavailable', async () => {
        global.ResizeObserver = undefined;
        window.ResizeObserver = undefined;

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';

        expect(() => {
            document.body.appendChild(element);
        }).not.toThrow();

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.shadowRoot.querySelector('lightning-button-group')).not.toBeNull();
        expect(element.shadowRoot.querySelector('lightning-button-menu')).toBeNull();
        expect(element.shadowRoot.textContent).toContain('Agentforce Record Insights');
    });

    it('renders with the default header layout when ResizeObserver is not constructable', async () => {
        const nonConstructableResizeObserver = () => ({
            observe() {},
            disconnect() {}
        });
        global.ResizeObserver = nonConstructableResizeObserver;
        window.ResizeObserver = nonConstructableResizeObserver;

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';

        expect(() => {
            document.body.appendChild(element);
        }).not.toThrow();

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.shadowRoot.querySelector('lightning-button-group')).not.toBeNull();
        expect(element.shadowRoot.querySelector('lightning-button-menu')).toBeNull();
        expect(element.shadowRoot.textContent).toContain('Agentforce Record Insights');
    });

    it('shows richer loading copy while insights context is being prepared', async () => {
        jest.useFakeTimers();
        const availableDeferred = createDeferred();
        getAvailableContext.mockReturnValue(availableDeferred.promise);

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.preloadCompareMode = false;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.shadowRoot.textContent).toContain('Preparing grounded insights');
        expect(element.shadowRoot.textContent).toContain('Getting org metadata');

        jest.advanceTimersByTime(1400);
        await flushPromises();
        expect(element.shadowRoot.textContent).toContain('Discovering relationships');

        availableDeferred.resolve(baseAvailableContext);
        await flushPromises();
    });

    it('surfaces partial context warnings from Apex completeness metadata', async () => {
        getRecordContext.mockResolvedValue({
            ...baseRecordContext,
            completeness: {
                isComplete: false,
                hasWarnings: true,
                warningMessages: ['Some field values could not be included in the record context.']
            }
        });

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const contextPanel = element.shadowRoot.querySelector('c-context-panel');
        const chatPanel = element.shadowRoot.querySelector('c-chat-panel');

        expect(contextPanel.contextStatus).toBe('partial');
        expect(chatPanel.contextStatus).toBe('partial');
        expect(chatPanel.contextWarningMessages).toContain(
            'Some field values could not be included in the record context.'
        );
    });

    it('does not treat discovery-only count warnings as incomplete loaded context', async () => {
        getAvailableContext.mockResolvedValue({
            ...baseAvailableContext,
            completeness: {
                isComplete: false,
                hasWarnings: true,
                warningMessages: ['Some related record counts could not be calculated and are shown without counts.']
            }
        });

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const contextPanel = element.shadowRoot.querySelector('c-context-panel');
        const chatPanel = element.shadowRoot.querySelector('c-chat-panel');

        expect(contextPanel.contextStatus).toBe('ready');
        expect(chatPanel.contextStatus).toBe('ready');
        expect(chatPanel.contextWarningSummary).toBeNull();
        expect(chatPanel.recordContextJson).toContain('"contextStatus":"ready"');
    });

    it('fails closed and surfaces an error when record context load fails', async () => {
        getRecordContext.mockRejectedValue({
            body: {
                message: 'Context query failed'
            }
        });

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        expect(element.recordContextJson).toBeNull();
        expect(element.contextError).toBe('Context query failed');
        expect(element.shadowRoot.querySelector('c-context-panel')).toBeNull();
        expect(element.shadowRoot.querySelector('c-chat-panel')).toBeNull();
        expect(element.shadowRoot.textContent).toContain('Context query failed');
    });

    it('passes the hide warnings builder setting to child panels', async () => {
        getRecordContext.mockResolvedValue({
            ...baseRecordContext,
            completeness: {
                isComplete: false,
                hasWarnings: true,
                warningMessages: ['Some field values could not be included in the record context.']
            }
        });

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        element.hideContextWarnings = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const contextPanel = element.shadowRoot.querySelector('c-context-panel');
        const chatPanel = element.shadowRoot.querySelector('c-chat-panel');

        expect(contextPanel.hideContextWarnings).toBe(true);
        expect(chatPanel.hideContextWarnings).toBe(true);
    });

    it('uses the shared picker to search and load a record for app-page insights mode', async () => {
        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.defaultMode = 'insights';
        element.availableModes = 'insightsOnly';
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const picker = element.shadowRoot.querySelector('c-record-picker');
        expect(picker).not.toBeNull();
        expect(picker.objectTypeOptions).toEqual([{ label: 'Account', value: 'Account' }]);

        picker.dispatchEvent(
            new CustomEvent('objecttypechange', {
                detail: { value: 'Account' }
            })
        );
        await flushPromises();

        picker.dispatchEvent(
            new CustomEvent('recordselect', {
                detail: { id: '001000000000010AAA', name: 'App Picker Account' }
            })
        );
        await flushPromises();

        expect(getAvailableContext).toHaveBeenCalledWith({
            recordId: '001000000000010AAA'
        });
        expect(getRecordContext).toHaveBeenCalledWith({
            recordId: '001000000000010AAA',
            depth: 1,
            includedCategories: ['core'],
            includedRelationships: [],
            maxRelatedRecords: 10,
            includedParentReferenceFields: [],
            includeSameObjectSiblingsThroughParents: false,
            parentSiblingRelationshipByReferenceField: {},
            includedFields: null
        });
    });

    it('supports manual record ID loading for app-page insights mode', async () => {
        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.defaultMode = 'insights';
        element.availableModes = 'insightsOnly';
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const picker = element.shadowRoot.querySelector('c-record-picker');
        picker.dispatchEvent(
            new CustomEvent('manualidchange', {
                detail: { value: '001000000000099AAA' }
            })
        );
        picker.dispatchEvent(
            new CustomEvent('manualload', {
                detail: { value: '001000000000099AAA' }
            })
        );
        await flushPromises();

        expect(getAvailableContext).toHaveBeenCalledWith({
            recordId: '001000000000099AAA'
        });
        expect(getRecordContext).toHaveBeenCalledWith({
            recordId: '001000000000099AAA',
            depth: 1,
            includedCategories: ['core'],
            includedRelationships: [],
            maxRelatedRecords: 10,
            includedParentReferenceFields: [],
            includeSameObjectSiblingsThroughParents: false,
            parentSiblingRelationshipByReferenceField: {},
            includedFields: null
        });
    });

    it('passes the resolved per-field override to Apex when Field Selection Mode is fields', async () => {
        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        element.fieldSelectionMode = 'fields';
        element.defaultIncludedFieldsCsv = 'Name,BogusField__c';
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const lastCall =
            getRecordContext.mock.calls[getRecordContext.mock.calls.length - 1][0];
        expect(lastCall.includedFields).toEqual(['Name']);
        const chatPanel = element.shadowRoot.querySelector('c-chat-panel');
        expect(chatPanel.recordContextJson).toContain('"fieldSelectionMode":"fields"');
        expect(chatPanel.recordContextJson).toContain('"selectedFields":["Name"]');
    });

    it('drops stale record context immediately while a refreshed payload is loading', async () => {
        jest.useFakeTimers();

        const element = createElement('c-agentforce-record-insights', {
            is: AgentforceRecordInsights
        });
        element.recordId = '001000000000001AAA';
        element.objectApiName = 'Account';
        element.startWithContextPanelOpen = true;
        document.body.appendChild(element);

        getAvailableModelsAdapter.emit([]);
        await flushPromises();

        const refreshDeferred = createDeferred();
        getRecordContext.mockImplementationOnce(() => refreshDeferred.promise);

        const contextPanel = element.shadowRoot.querySelector('c-context-panel');
        contextPanel.dispatchEvent(
            new CustomEvent('contextchange', {
                detail: {
                    includedCategories: ['core'],
                    includedRelationships: []
                }
            })
        );

        await flushPromises();
        expect(element.recordContextJson).toBeNull();
        expect(element.shadowRoot.querySelector('c-chat-panel')).toBeNull();

        jest.advanceTimersByTime(300);
        await flushPromises();

        refreshDeferred.resolve(baseRecordContext);
        await flushPromises();

        expect(element.shadowRoot.querySelector('c-chat-panel')).not.toBeNull();
        expect(element.recordContextJson).toContain('"recordContext"');
    });
});
