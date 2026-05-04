const MAX_SIGNALS = 12;
const MAX_COMPARE_RECORD_SIGNALS = 5;
const STALE_ACTIVITY_DAYS = 90;
const NEGATIVE_WORDS = [
    'bad',
    'blocked',
    'critical',
    'delayed',
    'escalated',
    'high risk',
    'lost',
    'red',
    'risk',
    'stalled',
    'unhealthy'
];
const DEADLINE_WORDS = [
    'close',
    'due',
    'deadline',
    'end',
    'expiry',
    'expiration',
    'renewal',
    'sla',
    'target'
];
const ACTION_WORDS = ['action', 'follow up', 'follow-up', 'next step', 'nextstep', 'plan', 'recommendation'];
const ACTIVITY_WORDS = ['activity', 'contacted', 'engagement', 'follow up', 'follow-up', 'last touch'];
const CHECKPOINT_WORDS = [
    'approved',
    'budget',
    'complete',
    'completed',
    'confirmed',
    'demo',
    'meeting',
    'qualified',
    'required',
    'reviewed',
    'roi',
    'validated',
    'verified'
];
const STATUS_WORDS = ['approval', 'forecast', 'health', 'phase', 'priority', 'rating', 'stage', 'status', 'type'];
const FINANCIAL_WORDS = ['amount', 'cost', 'credit', 'currency', 'price', 'revenue', 'total', 'value'];
const CALCULATED_FINANCIAL_WORDS = ['calculated', 'expected', 'forecast', 'weighted'];
const DISCOUNT_WORDS = ['discount', 'rebate', 'markdown'];

export function buildContextSignals({ recordContext, selectionSummary = {}, today = new Date() } = {}) {
    const normalizedToday = normalizeDate(today) || new Date();
    const signals = [];
    const fields = recordContext?.fields || {};

    Object.entries(fields).forEach(([fieldApiName, fieldData]) => {
        addFieldSignals(signals, fieldApiName, fieldData, normalizedToday, recordContext);
    });

    addFinancialCaveatSignal(signals, fields, recordContext);
    addSelectedRelationshipSignals(signals, recordContext, selectionSummary);

    const cappedSignals = capSignals(signals, MAX_SIGNALS);
    return {
        signalCount: cappedSignals.length,
        generatedAt: toDateString(normalizedToday),
        signals: cappedSignals,
        relationshipCoverage: buildRelationshipCoverage(recordContext, selectionSummary)
    };
}

export function buildComparisonSignals({ comparisonContext, selectionSummary = {}, today = new Date() } = {}) {
    const normalizedToday = normalizeDate(today) || new Date();
    const records = Array.isArray(comparisonContext?.records) ? comparisonContext.records : [];
    const recordSignals = records.map(record => ({
        recordId: record.recordId,
        recordName: record.recordName || record.recordId || 'Compared record',
        signals: buildContextSignals({
            recordContext: {
                ...record,
                objectApiName: comparisonContext?.objectApiName,
                objectLabel: comparisonContext?.objectLabel
            },
            selectionSummary,
            today: normalizedToday
        }).signals.slice(0, MAX_COMPARE_RECORD_SIGNALS)
    }));

    const crossRecordSignals = [
        ...buildStatusDifferenceSignals(records),
        ...buildRelationshipDifferenceSignals(records),
        ...buildOutlierSignals(records)
    ];

    return {
        recordCount: records.length,
        signalCount: recordSignals.reduce((sum, record) => sum + record.signals.length, 0)
            + crossRecordSignals.length,
        generatedAt: toDateString(normalizedToday),
        recordSignals,
        signals: capSignals(crossRecordSignals, MAX_SIGNALS)
    };
}

