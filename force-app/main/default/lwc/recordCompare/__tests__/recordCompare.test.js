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

    it('loads object options from Apex instead of a hardcoded list', async () => {
        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        document.body.appendChild(element);

        await flushPromises();

        const combo = element.shadowRoot.querySelector('lightning-combobox');
        expect(combo.options).toEqual([
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

        const combo = element.shadowRoot.querySelector('lightning-combobox');
        combo.dispatchEvent(
            new CustomEvent('change', {
                detail: { value: 'Custom_Object__c' }
            })
        );
        await flushPromises();

        const inputs = element.shadowRoot.querySelectorAll('lightning-input');
        const recordSearchInput = inputs[1];
        recordSearchInput.dispatchEvent(
            new CustomEvent('change', {
                detail: { value: 'Alpha' }
            })
        );

        jest.advanceTimersByTime(300);
        await flushPromises();

        expect(searchRecords).toHaveBeenCalledWith({
            objectApiName: 'Custom_Object__c',
            searchTerm: 'Alpha',
            maxResults: 10
        });
    });

    it('loads comparison context with the shared field, relationship, and depth settings', async () => {
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
        element.maxCompareRecords = 4;
        element.relatedRecordsPerRelationship = 7;
        document.body.appendChild(element);

        await flushPromises();

        const searchInput = element.shadowRoot.querySelector('lightning-input');
        searchInput.dispatchEvent(
            new CustomEvent('change', {
                detail: { value: 'Second' }
            })
        );

        jest.advanceTimersByTime(300);
        await flushPromises();

        const resultItem = element.shadowRoot.querySelector('.result-item');
        resultItem.click();
        await flushPromises();

        const loadButton = [...element.shadowRoot.querySelectorAll('lightning-button')]
            .find(button => button.label === 'Load Comparison');
        loadButton.click();
        await flushPromises();

        expect(getComparisonContext).toHaveBeenCalledWith({
            recordIds: ['001000000000001AAA', '001000000000010AAA'],
            depth: 1,
            includedCategories: ['core'],
            includedRelationships: ['Contacts'],
            maxCompareRecords: 4,
            maxRelatedRecords: 7
        });
    });

    it('prevents adding records beyond the configured compare limit and shows a warning', async () => {
        searchRecords.mockResolvedValue([
            { id: '001000000000010AAA', name: 'Alpha Account' },
            { id: '001000000000011AAA', name: 'Beta Account' }
        ]);

        const element = createElement('c-record-compare', {
            is: RecordCompare
        });
        element.objectApiName = 'Account';
        element.recordId = '001000000000001AAA';
        element.maxCompareRecords = 2;
        document.body.appendChild(element);

        await flushPromises();

        const searchInput = element.shadowRoot.querySelector('lightning-input');
        searchInput.dispatchEvent(
            new CustomEvent('change', {
                detail: { value: 'Account' }
            })
        );

        jest.advanceTimersByTime(300);
        await flushPromises();

        const resultItems = element.shadowRoot.querySelectorAll('.result-item');
        resultItems[0].click();
        await flushPromises();

        expect(element.shadowRoot.textContent).toContain('configured compare limit of 2 records');
        expect(element.shadowRoot.querySelectorAll('.result-item')).toHaveLength(0);
    });
});
