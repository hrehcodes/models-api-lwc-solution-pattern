import { buildComparisonSignals, buildContextSignals } from 'c/contextSignalUtils';

describe('c-context-signal-utils', () => {
    const today = new Date('2026-05-04T12:00:00.000Z');

    it('builds object-agnostic record signals from field labels and values', () => {
        const result = buildContextSignals({
            today,
            selectionSummary: { selectedRelationships: ['Children__r'] },
            recordContext: {
                recordId: 'a00000000000001AAA',
                recordName: 'Custom Renewal',
                fields: {
                    Renewal_Date__c: {
                        label: 'Renewal Date',
                        value: '2026-04-01',
                        fieldType: 'DATE',
                        isCustom: true
                    },
                    Health__c: {
                        label: 'Customer Health',
                        value: 'Bad'
                    },
                    Next_Action__c: {
                        label: 'Next Action',
                        value: ''
                    },
                    Budget_Confirmed__c: {
                        label: 'Budget Confirmed',
                        value: false
                    },
                    Expected_Value__c: {
                        label: 'Expected Value',
                        value: 5000
                    }
                },
                relatedRecordSets: [
                    {
                        relationshipName: 'Children__r',
                        childObjectLabel: 'Child Records',
                        records: []
                    }
                ]
            }
        });

        expect(result.signals.map(signal => signal.type)).toEqual(expect.arrayContaining([
            'overdueDate',
            'negativeStatus',
            'blankActionField',
            'falseCheckpoint',
            'calculatedFinancialCaveat',
            'selectedEmptyRelationship'
        ]));
        expect(result.relationshipCoverage[0]).toEqual(expect.objectContaining({
            relationshipName: 'Children__r',
            includedRecordCount: 0,
            selected: true
        }));
    });

    it('builds compare-level differences without object-specific assumptions', () => {
        const result = buildComparisonSignals({
            today,
            selectionSummary: { selectedRelationships: ['Items__r'] },
            comparisonContext: {
                objectApiName: 'Custom_Object__c',
                objectLabel: 'Custom Object',
                records: [
                    {
                        recordId: 'a00000000000001AAA',
                        recordName: 'Alpha',
                        fields: {
                            Status__c: { label: 'Status', value: 'Green' },
                            Score__c: { label: 'Score', value: 10 }
                        },
                        relatedRecordSets: [
                            { relationshipName: 'Items__r', childObjectLabel: 'Items', records: [] }
                        ]
                    },
                    {
                        recordId: 'a00000000000002AAA',
                        recordName: 'Beta',
                        fields: {
                            Status__c: { label: 'Status', value: 'Blocked' },
                            Score__c: { label: 'Score', value: 99 }
                        },
                        relatedRecordSets: [
                            { relationshipName: 'Items__r', childObjectLabel: 'Items', records: [{ Id: { value: 'x' } }] }
                        ]
                    }
                ]
            }
        });

        expect(result.recordSignals).toHaveLength(2);
        expect(result.recordSignals[1].signals.map(signal => signal.type)).toContain('negativeStatus');
        expect(result.signals.map(signal => signal.type)).toEqual(expect.arrayContaining([
            'statusDifference',
            'relationshipCountDifference',
            'numericDifference'
        ]));
    });
});