function addFieldSignals(signals, fieldApiName, fieldData, today, recordContext) {
    const label = getFieldLabel(fieldApiName, fieldData);
    const normalizedName = normalizeText(`${fieldApiName} ${label}`);
    const value = getFieldValue(fieldData);
    const valueIsBlank = isBlank(value);

    if (valueIsBlank && containsAny(normalizedName, ACTION_WORDS)) {
        signals.push(buildSignal({
            type: 'blankActionField',
            severity: 'warning',
            label: `${label} is blank`,
            detail: 'An action, plan, or next-step field is selected but has no value.',
            fieldApiName,
            recordContext
        }));
        return;
    }

    if (valueIsBlank && containsAny(normalizedName, ['priority', 'status', 'stage', 'owner', 'health'])) {
        signals.push(buildSignal({
            type: 'blankImportantField',
            severity: 'info',
            label: `${label} is blank`,
            detail: 'A selected status, priority, owner, or health-like field has no value.',
            fieldApiName,
            recordContext
        }));
        return;
    }

    if (typeof value === 'boolean' && value === false && containsAny(normalizedName, CHECKPOINT_WORDS)) {
        signals.push(buildSignal({
            type: 'falseCheckpoint',
            severity: 'info',
            label: `${label} is false`,
            detail: 'A selected checkpoint or completion-like field is not marked complete.',
            fieldApiName,
            recordContext
        }));
    }

    if (!valueIsBlank && containsAny(normalizedName, STATUS_WORDS) && containsAny(normalizeText(value), NEGATIVE_WORDS)) {
        signals.push(buildSignal({
            type: 'negativeStatus',
            severity: 'warning',
            label: `${label}: ${summarizeValue(value)}`,
            detail: 'A selected status-like field contains negative or risk-related language.',
            fieldApiName,
            recordContext
        }));
    }

    const dateValue = normalizeDate(value);
    if (dateValue && containsAny(normalizedName, DEADLINE_WORDS) && isPastDate(dateValue, today)) {
        signals.push(buildSignal({
            type: 'overdueDate',
            severity: 'warning',
            label: `${label} is past`,
            detail: `${label} is ${daysBetween(dateValue, today)} days before the analysis date.`,
            fieldApiName,
            recordContext
        }));
    }

    if (dateValue && containsAny(normalizedName, ACTIVITY_WORDS) && daysBetween(dateValue, today) >= STALE_ACTIVITY_DAYS) {
        signals.push(buildSignal({
            type: 'staleActivityDate',
            severity: 'info',
            label: `${label} appears stale`,
            detail: `${label} is ${daysBetween(dateValue, today)} days before the analysis date.`,
            fieldApiName,
            recordContext
        }));
    }
}

function addFinancialCaveatSignal(signals, fields, recordContext) {
    const fieldEntries = Object.entries(fields || {});
    const hasCalculatedFinancial = fieldEntries.some(([fieldApiName, fieldData]) => {
        const name = normalizeText(`${fieldApiName} ${getFieldLabel(fieldApiName, fieldData)}`);
        return containsAny(name, FINANCIAL_WORDS) && containsAny(name, CALCULATED_FINANCIAL_WORDS);
    });
    const hasDiscountField = fieldEntries.some(([fieldApiName, fieldData]) => {
        const name = normalizeText(`${fieldApiName} ${getFieldLabel(fieldApiName, fieldData)}`);
        return containsAny(name, DISCOUNT_WORDS);
    });

    if (hasCalculatedFinancial && !hasDiscountField) {
        signals.push(buildSignal({
            type: 'calculatedFinancialCaveat',
            severity: 'info',
            label: 'Calculated financial field present',
            detail: 'Expected, weighted, forecast, or calculated financial values should not be interpreted as discounts unless a discount field is present.',
            recordContext
        }));
    }
}

function addSelectedRelationshipSignals(signals, recordContext, selectionSummary) {
    buildRelationshipCoverage(recordContext, selectionSummary).forEach(coverage => {
        if (coverage.selected && coverage.includedRecordCount === 0) {
            signals.push(buildSignal({
                type: 'selectedEmptyRelationship',
                severity: 'info',
                label: `${coverage.label} has no included records`,
                detail: 'This relationship was selected for context and returned zero records.',
                relationshipName: coverage.relationshipName,
                recordContext
            }));
        } else if (coverage.selected && coverage.includedRecordCount === 1) {
            signals.push(buildSignal({
                type: 'singleRelatedRecord',
                severity: 'info',
                label: `${coverage.label} has 1 included record`,
                detail: 'The selected relationship has a single included record, which may limit corroborating context.',
                relationshipName: coverage.relationshipName,
                recordContext
            }));
        }
    });
}

function buildRelationshipCoverage(recordContext, selectionSummary = {}) {
    const selectedRelationships = new Set([
        ...safeArray(selectionSummary.selectedRelationships),
        ...safeArray(recordContext?.selectedRelationships)
    ]);
    const sets = safeArray(recordContext?.relatedRecordSets);
    const byRelationship = new Map();

    sets.forEach(set => {
        if (!set?.relationshipName) return;
        byRelationship.set(set.relationshipName, {
            relationshipName: set.relationshipName,
            label: set.childObjectLabel || set.childObjectApiName || set.relationshipName,
            selected: true,
            includedRecordCount: safeArray(set.records).length,
            countStatus: set.countStatus || null
        });
    });

    selectedRelationships.forEach(relationshipName => {
        if (!relationshipName || byRelationship.has(relationshipName)) return;
        byRelationship.set(relationshipName, {
            relationshipName,
            label: relationshipName,
            selected: true,
            includedRecordCount: 0,
            countStatus: 'notLoaded'
        });
    });

    return Array.from(byRelationship.values());
}

