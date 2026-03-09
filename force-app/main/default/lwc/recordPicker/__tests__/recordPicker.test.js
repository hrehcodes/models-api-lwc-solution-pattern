import { createElement } from 'lwc';
import RecordPicker from 'c/recordPicker';

const flushPromises = async (count = 3) => {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
};

describe('c-record-picker', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('emits objecttypechange when the user selects an object', async () => {
        const element = createElement('c-record-picker', {
            is: RecordPicker
        });
        element.showObjectPicker = true;
        element.objectTypeOptions = [
            { label: 'Account', value: 'Account' },
            { label: 'Contact', value: 'Contact' }
        ];
        document.body.appendChild(element);

        const handler = jest.fn();
        element.addEventListener('objecttypechange', handler);

        const combobox = element.shadowRoot.querySelector('lightning-combobox');
        combobox.dispatchEvent(
            new CustomEvent('change', {
                detail: { value: 'Contact' }
            })
        );

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({ value: 'Contact' });
    });

    it('emits recordselect when a search result is clicked', async () => {
        const element = createElement('c-record-picker', {
            is: RecordPicker
        });
        element.canSearch = true;
        element.searchResults = [
            { id: '001000000000001AAA', name: 'Acme', source: 'search' }
        ];
        document.body.appendChild(element);
        await flushPromises();

        const handler = jest.fn();
        element.addEventListener('recordselect', handler);

        const result = element.shadowRoot.querySelector('.result-item');
        result.click();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({
            id: '001000000000001AAA',
            name: 'Acme',
            source: 'search'
        });
    });

    it('supports advanced manual ID entry as a fallback flow', async () => {
        const element = createElement('c-record-picker', {
            is: RecordPicker
        });
        element.showAdvancedIdEntry = true;
        document.body.appendChild(element);
        await flushPromises();

        const idChangeHandler = jest.fn();
        const loadHandler = jest.fn();
        element.addEventListener('manualidchange', idChangeHandler);
        element.addEventListener('manualload', loadHandler);

        const toggleButton = element.shadowRoot.querySelector('lightning-button.manual-toggle');
        toggleButton.click();
        await flushPromises();

        const manualInput = [...element.shadowRoot.querySelectorAll('lightning-input')]
            .find(input => input.label === 'Record ID');
        manualInput.dispatchEvent(
            new CustomEvent('change', {
                detail: { value: '001000000000009AAA' }
            })
        );

        expect(idChangeHandler).toHaveBeenCalledTimes(1);
        expect(idChangeHandler.mock.calls[0][0].detail).toEqual({ value: '001000000000009AAA' });

        element.manualRecordId = '001000000000009AAA';
        await flushPromises();

        const loadButton = [...element.shadowRoot.querySelectorAll('lightning-button')]
            .find(button => button.label === 'Load Record');
        loadButton.click();

        expect(loadHandler).toHaveBeenCalledTimes(1);
        expect(loadHandler.mock.calls[0][0].detail).toEqual({ value: '001000000000009AAA' });
    });

    it('emits recordremove when a selected pill is removed', async () => {
        const element = createElement('c-record-picker', {
            is: RecordPicker
        });
        element.selectedRecords = [
            { id: '001000000000001AAA', name: 'Acme' }
        ];
        document.body.appendChild(element);
        await flushPromises();

        const handler = jest.fn();
        element.addEventListener('recordremove', handler);

        const pill = element.shadowRoot.querySelector('lightning-pill');
        pill.dispatchEvent(new CustomEvent('remove'));

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({ id: '001000000000001AAA' });
    });
});
