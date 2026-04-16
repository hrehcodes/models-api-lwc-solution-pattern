import { createElement } from 'lwc';
import InsightsFieldSelector from 'c/insightsFieldSelector';

const flushPromises = async (count = 2) => {
    for (let index = 0; index < count; index += 1) {
        await Promise.resolve();
    }
};

const baseCategories = [
    {
        name: 'core',
        label: 'Core Fields',
        includedByDefault: true,
        fieldCount: 2,
        fields: [
            { apiName: 'Name', label: 'Name', fieldType: 'STRING' },
            { apiName: 'Industry', label: 'Industry', fieldType: 'PICKLIST' }
        ]
    },
    {
        name: 'dates',
        label: 'Dates',
        includedByDefault: false,
        fieldCount: 1,
        fields: [
            { apiName: 'CreatedDate', label: 'Created Date', fieldType: 'DATETIME' }
        ]
    }
];

describe('c-insights-field-selector', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('emits fieldselectionchange with categories payload in category mode', async () => {
        const element = createElement('c-insights-field-selector', {
            is: InsightsFieldSelector
        });
        element.fieldCategories = baseCategories;
        element.includedCategories = ['core'];
        document.body.appendChild(element);
        await flushPromises();

        const handler = jest.fn();
        element.addEventListener('fieldselectionchange', handler);

        const applyBtn = Array.from(
            element.shadowRoot.querySelectorAll('lightning-button')
        ).find((b) => b.label === 'Apply');
        applyBtn.click();
        await flushPromises();

        expect(handler).toHaveBeenCalled();
        const detail = handler.mock.calls[0][0].detail;
        expect(detail.fieldSelectionMode).toBe('categories');
        expect(detail.includedFields).toEqual([]);
        expect(detail.includedCategories).toEqual(['core']);
    });

    it('emits the per-field selection when selection mode is fields', async () => {
        const element = createElement('c-insights-field-selector', {
            is: InsightsFieldSelector
        });
        element.fieldCategories = baseCategories;
        element.includedCategories = ['core'];
        element.includedFields = ['Name'];
        element.selectionMode = 'fields';
        document.body.appendChild(element);
        await flushPromises();

        const handler = jest.fn();
        element.addEventListener('fieldselectionchange', handler);

        const applyBtn = Array.from(
            element.shadowRoot.querySelectorAll('lightning-button')
        ).find((b) => b.label === 'Apply');
        applyBtn.click();
        await flushPromises();

        expect(handler).toHaveBeenCalled();
        const detail = handler.mock.calls[0][0].detail;
        expect(detail.fieldSelectionMode).toBe('fields');
        expect(detail.includedFields).toEqual(['Name']);
    });

    it('restricts the field picker to fields in included categories', async () => {
        const element = createElement('c-insights-field-selector', {
            is: InsightsFieldSelector
        });
        element.fieldCategories = baseCategories;
        element.includedCategories = ['core'];
        element.selectionMode = 'fields';
        document.body.appendChild(element);
        await flushPromises();

        const textContent = element.shadowRoot.textContent;
        expect(textContent).toContain('Name');
        expect(textContent).toContain('Industry');
        expect(textContent).not.toContain('Created Date');
    });
});