function buildStatusDifferenceSignals(records) {
    const statusFields = new Map();
    records.forEach(record => {
        Object.entries(record.fields || {}).forEach(([fieldApiName, fieldData]) => {
            const name = normalizeText(`${fieldApiName} ${getFieldLabel(fieldApiName, fieldData)}`);
            if (!containsAny(name, STATUS_WORDS)) return;
            if (!statusFields.has(fieldApiName)) {
                statusFields.set(fieldApiName, []);
            }
            statusFields.get(fieldApiName).push({
                recordName: record.recordName || record.recordId,
                value: getFieldValue(fieldData),
                label: getFieldLabel(fieldApiName, fieldData)
            });
        });
    });

    const signals = [];
    statusFields.forEach(values => {
        const uniqueValues = new Set(values.map(item => String(item.value ?? '')));
        if (uniqueValues.size > 1) {
            signals.push({
                id: `statusDifference_${signals.length}`,
                type: 'statusDifference',
                severity: 'info',
                label: `${values[0].label} differs across records`,
                detail: values.map(item => `${item.recordName}: ${isBlank(item.value) ? 'blank' : summarizeValue(item.value)}`).join('; ')
            });
        }
    });
    return signals;
}

function buildRelationshipDifferenceSignals(records) {
    const relationshipCounts = new Map();
    records.forEach(record => {
        safeArray(record.relatedRecordSets).forEach(set => {
            const key = set.relationshipName;
            if (!key) return;
            if (!relationshipCounts.has(key)) {
                relationshipCounts.set(key, {
                    label: set.childObjectLabel || set.childObjectApiName || key,
                    values: []
                });
            }
            relationshipCounts.get(key).values.push({
                recordName: record.recordName || record.recordId,
                count: safeArray(set.records).length
            });
        });
    });

    const signals = [];
    relationshipCounts.forEach(({ label, values }, relationshipName) => {
        const uniqueCounts = new Set(values.map(item => item.count));
        if (uniqueCounts.size > 1) {
            signals.push({
                id: `relationshipDifference_${relationshipName}`,
                type: 'relationshipCountDifference',
                severity: 'info',
                label: `${label} coverage differs`,
                detail: values.map(item => `${item.recordName}: ${item.count}`).join('; '),
                relationshipName
            });
        }
    });
    return signals;
}

function buildOutlierSignals(records) {
    const numericFields = new Map();
    records.forEach(record => {
        Object.entries(record.fields || {}).forEach(([fieldApiName, fieldData]) => {
            const value = Number(getFieldValue(fieldData));
            if (!Number.isFinite(value)) return;
            const name = normalizeText(`${fieldApiName} ${getFieldLabel(fieldApiName, fieldData)}`);
            if (!containsAny(name, [...FINANCIAL_WORDS, 'score', 'count', 'quantity', 'days'])) return;
            if (!numericFields.has(fieldApiName)) {
                numericFields.set(fieldApiName, []);
            }
            numericFields.get(fieldApiName).push({
                recordName: record.recordName || record.recordId,
                label: getFieldLabel(fieldApiName, fieldData),
                value
            });
        });
    });

    const signals = [];
    numericFields.forEach(values => {
        if (values.length < 2) return;
        const sorted = [...values].sort((a, b) => a.value - b.value);
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        if (max.value !== min.value) {
            signals.push({
                id: `numericDifference_${signals.length}`,
                type: 'numericDifference',
                severity: 'info',
                label: `${values[0].label} differs across records`,
                detail: `${min.recordName}: ${min.value}; ${max.recordName}: ${max.value}`
            });
        }
    });
    return signals;
}

function buildSignal({ type, severity, label, detail, fieldApiName, relationshipName, recordContext }) {
    return {
        id: `${type}_${fieldApiName || relationshipName || 'record'}`,
        type,
        severity,
        label,
        detail,
        fieldApiName,
        relationshipName,
        recordId: recordContext?.recordId || null,
        recordName: recordContext?.recordName || null
    };
}

function capSignals(signals, maxCount) {
    const severityRank = { warning: 0, info: 1 };
    const seen = new Set();
    return signals
        .filter(signal => {
            const key = `${signal.type}|${signal.fieldApiName || ''}|${signal.relationshipName || ''}|${signal.label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))
        .slice(0, maxCount);
}

function getFieldValue(fieldData) {
    if (fieldData && typeof fieldData === 'object' && Object.prototype.hasOwnProperty.call(fieldData, 'value')) {
        return fieldData.value;
    }
    return fieldData;
}

function getFieldLabel(fieldApiName, fieldData) {
    return fieldData?.label || fieldApiName;
}

function containsAny(text, terms) {
    return terms.some(term => text.includes(normalizeText(term)));
}

function normalizeText(value) {
    return String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isPastDate(value, today) {
    return stripTime(value).getTime() < stripTime(today).getTime();
}

function daysBetween(earlier, later) {
    return Math.floor((stripTime(later).getTime() - stripTime(earlier).getTime()) / 86400000);
}

function stripTime(value) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function toDateString(value) {
    return value.toISOString().slice(0, 10);
}

function isBlank(value) {
    return value === null || value === undefined || String(value).trim() === '';
}

function summarizeValue(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}
