/**
 * Service for cross-record comparison in Agentforce Record Insights.
 * Accepts 2-5 records of the same object type and builds a structured
 * comparison payload for the AI to analyze.
 *
 * Security: with sharing, FLS enforcement, input validation.
 */
public with sharing class RecordCompareService {

    private static final Integer MIN_RECORDS = 2;
    private static final Integer MAX_RECORDS = 5;
    private static final String RECORD_ID_PATTERN = '^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$';

    // ── Wrapper Classes ──

    public class ComparisonContext {
        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String objectLabel { get; set; }
        @AuraEnabled public Integer recordCount { get; set; }
        @AuraEnabled public List<ComparisonRecord> records { get; set; }
        @AuraEnabled public List<String> commonFields { get; set; }
        @AuraEnabled public RecordContextService.ContextCompleteness completeness { get; set; }

        public ComparisonContext() {
            this.records = new List<ComparisonRecord>();
            this.commonFields = new List<String>();
            this.completeness = new RecordContextService.ContextCompleteness();
        }
    }

    public class ComparisonRecord {
        @AuraEnabled public String recordId { get; set; }
        @AuraEnabled public String recordName { get; set; }
        @AuraEnabled public Map<String, Object> fields { get; set; }
        @AuraEnabled public List<RecordContextService.RelatedRecordSet> relatedRecordSets { get; set; }
        @AuraEnabled public RecordContextService.ContextCompleteness completeness { get; set; }

        public ComparisonRecord() {
            this.fields = new Map<String, Object>();
            this.relatedRecordSets = new List<RecordContextService.RelatedRecordSet>();
            this.completeness = new RecordContextService.ContextCompleteness();
        }
    }

    public class ObjectOption {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label { get; set; }

        public ObjectOption(String apiName, String label) {
            this.apiName = apiName;
            this.label = label;
        }
    }

    // ── Public Methods ──

    /**
     * Fetches and normalizes data for 2-5 records of the same object type
     * for side-by-side comparison.
     */
    @AuraEnabled
    public static ComparisonContext getComparisonContext(
        List<String> recordIds,
        Integer depth,
        List<String> includedCategories,
        List<String> includedRelationships
    ) {
        if (recordIds == null || recordIds.size() < MIN_RECORDS) {
            throw new AuraHandledException('At least ' + MIN_RECORDS + ' records are required for comparison.');
        }
        if (recordIds.size() > MAX_RECORDS) {
            throw new AuraHandledException('Maximum ' + MAX_RECORDS + ' records can be compared at once.');
        }

        // Validate all IDs and ensure same object type
        Set<String> objectTypes = new Set<String>();
        List<Id> validIds = new List<Id>();
        Set<Id> seenIds = new Set<Id>();

        for (String rid : recordIds) {
            if (String.isBlank(rid) || !Pattern.matches(RECORD_ID_PATTERN, rid)) {
                throw new AuraHandledException('Invalid record ID: ' + rid);
            }
            Id sfId = Id.valueOf(rid);
            if (seenIds.contains(sfId)) {
                continue;
            }
            seenIds.add(sfId);
            objectTypes.add(sfId.getSObjectType().getDescribe().getName());
            validIds.add(sfId);
        }

        if (validIds.size() < MIN_RECORDS) {
            throw new AuraHandledException('At least ' + MIN_RECORDS + ' unique records are required for comparison.');
        }

        if (objectTypes.size() > 1) {
            throw new AuraHandledException('All records must be of the same object type. Found: ' + String.join(new List<String>(objectTypes), ', '));
        }

        String objectApiName = new List<String>(objectTypes)[0];
        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();

        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        ComparisonContext ctx = new ComparisonContext();
        ctx.objectApiName = objectApiName;
        ctx.objectLabel = objDescribe.getLabel();
        ctx.recordCount = validIds.size();

        Set<String> commonFieldSet = new Set<String>();

        for (Id validId : validIds) {
            RecordContextService.RecordContext recordCtx = RecordContextService.getRecordContext(
                String.valueOf(validId),
                depth,
                includedCategories,
                includedRelationships
            );

            ComparisonRecord cr = new ComparisonRecord();
            cr.recordId = recordCtx.recordId;
            cr.recordName = recordCtx.recordName;
            cr.fields = recordCtx.fields == null ? new Map<String, Object>() : recordCtx.fields;
            cr.relatedRecordSets = recordCtx.relatedRecordSets == null
                ? new List<RecordContextService.RelatedRecordSet>()
                : recordCtx.relatedRecordSets;
            cr.completeness = recordCtx.completeness == null
                ? new RecordContextService.ContextCompleteness()
                : recordCtx.completeness;

            commonFieldSet.addAll(cr.fields.keySet());
            mergeCompleteness(ctx.completeness, cr.completeness, cr.recordName);
            ctx.records.add(cr);
        }

        ctx.commonFields = new List<String>(commonFieldSet);
        ctx.commonFields.sort();

        return ctx;
    }

    @AuraEnabled(cacheable=true)
    public static List<ObjectOption> getAvailableCompareObjects() {
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
        Map<String, ObjectOption> optionsByKey = new Map<String, ObjectOption>();
        List<String> sortKeys = new List<String>();

        for (String objectApiName : globalDescribe.keySet()) {
            Schema.DescribeSObjectResult objDescribe = globalDescribe.get(objectApiName).getDescribe();
            if (!objDescribe.isAccessible() || !objDescribe.isQueryable() || objDescribe.isDeprecatedAndHidden()) {
                continue;
            }

            String nameField = RecordSchemaUtils.getNameField(objDescribe);
            if (nameField == 'Id') {
                continue;
            }

            String sortKey = objDescribe.getLabel().toLowerCase() + '|' + objectApiName;
            sortKeys.add(sortKey);
            optionsByKey.put(sortKey, new ObjectOption(objectApiName, objDescribe.getLabel()));
        }

        sortKeys.sort();

        List<ObjectOption> options = new List<ObjectOption>();
        for (String sortKey : sortKeys) {
            options.add(optionsByKey.get(sortKey));
        }
        return options;
    }

    /**
     * Returns records similar to the given record for comparison suggestions.
     * Uses shared parent relationships (e.g. same Account for Opportunities)
     * and recently modified records of the same type as a generic fallback.
     */
    @AuraEnabled
    public static List<Map<String, String>> getSuggestedRecords(String recordId, Integer maxResults) {
        if (String.isBlank(recordId)) {
            throw new AuraHandledException('Record ID is required.');
        }
        if (!Pattern.matches(RECORD_ID_PATTERN, recordId)) {
            throw new AuraHandledException('Invalid record ID format.');
        }

        Id sfId = Id.valueOf(recordId);
        Schema.SObjectType objType = sfId.getSObjectType();
        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        String objectApiName = objDescribe.getName();

        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        if (maxResults == null || maxResults <= 0) maxResults = 8;
        if (maxResults > 20) maxResults = 20;

        String nameField = RecordSchemaUtils.getNameField(objDescribe);
        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();
        List<Map<String, String>> results = new List<Map<String, String>>();
        Set<String> usedIds = new Set<String>{ recordId };

        // Strategy 1: find siblings via lookup/master-detail fields pointing to same parent
        List<String> parentLookups = new List<String>();
        for (String fn : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fn).getDescribe();
            if (!dfr.isAccessible()) continue;
            if (dfr.getType() == Schema.DisplayType.REFERENCE && fn != 'id') {
                parentLookups.add(fn);
            }
        }

        if (!parentLookups.isEmpty()) {
            // Object/field names sourced from Schema Describe, not user input -- safe for dynamic SOQL
            String parentQuery = 'SELECT ' + String.join(parentLookups, ', ') + ' FROM ' + objectApiName + ' WHERE Id = :sfId';
            List<SObject> parentResult = Database.query(parentQuery);

            if (!parentResult.isEmpty()) {
                SObject currentRec = parentResult[0];
                for (String lookupField : parentLookups) {
                    if (results.size() >= maxResults) break;
                    Object parentVal = currentRec.get(lookupField);
                    if (parentVal == null) continue;

                    String parentId = String.valueOf(parentVal);
                    Integer remaining = maxResults - results.size();

                    String siblingQuery = 'SELECT Id, ' + nameField
                        + ' FROM ' + objectApiName
                        + ' WHERE ' + lookupField + ' = :parentId'
                        + ' AND Id != :sfId'
                        + ' ORDER BY LastModifiedDate DESC'
                        + ' LIMIT ' + remaining;

                    for (SObject sib : Database.query(siblingQuery)) {
                        String sibId = sib.Id;
                        if (usedIds.contains(sibId)) continue;
                        usedIds.add(sibId);
                        results.add(new Map<String, String>{
                            'id' => sibId,
                            'name' => String.valueOf(sib.get(nameField))
                        });
                    }
                }
            }
        }

        // Strategy 2: fall back to recently modified records of the same type
        if (results.size() < maxResults) {
            Integer remaining = maxResults - results.size();
            String recentQuery = 'SELECT Id, ' + nameField
                + ' FROM ' + objectApiName
                + ' WHERE Id != :sfId'
                + ' ORDER BY LastModifiedDate DESC'
                + ' LIMIT ' + remaining;

            for (SObject rec : Database.query(recentQuery)) {
                String recId = rec.Id;
                if (usedIds.contains(recId)) continue;
                usedIds.add(recId);
                results.add(new Map<String, String>{
                    'id' => recId,
                    'name' => String.valueOf(rec.get(nameField))
                });
            }
        }

        return results;
    }

    /**
     * Searches for records of a given object type by name, for the compare record picker.
     */
    @AuraEnabled
    public static List<Map<String, String>> searchRecords(String objectApiName, String searchTerm, Integer maxResults) {
        if (String.isBlank(objectApiName)) {
            throw new AuraHandledException('Object type is required.');
        }

        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
        if (objType == null) {
            throw new AuraHandledException('Invalid or inaccessible object type.');
        }

        if (maxResults == null || maxResults <= 0) maxResults = 10;
        if (maxResults > 50) maxResults = 50;

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        if (!objDescribe.isAccessible() || !objDescribe.isQueryable()) {
            throw new AuraHandledException('Invalid or inaccessible object type.');
        }

        String nameField = RecordSchemaUtils.getNameField(objDescribe);
        if (nameField == 'Id') {
            throw new AuraHandledException('This object type does not support record-name search.');
        }

        List<Map<String, String>> results = new List<Map<String, String>>();

        if (String.isBlank(searchTerm) || searchTerm.length() < 2) {
            // Return recent records
            String soql = 'SELECT Id, ' + nameField
                + ' FROM ' + objectApiName
                + ' ORDER BY LastModifiedDate DESC LIMIT ' + maxResults;
            for (SObject rec : Database.query(soql)) {
                results.add(new Map<String, String>{
                    'id' => rec.Id,
                    'name' => String.valueOf(rec.get(nameField))
                });
            }
        } else {
            String searchPattern = '%' + searchTerm.trim() + '%';
            String soql = 'SELECT Id, ' + nameField
                + ' FROM ' + objectApiName
                + ' WHERE ' + nameField + ' LIKE :searchPattern'
                + ' ORDER BY LastModifiedDate DESC'
                + ' LIMIT ' + maxResults;
            for (SObject rec : Database.query(soql)) {
                results.add(new Map<String, String>{
                    'id' => rec.Id,
                    'name' => String.valueOf(rec.get(nameField))
                });
            }
        }

        return results;
    }

    private static void mergeCompleteness(
        RecordContextService.ContextCompleteness target,
        RecordContextService.ContextCompleteness source,
        String recordName
    ) {
        if (target == null || source == null || !source.hasWarnings) {
            return;
        }

        target.isComplete = false;
        target.hasWarnings = true;
        target.skippedFieldCount += source.skippedFieldCount;
        target.skippedRelationshipCount += source.skippedRelationshipCount;
        target.skippedDescendantCount += source.skippedDescendantCount;
        target.truncatedRelationshipCount += source.truncatedRelationshipCount;

        addWarning(target, 'One or more compared records have incomplete or truncated context.');

        for (String warningMessage : source.warningMessages) {
            if (String.isBlank(warningMessage)) {
                continue;
            }

            addWarning(
                target,
                String.isNotBlank(recordName)
                    ? 'For ' + recordName + ': ' + warningMessage
                    : warningMessage
            );
        }
    }

    private static void addWarning(RecordContextService.ContextCompleteness completeness, String warningMessage) {
        if (completeness == null || String.isBlank(warningMessage)) {
            return;
        }
        if (!completeness.warningMessages.contains(warningMessage)) {
            completeness.warningMessages.add(warningMessage);
        }
    }

}
