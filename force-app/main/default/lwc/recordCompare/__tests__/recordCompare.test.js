import { createElement } from 'lwc';
import RecordCompare from 'c/recordCompare';
import getAvailableCompareObjects from '@salesforce/apex/RecordCompareService.getAvailableCompareObjects';
import getComparisonContext from '@salesforce/apex/RecordCompareService.getComparisonContext';
import searchRecords from '@salesforce/apex/RecordCompareService.searchRecords';
import getSuggestedRecords from '@salesforce/apex/RecordCompareService.getSuggestedRecords';
import getAvailableContextForObject from '@salesforce/apex/RecordContextService.getAvailableContextForObject';

jest.mock(
    '@salesforce/apex/RecordCompareService.getAvailableCompareObjects',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordCompareService.getComparisonContext',
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
    '@salesforce/apex/RecordCompareService.getSuggestedRecords',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

jest.mock(
    '@salesforce/apex/RecordContextService.getAvailableContextForObject',
    () => ({
        default: jest.fn()
    }),
    { virtual: true }
);

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

describe('c-record-compare', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        getAvailableCompareObjects.mockResolvedValue([
            { apiName: 'Account', label: 'Account' },
            { apiName: 'Custom_Object__c', label: 'Custom Object' }
        ]);
        getComparisonContext.mockResolvedValue({
            records: [],
            completeness: {
                isComplete: true,
                hasWarnings: false,
                warningMessages: []
            }
        });
        searchRecords.mockResolvedValue([
            { id: '001000000000010AAA', name: 'Alpha Account' }
        ]);
        getSuggestedRecords.mockResolvedValue([]);
        getAvailableContextForObject.mockResolvedValue({
            objectApiName: 'Account',
            objectLabel: 'Account',
            recordName: 'Account comparison settings',
            fieldCategories: [
                {
                    name: 'core',
                    label: 'Core Fields',
                    includedByDefault: true,
                    fieldCount: 1,
                    fields: [{ apiName: 'Name', label: 'Account Name', fieldType: 'STRING' }]
                }
            ],
            relationships: [
                {
                    relationshipName: 'Contacts',
                    childObjectLabel: 'Contact',
                    recordCount: 1,
                    includedByDefault: true
                }
            ],
            completeness: {
                isComplete: true,
                hasWarnings: false,
                warningMessages: []
            }
        });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('loads object options from Apex into the shared picker', async () => {
        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        document.body.appendChild(element);

        await flushPromises();

        const picker = element.shadowRoot.querySelector('c-record-picker');
        expect(picker.objectTypeOptions).toEqual([
            { label: 'Account', value: 'Account' },
            { label: 'Custom Object', value: 'Custom_Object__c' }
        ]);
    });

    it('uses the selected dynamic object type when searching for records', async () => {
        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        document.body.appendChild(element);

        await flushPromises();

        const picker = element.shadowRoot.querySelector('c-record-picker');
        picker.dispatchEvent(
            new CustomEvent('objecttypechange', {
                detail: { value: 'Custom_Object__c' }
            })
        );
        await flushPromises();

        picker.dispatchEvent(
            new CustomEvent('searchchange', {
                detail: { value: 'Alpha' }
            })
        );

        jest.advanceTimersByTime(300);
        await flushPromises();

        expect(searchRecords).toHaveBeenLastCalledWith({
            objectApiName: 'Custom_Object__c',
            searchTerm: 'Alpha',
            maxResults: 10
        });
    });

    it('uses the staged compare flow to review optional settings and load chat context', async () => {
        getComparisonContext.mockResolvedValue({
            records: [
                {
                    recordId: '001000000000001AAA',
                    recordName: 'Current Record',
                    fields: {},
                    relatedRecordSets: [],
                    completeness: {
                        isComplete: true,
                        hasWarnings: false,
                        warningMessages: []
                    }
                },
                {
                    recordId: '001000000000002AAA',
                    recordName: 'Second Record',
                    fields: {},
                    relatedRecordSets: [],
                    completeness: {
                        isComplete: true,
                        hasWarnings: false,
                        warningMessages: []
                    }
                }
            ],
            completeness: {
                isComplete: true,
                hasWarnings: false,
                warningMessages: []
            }
        });

        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Account';
        element.recordId = '001000000000001AAA';
        element.showInlineUsageStatus = true;
        element.maxCompareRecords = 4;
        element.relatedRecordsPerRelationship = 7;
        document.body.appendChild(element);

        await flushPromises(6);

        const picker = element.shadowRoot.querySelector('c-record-picker');
        picker.dispatchEvent(
            new CustomEvent('searchchange', {
                detail: { value: 'Second' }
            })
        );

        jest.advanceTimersByTime(300);
        await flushPromises();

        picker.dispatchEvent(
            new CustomEvent('recordselect', {
                detail: { id: '001000000000010AAA', name: 'Alpha Account' }
            })
        );
        await flushPromises();

        const actionBar = element.shadowRoot.querySelector('.selection-actions');
        expect(actionBar).not.toBeNull();
        expect(actionBar.textContent).toContain('Ready to compare 2 records');

        [...actionBar.querySelectorAll('lightning-button')]
            .find(button => button.label === 'Optional Context Settings')
            .click();
        await flushPromises();

        expect(element.shadowRoot.querySelector('c-context-panel')).not.toBeNull();

        [...element.shadowRoot.querySelectorAll('lightning-button')]
            .find(button => button.label === 'Load Comparison')
            .click();
        await flushPromises();

        expect(getComparisonContext).toHaveBeenCalledWith({
            recordIds: ['001000000000001AAA', '001000000000010AAA'],
            depth: 1,
            includedCategories: ['core'],
            includedRelationships: ['Contacts'],
            maxCompareRecords: 4,
            maxRelatedRecords: 7,
            promptWarningThresholdTokens: 20000
        });

        expect(element.shadowRoot.querySelector('c-chat-panel')).not.toBeNull();
        expect(element.shadowRoot.querySelector('c-chat-panel').showInlineUsageStatus).toBe(true);
    });

    it('prevents adding records beyond the configured compare limit and shows a warning', async () => {
        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Account';
        element.recordId = '001000000000001AAA';
        element.maxCompareRecords = 2;
        document.body.appendChild(element);

        await flushPromises(6);

        const picker = element.shadowRoot.querySelector('c-record-picker');
        picker.dispatchEvent(
            new CustomEvent('recordselect', {
                detail: { id: '001000000000010AAA', name: 'Alpha Account' }
            })
        );
        await flushPromises();

        expect(picker.hasReachedSelectionLimit).toBe(true);
        expect(picker.selectionLimitMessage).toContain('configured compare limit of 2 records');
    });

    it('keeps discovery-only count warnings local and does not mark the comparison incomplete', async () => {
        getAvailableContextForObject.mockResolvedValue({
            objectApiName: 'Account',
            objectLabel: 'Account',
            recordName: 'Account comparison settings',
            fieldCategories: [
                {
                    name: 'core',
                    label: 'Core Fields',
                    includedByDefault: true,
                    fieldCount: 1,
                    fields: [{ apiName: 'Name', label: 'Account Name', fieldType: 'STRING' }]
                }
            ],
            relationships: [
                {
                    relationshipName: 'Contacts',
                    childObjectLabel: 'Contact',
                    countStatus: 'unknown',
                    includedByDefault: true
                }
            ],
            completeness: {
                isComplete: false,
                hasWarnings: true,
                warningMessages: ['Some related record counts could not be calculated and are shown without counts.']
            }
        });

        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Account';
        element.recordId = '001000000000001AAA';
        document.body.appendChild(element);

        await flushPromises(6);

        const picker = element.shadowRoot.querySelector('c-record-picker');
        picker.dispatchEvent(
            new CustomEvent('recordselect', {
                detail: { id: '001000000000010AAA', name: 'Alpha Account' }
            })
        );
        await flushPromises();

        [...element.shadowRoot.querySelectorAll('lightning-button')]
            .find(button => button.label === 'Optional Context Settings')
            .click();
        await flushPromises();

        const contextPanel = element.shadowRoot.querySelector('c-context-panel');
        expect(contextPanel.contextStatus).toBe('ready');
        expect(contextPanel.contextWarningSummary).toBeNull();
        expect(contextPanel.availableContext.relationships[0].countStatus).toBe('unknown');

        [...element.shadowRoot.querySelectorAll('lightning-button')]
            .find(button => button.label === 'Load Comparison')
            .click();
        await flushPromises();

        const chatPanel = element.shadowRoot.querySelector('c-chat-panel');
        expect(chatPanel.contextStatus).toBe('ready');
        expect(chatPanel.contextWarningSummary).toBeNull();
        expect(chatPanel.comparisonContextJson).toContain('"contextStatus":"ready"');
    });

    it('shows an unsupported-object message when the current object is not in the safe compare subset', async () => {
        searchRecords.mockRejectedValue({
            body: {
                message: 'Invalid or inaccessible object type.'
            }
        });
        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'OpportunityLineItem';
        element.recordId = '00k000000000001AAA';
        document.body.appendChild(element);

        await flushPromises(6);

        const picker = element.shadowRoot.querySelector('c-record-picker');
        expect(picker.objectTypeError).toBe('OpportunityLineItem is not supported for compare mode.');
        expect(element.shadowRoot.textContent).toContain('OpportunityLineItem is not supported for compare mode.');
        expect(searchRecords).toHaveBeenCalledWith({
            objectApiName: 'OpportunityLineItem',
            searchTerm: '',
            maxResults: 1
        });
        expect(getSuggestedRecords).not.toHaveBeenCalled();
    });

    it('shows a support-check message while object support is still loading for record-page compare mode', async () => {
        const deferred = createDeferred();
        getAvailableCompareObjects.mockReturnValue(deferred.promise);

        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Opportunity';
        element.recordId = '006000000000001AAA';
        document.body.appendChild(element);
        await flushPromises();

        expect(element.shadowRoot.textContent).toContain('Checking compare support for Opportunity.');
        expect(element.shadowRoot.textContent).toContain('Preparing compare for Opportunity');
        expect(element.shadowRoot.textContent).toContain('Getting org metadata');
        expect(element.shadowRoot.textContent).not.toContain('Compare mode is not supported for Opportunity.');

        jest.advanceTimersByTime(1400);
        await flushPromises();
        expect(element.shadowRoot.textContent).toContain('Checking Opportunity');

        deferred.resolve([
            { apiName: 'Opportunity', label: 'Opportunity' }
        ]);
        await flushPromises(6);

        expect(element.shadowRoot.textContent).toContain('Select 1 more record to enable comparison.');
    });

    it('keeps the support-check state visible while the current record-page object is being validated directly', async () => {
        const validationDeferred = createDeferred();
        getAvailableCompareObjects.mockResolvedValue([
            { apiName: 'Account', label: 'Account' }
        ]);
        searchRecords.mockImplementation(({ objectApiName, searchTerm }) => {
            if (objectApiName === 'Opportunity' && searchTerm === '') {
                return validationDeferred.promise;
            }

            return Promise.resolve([
                { id: '006000000000010AAA', name: 'Renewal Deal' }
            ]);
        });

        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Opportunity';
        element.recordId = '006000000000001AAA';
        document.body.appendChild(element);

        await flushPromises(2);

        expect(element.shadowRoot.textContent).toContain('Checking compare support for Opportunity.');
        expect(element.shadowRoot.textContent).toContain('Preparing compare for Opportunity');
        expect(element.shadowRoot.textContent).toContain('Getting org metadata');
        expect(element.shadowRoot.textContent).not.toContain('Opportunity is not supported for compare mode.');

        jest.advanceTimersByTime(1400);
        await flushPromises();
        expect(element.shadowRoot.textContent).toContain('Checking Opportunity');

        validationDeferred.resolve([
            { id: '006000000000010AAA', name: 'Renewal Deal' }
        ]);
        await flushPromises(6);

        expect(element.shadowRoot.textContent).toContain('Select 1 more record to enable comparison.');
        expect(element.shadowRoot.textContent).not.toContain('Opportunity is not supported for compare mode.');
    });

    it('keeps the current record-page object supported when direct validation succeeds even if it is absent from the options list', async () => {
        getAvailableCompareObjects.mockResolvedValue([
            { apiName: 'Account', label: 'Account' }
        ]);
        getAvailableContextForObject.mockResolvedValue({
            objectApiName: 'Opportunity',
            objectLabel: 'Opportunity',
            recordName: 'Opportunity comparison settings',
            fieldCategories: [
                {
                    name: 'core',
                    label: 'Core Fields',
                    includedByDefault: true,
                    fieldCount: 1,
                    fields: [{ apiName: 'Name', label: 'Opportunity Name', fieldType: 'STRING' }]
                }
            ],
            relationships: [],
            completeness: {
                isComplete: true,
                hasWarnings: false,
                warningMessages: []
            }
        });
        searchRecords.mockResolvedValue([
            { id: '006000000000010AAA', name: 'Renewal Deal' }
        ]);

        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Opportunity';
        element.recordId = '006000000000001AAA';
        document.body.appendChild(element);

        await flushPromises(6);

        expect(element.shadowRoot.textContent).not.toContain('Opportunity is not supported for compare mode.');
        expect(searchRecords).toHaveBeenCalledWith({
            objectApiName: 'Opportunity',
            searchTerm: '',
            maxResults: 1
        });
        expect(getAvailableContextForObject).toHaveBeenCalledWith({
            objectApiName: 'Opportunity',
            referenceRecordId: '006000000000001AAA'
        });
    });
});
