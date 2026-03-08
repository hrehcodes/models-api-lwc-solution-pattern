import { createElement } from 'lwc';
import RecordCompare from 'c/recordCompare';
import getAvailableCompareObjects from '@salesforce/apex/RecordCompareService.getAvailableCompareObjects';
import getComparisonContext from '@salesforce/apex/RecordCompareService.getComparisonContext';
import searchRecords from '@salesforce/apex/RecordCompareService.searchRecords';
import getSuggestedRecords from '@salesforce/apex/RecordCompareService.getSuggestedRecords';

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
            records: []
        });
        searchRecords.mockResolvedValue([
            { id: '001000000000010AAA', name: 'Alpha Account' }
        ]);
        getSuggestedRecords.mockResolvedValue([]);
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
});
