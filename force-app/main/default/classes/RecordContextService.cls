/**
 * Generic, object-agnostic record context builder for Agentforce Record Insights.
 * Uses Schema Describe APIs to dynamically discover fields, relationships, and metadata
 * for ANY standard or custom object -- zero configuration required.
 *
 * Security: Enforces FLS, CRUD, and sharing rules at every layer.
 */
public with sharing class RecordContextService {

    private static final Integer DEFAULT_RELATED_RECORD_LIMIT = 10;
    private static final Integer MAX_CONFIGURABLE_RELATED_RECORD_LIMIT = 20;
    private static final Integer MAX_RELATIONSHIP_QUERIES = 20;
    private static final Integer QUERY_SAFETY_BUFFER = 10;
    private static final String COUNT_STATUS_KNOWN = 'known';
    private static final String COUNT_STATUS_UNKNOWN = 'unknown';
    private static final Set<String> UNSUPPORTED_RELATIONSHIP_NAMES = new Set<String>{
        'RelatedClients', 'AttachedContentNotes', 'FieldChangeSnapshots',
        'NotesAndAttachments', 'OpenActivities', 'RecentFieldChanges'
    };
    private static final Set<String> UNSUPPORTED_CHILD_OBJECTS = new Set<String>{
        'ActionableListMember', 'AttachedContentNote', 'FieldChangeSnapshot',
        'NoteAndAttachment', 'OpenActivity', 'RecentFieldChange'
    };
    @TestVisible private static Boolean forceFieldSerializationFailure = false;
    @TestVisible private static Boolean forceRelationshipFetchFailure = false;
    @TestVisible private static Boolean forceDescendantFetchFailure = false;
    @TestVisible private static Boolean forceRelationshipDiscoveryTruncation = false;

    private static final Set<String> SYSTEM_RELATIONSHIP_SUFFIXES = new Set<String>{
        'Shares', 'Histories', 'Feeds', 'ChangeEvents', 'Tags',
        'ProcessInstances', 'ProcessSteps', 'TopicAssignments',
        'EntitySubscriptions', 'AttachedContentDocuments',
        'CombinedAttachments', 'ContentDocumentLinks',
        'DuplicateRecordItems', 'RecordActions', 'RecordActionHistories',
        'FlowOrchestrationWorkItems', 'NetworkActivityAudits'
    };

    // ── Wrapper Classes ──

    public class AvailableContext {
        @AuraEnabled public String recordId { get; set; }
        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String objectLabel { get; set; }
        @AuraEnabled public String recordName { get; set; }
        @AuraEnabled public List<FieldCategory> fieldCategories { get; set; }
        @AuraEnabled public List<RelationshipInfo> relationships { get; set; }
        @AuraEnabled public ContextCompleteness completeness { get; set; }

        public AvailableContext() {
            this.fieldCategories = new List<FieldCategory>();
            this.relationships = new List<RelationshipInfo>();
            this.completeness = new ContextCompleteness();
        }
    }

    public class ContextCompleteness {
        @AuraEnabled public Boolean isComplete { get; set; }
        @AuraEnabled public Boolean hasWarnings { get; set; }
        @AuraEnabled public List<String> warningMessages { get; set; }
        @AuraEnabled public Integer skippedFieldCount { get; set; }
        @AuraEnabled public Integer skippedRelationshipCount { get; set; }
        @AuraEnabled public Integer skippedDescendantCount { get; set; }
        @AuraEnabled public Integer truncatedRelationshipCount { get; set; }

        public ContextCompleteness() {
            this.isComplete = true;
            this.hasWarnings = false;
            this.warningMessages = new List<String>();
            this.skippedFieldCount = 0;
            this.skippedRelationshipCount = 0;
            this.skippedDescendantCount = 0;
            this.truncatedRelationshipCount = 0;
        }
    }

    public class FieldCategory {
        @AuraEnabled public String name { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public Integer fieldCount { get; set; }
        @AuraEnabled public List<FieldInfo> fields { get; set; }
        @AuraEnabled public Boolean includedByDefault { get; set; }

        public FieldCategory(String name, String label, Boolean includedByDefault) {
            this.name = name;
            this.label = label;
            this.includedByDefault = includedByDefault;
            this.fields = new List<FieldInfo>();
            this.fieldCount = 0;
        }
    }

    public class FieldInfo {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String fieldType { get; set; }
        @AuraEnabled public String helpText { get; set; }

        public FieldInfo(Schema.DescribeFieldResult dfr) {
            this.apiName = dfr.getName();
            this.label = dfr.getLabel();
            this.fieldType = dfr.getType().name();
            this.helpText = dfr.getInlineHelpText();
        }
    }

    public class RelationshipInfo {
        @AuraEnabled public String relationshipName { get; set; }
        @AuraEnabled public String childObjectApiName { get; set; }
        @AuraEnabled public String childObjectLabel { get; set; }
        @AuraEnabled public String fieldName { get; set; }
        @AuraEnabled public Integer recordCount { get; set; }
        @AuraEnabled public String countStatus { get; set; }
        @AuraEnabled public Boolean includedByDefault { get; set; }
    }

    private class RelationshipCandidate {
        public Schema.ChildRelationship childRelationship { get; private set; }
        public Schema.DescribeSObjectResult childDescribe { get; private set; }
        public RelationshipInfo info { get; private set; }

        public RelationshipCandidate(
            Schema.ChildRelationship childRelationship,
            Schema.DescribeSObjectResult childDescribe,
            RelationshipInfo info
        ) {
            this.childRelationship = childRelationship;
            this.childDescribe = childDescribe;
            this.info = info;
        }
    }

    public class RecordContext {
        @AuraEnabled public String recordId { get; set; }
        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String objectLabel { get; set; }
        @AuraEnabled public String recordName { get; set; }
        @AuraEnabled public Map<String, Object> fields { get; set; }
        @AuraEnabled public List<RelatedRecordSet> relatedRecordSets { get; set; }
        @AuraEnabled public ContextCompleteness completeness { get; set; }

        public RecordContext() {
            this.fields = new Map<String, Object>();
            this.relatedRecordSets = new List<RelatedRecordSet>();
            this.completeness = new ContextCompleteness();
        }
    }

    public class RelatedRecordSet {
        @AuraEnabled public String relationshipName { get; set; }
        @AuraEnabled public String childObjectApiName { get; set; }
        @AuraEnabled public String childObjectLabel { get; set; }
        @AuraEnabled public List<Map<String, Object>> records { get; set; }

        public RelatedRecordSet(String relationshipName, String childObjectApiName, String childObjectLabel) {
            this.relationshipName = relationshipName;
            this.childObjectApiName = childObjectApiName;
            this.childObjectLabel = childObjectLabel;
            this.records = new List<Map<String, Object>>();
        }
    }

    // ── Public Methods ──

    /**
     * Returns metadata about what context is available for a record:
     * all accessible field categories and all discoverable relationships with record counts.
     * This is called first so the UI can render the context panel before fetching data.
     */
    @AuraEnabled(cacheable=true)
    public static AvailableContext getAvailableContext(String recordId) {
        validateRecordId(recordId);

        Id sfId = Id.valueOf(recordId);
        String objectApiName = sfId.getSObjectType().getDescribe().getName();
        Schema.DescribeSObjectResult objDescribe = sfId.getSObjectType().getDescribe();

        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        AvailableContext ctx = new AvailableContext();
        ctx.recordId = recordId;
        ctx.objectApiName = objectApiName;
        ctx.objectLabel = objDescribe.getLabel();
        ctx.fieldCategories = categorizeFields(objDescribe);
        ctx.relationships = discoverRelationships(objDescribe, recordId, ctx.completeness);
        ctx.recordName = fetchRecordName(objDescribe, objectApiName, recordId);

        return ctx;
    }

    /**
     * Returns object-level context metadata without requiring a specific record.
     * When a reference record is provided, relationship counts are calculated from
     * that record so compare mode can mirror the insights settings experience.
     */
    @AuraEnabled(cacheable=true)
    public static AvailableContext getAvailableContextForObject(String objectApiName, String referenceRecordId) {
        if (String.isBlank(objectApiName)) {
            throw new AuraHandledException('Object type is required.');
        }

        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
        if (objType == null) {
            throw new AuraHandledException('Invalid or inaccessible object type.');
        }

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        AvailableContext ctx = new AvailableContext();
        ctx.objectApiName = objDescribe.getName();
        ctx.objectLabel = objDescribe.getLabel();
        ctx.fieldCategories = categorizeFields(objDescribe);

        if (String.isNotBlank(referenceRecordId)) {
            validateRecordId(referenceRecordId);

            Id referenceId = Id.valueOf(referenceRecordId);
            String referenceObjectApiName = referenceId.getSObjectType().getDescribe().getName();
            if (referenceObjectApiName != objDescribe.getName()) {
                throw new AuraHandledException('Reference record must match the selected object type.');
            }

            ctx.recordId = referenceRecordId;
            ctx.recordName = fetchRecordName(objDescribe, objDescribe.getName(), referenceRecordId);
            ctx.relationships = discoverRelationships(objDescribe, referenceRecordId, ctx.completeness);
        } else {
            ctx.recordName = objDescribe.getLabel() + ' comparison settings';
            ctx.relationships = describeRelationships(objDescribe);
        }

        return ctx;
    }

    /**
     * Fetches the full record context: field values and related records.
     * Parameters control which fields and relationships to include.
     */
    @AuraEnabled
    public static RecordContext getRecordContext(
        String recordId,
        Integer depth,
        List<String> includedCategories,
        List<String> includedRelationships,
        Integer maxRelatedRecords
    ) {
        validateRecordId(recordId);

        Id sfId = Id.valueOf(recordId);
        Schema.DescribeSObjectResult objDescribe = sfId.getSObjectType().getDescribe();
        String objectApiName = objDescribe.getName();

        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        if (depth == null || depth < 1) { depth = 1; }
        if (depth > 3) { depth = 3; }
        maxRelatedRecords = normalizeRelatedRecordLimit(maxRelatedRecords);

        RecordContext ctx = new RecordContext();
        ctx.recordId = recordId;
        ctx.objectApiName = objectApiName;
        ctx.objectLabel = objDescribe.getLabel();

        // Build field list from included categories
        Set<String> categorySet = new Set<String>();
        if (includedCategories != null) {
            categorySet.addAll(includedCategories);
        }

        List<FieldCategory> allCategories = categorizeFields(objDescribe);
        List<String> fieldsToQuery = new List<String>();
        Set<String> fieldSet = new Set<String>();
        fieldSet.add('Id');
        fieldsToQuery.add('Id');

        String nameField = RecordSchemaUtils.getNameField(objDescribe);
        if (!fieldSet.contains(nameField)) {
            fieldSet.add(nameField);
            fieldsToQuery.add(nameField);
        }

        for (FieldCategory cat : allCategories) {
            Boolean included = categorySet.isEmpty() ? cat.includedByDefault : categorySet.contains(cat.name);
            if (!included) continue;
            for (FieldInfo fi : cat.fields) {
                if (!fieldSet.contains(fi.apiName) && fieldsToQuery.size() < RecordSchemaUtils.MAX_FIELDS_PER_QUERY) {
                    fieldSet.add(fi.apiName);
                    fieldsToQuery.add(fi.apiName);
                }
            }
        }

        // Query the record
        String soql = 'SELECT ' + String.join(fieldsToQuery, ', ')
                     + ' FROM ' + objectApiName
                     + ' WHERE Id = :recordId LIMIT 1';

        List<SObject> records;
        try {
            records = Database.query(soql);
        } catch (QueryException qe) {
            // Fallback to just Id + Name
            String fallbackFields = RecordSchemaUtils.buildIdentityFieldClause(objDescribe);
            records = Database.query(
                'SELECT ' + fallbackFields + ' FROM ' + objectApiName + ' WHERE Id = :recordId LIMIT 1'
            );
        }
        records = stripReadableRecords(records);

        if (records.isEmpty()) {
            throw new AuraHandledException('Record not found or you do not have access.');
        }

        SObject record = records[0];
        ctx.recordName = String.valueOf(record.get(nameField));

        // Build field map with metadata -- iterate over ALL queried fields (including nulls)
        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();

        for (String fn : fieldsToQuery) {
            if (fn == 'Id') continue;
            try {
                triggerFieldSerializationFailureIfRequested();
                Object val = record.get(fn);
                Map<String, Object> fieldData = new Map<String, Object>();
                fieldData.put('value', RecordSchemaUtils.normalizeValue(val));

                if (fieldMap.containsKey(fn)) {
                    Schema.DescribeFieldResult dfr = fieldMap.get(fn).getDescribe();
                    fieldData.put('label', dfr.getLabel());
                    if (String.isNotBlank(dfr.getInlineHelpText())) {
                        fieldData.put('helpText', dfr.getInlineHelpText());
                    }
                }
                ctx.fields.put(fn, fieldData);
            } catch (Exception e) {
                noteSkippedField(ctx.completeness);
            }
        }

        // Fetch related records (depth 1+)
        if (includedRelationships != null && !includedRelationships.isEmpty()) {
            Set<String> relSet = new Set<String>(includedRelationships);
            List<Schema.ChildRelationship> childRels = objDescribe.getChildRelationships();

            for (Schema.ChildRelationship cr : childRels) {
                if (Limits.getQueries() >= Limits.getLimitQueries() - QUERY_SAFETY_BUFFER) break;

                String relName = cr.getRelationshipName();
                if (relName == null || !relSet.contains(relName)) continue;

                Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
                if (!isSupportedRelationship(cr, relName, childDescribe)) continue;

                try {
                    triggerRelationshipFetchFailureIfRequested();
                    RelatedRecordSet rrs = fetchRelatedRecords(
                        cr, recordId, childDescribe, maxRelatedRecords
                    );
                    if (rrs != null && !rrs.records.isEmpty()) {
                        ctx.relatedRecordSets.add(rrs);

                        if (depth >= 2) {
                            fetchDescendants(rrs, ctx, childDescribe, 2, depth, ctx.completeness);
                        }
                    }
                } catch (Exception e) {
                    noteSkippedRelationship(ctx.completeness, relName);
                }
            }
        }

        return ctx;
    }

    /**
     * Lazy-loads records for a single relationship. Used when the user toggles
     * a relationship on in the context panel.
     */
    @AuraEnabled
    public static RelatedRecordSet getRelationshipData(
        String recordId, String objectApiName, String relationshipName, Integer maxRecords
    ) {
        validateRecordId(recordId);

        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
        if (objType == null) {
            throw new AuraHandledException('Invalid object type.');
        }

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        maxRecords = normalizeRelatedRecordLimit(maxRecords);

        for (Schema.ChildRelationship cr : objDescribe.getChildRelationships()) {
            if (cr.getRelationshipName() == relationshipName) {
                Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
                if (!isSupportedRelationship(cr, relationshipName, childDescribe)) {
                    throw new AuraHandledException('This relationship is not supported for context loading.');
                }
                return fetchRelatedRecords(cr, recordId, childDescribe, maxRecords);
            }
        }

        throw new AuraHandledException('Relationship not found: ' + relationshipName);
    }

    @TestVisible
    static void resetTestHooks() {
        forceFieldSerializationFailure = false;
        forceRelationshipFetchFailure = false;
        forceDescendantFetchFailure = false;
        forceRelationshipDiscoveryTruncation = false;
    }

    // ── Private Methods ──

    private static void validateRecordId(String recordId) {
        if (String.isBlank(recordId)) {
            throw new AuraHandledException('Record ID is required.');
        }
        if (!Pattern.matches('^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$', recordId)) {
            throw new AuraHandledException('Invalid record ID format.');
        }
    }

    private static Integer normalizeRelatedRecordLimit(Integer maxRelatedRecords) {
        if (maxRelatedRecords == null || maxRelatedRecords <= 0) {
            return DEFAULT_RELATED_RECORD_LIMIT;
        }
        return Math.min(Math.max(maxRelatedRecords, 1), MAX_CONFIGURABLE_RELATED_RECORD_LIMIT);
    }

    /**
     * Auto-categorizes all accessible fields on the object into logical groups.
     */
    private static List<FieldCategory> categorizeFields(Schema.DescribeSObjectResult objDescribe) {
        Map<String, FieldCategory> categoryMap = new Map<String, FieldCategory>();
        categoryMap.put('core', new FieldCategory('core', 'Core Fields', true));
        categoryMap.put('financial', new FieldCategory('financial', 'Financial', true));
        categoryMap.put('dates', new FieldCategory('dates', 'Dates & Activity', true));
        categoryMap.put('status', new FieldCategory('status', 'Status & Stage', true));
        categoryMap.put('relationships', new FieldCategory('relationships', 'Relationships', false));
        categoryMap.put('custom', new FieldCategory('custom', 'Custom Fields', true));
        categoryMap.put('other', new FieldCategory('other', 'Other', false));

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();

        Set<String> coreFieldNames = new Set<String>{
            'Name', 'Subject', 'CaseNumber', 'Title', 'Description',
            'OwnerId', 'RecordTypeId', 'Phone', 'Email', 'Website',
            'Industry', 'Department', 'AccountId', 'ContactId', 'NextStep'
        };

        Set<String> statusFieldNames = new Set<String>{
            'Status', 'StageName', 'Priority', 'Type', 'Rating',
            'LeadSource', 'IsWon', 'IsClosed', 'Probability',
            'ForecastCategoryName', 'Origin'
        };

        Set<String> financialFieldNames = new Set<String>{
            'Amount', 'AnnualRevenue', 'ExpectedRevenue',
            'TotalOpportunityQuantity', 'Discount'
        };

        for (String fieldKey : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fieldKey).getDescribe();
            String fieldName = dfr.getName();

            if (!dfr.isAccessible()) continue;
            if (RecordSchemaUtils.EXCLUDED_FIELD_TYPES.contains(dfr.getType())) continue;
            if (fieldName.length() > RecordSchemaUtils.MAX_FIELD_NAME_LENGTH) continue;
            if (fieldName == 'Id') continue;

            FieldInfo fi = new FieldInfo(dfr);
            String category = classifyField(fieldName, dfr, coreFieldNames, statusFieldNames, financialFieldNames);

            if (categoryMap.containsKey(category)) {
                categoryMap.get(category).fields.add(fi);
            }
        }

        // Set counts and remove empty categories
        List<FieldCategory> result = new List<FieldCategory>();
        for (String key : new List<String>{'core', 'financial', 'status', 'dates', 'relationships', 'custom', 'other'}) {
            FieldCategory cat = categoryMap.get(key);
            cat.fieldCount = cat.fields.size();
            if (cat.fieldCount > 0) {
                result.add(cat);
            }
        }
        return result;
    }

    private static String classifyField(
        String fieldName,
        Schema.DescribeFieldResult dfr,
        Set<String> coreFieldNames,
        Set<String> statusFieldNames,
        Set<String> financialFieldNames
    ) {
        if (coreFieldNames.contains(fieldName)) return 'core';
        if (statusFieldNames.contains(fieldName)) return 'status';
        if (financialFieldNames.contains(fieldName)) return 'financial';

        Schema.DisplayType dt = dfr.getType();

        // Currency fields -> financial
        if (dt == Schema.DisplayType.CURRENCY) return 'financial';

        // Date/DateTime fields -> dates
        if (dt == Schema.DisplayType.DATE || dt == Schema.DisplayType.DATETIME) return 'dates';

        // Reference fields -> relationships
        if (dt == Schema.DisplayType.REFERENCE) return 'relationships';

        // Status-like picklists (heuristic)
        if (dt == Schema.DisplayType.PICKLIST) {
            String lower = fieldName.toLowerCase();
            if (lower.contains('status') || lower.contains('stage') || lower.contains('phase')
                || lower.contains('priority') || lower.contains('type') || lower.contains('rating')) {
                return 'status';
            }
        }

        // Custom fields
        if (dfr.isCustom()) return 'custom';

        // Activity-related standard fields
        String lower = fieldName.toLowerCase();
        if (lower.contains('activity') || lower.contains('days') || lower.contains('age')) {
            return 'dates';
        }

        return 'other';
    }

    /**
     * Dynamically discovers child relationships, filters out system noise,
     * and returns record counts for each.
     */
    private static List<RelationshipInfo> discoverRelationships(
        Schema.DescribeSObjectResult objDescribe,
        String recordId,
        ContextCompleteness completeness
    ) {
        List<RelationshipInfo> relationships = new List<RelationshipInfo>();
        List<RelationshipCandidate> defaultCandidates = new List<RelationshipCandidate>();
        List<RelationshipCandidate> optionalCandidates = new List<RelationshipCandidate>();
        Integer countQueriesUsed = 0;

        if (Test.isRunningTest() && forceRelationshipDiscoveryTruncation) {
            countQueriesUsed = MAX_RELATIONSHIP_QUERIES;
            forceRelationshipDiscoveryTruncation = false;
        }

        for (Schema.ChildRelationship cr : objDescribe.getChildRelationships()) {
            RelationshipCandidate candidate = buildRelationshipCandidate(cr);
            if (candidate == null) {
                continue;
            }

            if (candidate.info.includedByDefault) {
                defaultCandidates.add(candidate);
            } else {
                optionalCandidates.add(candidate);
            }
        }

        for (RelationshipCandidate candidate : defaultCandidates) {
            if (countQueriesUsed >= MAX_RELATIONSHIP_QUERIES) {
                markRelationshipCountUnknown(candidate.info);
                relationships.add(candidate.info);
                continue;
            }

            countQueriesUsed++;
            Integer recordCount = countRelationshipRecords(candidate, recordId);
            if (recordCount == null) {
                markRelationshipCountUnknown(candidate.info);
                relationships.add(candidate.info);
                continue;
            }

            markRelationshipCountKnown(candidate.info, recordCount);
            if (recordCount > 0) {
                relationships.add(candidate.info);
            }
        }

        for (RelationshipCandidate candidate : optionalCandidates) {
            if (countQueriesUsed >= MAX_RELATIONSHIP_QUERIES) {
                markRelationshipCountUnknown(candidate.info);
                relationships.add(candidate.info);
                continue;
            }

            countQueriesUsed++;
            Integer recordCount = countRelationshipRecords(candidate, recordId);
            if (recordCount == null) {
                markRelationshipCountUnknown(candidate.info);
                relationships.add(candidate.info);
                continue;
            }

            markRelationshipCountKnown(candidate.info, recordCount);
            if (recordCount > 0) {
                relationships.add(candidate.info);
            }
        }

        // Sort: default-included first, then by record count descending
        List<RelationshipInfo> defaultIncluded = new List<RelationshipInfo>();
        List<RelationshipInfo> notDefault = new List<RelationshipInfo>();
        for (RelationshipInfo ri : relationships) {
            if (ri.includedByDefault) {
                defaultIncluded.add(ri);
            } else {
                notDefault.add(ri);
            }
        }
        List<RelationshipInfo> sorted = new List<RelationshipInfo>();
        sorted.addAll(defaultIncluded);
        sorted.addAll(notDefault);
        return sorted;
    }

    private static List<RelationshipInfo> describeRelationships(Schema.DescribeSObjectResult objDescribe) {
        List<RelationshipInfo> defaultIncluded = new List<RelationshipInfo>();
        List<RelationshipInfo> optional = new List<RelationshipInfo>();

        for (Schema.ChildRelationship cr : objDescribe.getChildRelationships()) {
            RelationshipCandidate candidate = buildRelationshipCandidate(cr);
            if (candidate == null) {
                continue;
            }

            if (candidate.info.includedByDefault) {
                defaultIncluded.add(candidate.info);
            } else {
                optional.add(candidate.info);
            }
        }

        List<RelationshipInfo> describedRelationships = new List<RelationshipInfo>();
        describedRelationships.addAll(defaultIncluded);
        describedRelationships.addAll(optional);
        return describedRelationships;
    }

    private static RelationshipCandidate buildRelationshipCandidate(Schema.ChildRelationship cr) {
        String relName = cr.getRelationshipName();
        if (String.isBlank(relName) || cr.isDeprecatedAndHidden() || cr.getField() == null) {
            return null;
        }

        Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
        if (!isSupportedRelationship(cr, relName, childDescribe)) {
            return null;
        }

        RelationshipInfo info = new RelationshipInfo();
        info.relationshipName = relName;
        info.childObjectApiName = childDescribe.getName();
        info.childObjectLabel = childDescribe.getLabel();
        info.fieldName = cr.getField().getDescribe().getName();
        info.includedByDefault = isDefaultRelationship(childDescribe.getName());
        info.countStatus = null;

        return new RelationshipCandidate(cr, childDescribe, info);
    }

    private static Integer countRelationshipRecords(RelationshipCandidate candidate, String recordId) {
        try {
            String countSoql = 'SELECT COUNT() FROM ' + candidate.childDescribe.getName()
                + ' WHERE ' + candidate.info.fieldName + ' = :recordId';
            return Database.countQuery(countSoql);
        } catch (Exception e) {
            return null;
        }
    }

    private static Boolean isSystemRelationship(String relationshipName, String childObjectName) {
        for (String suffix : SYSTEM_RELATIONSHIP_SUFFIXES) {
            if (relationshipName.endsWith(suffix)) return true;
        }
        String lower = childObjectName.toLowerCase();
        if (lower.endsWith('share') || lower.endsWith('history') || lower.endsWith('feed')
            || lower.endsWith('changeevent') || lower.endsWith('tag')) {
            return true;
        }
        return false;
    }

    private static Boolean isSupportedRelationship(
        Schema.ChildRelationship cr,
        String relationshipName,
        Schema.DescribeSObjectResult childDescribe
    ) {
        if (childDescribe == null || cr == null) {
            return false;
        }
        if (!childDescribe.isAccessible() || !childDescribe.isQueryable()) {
            return false;
        }
        if (isSystemRelationship(relationshipName, childDescribe.getName())) {
            return false;
        }
        if (UNSUPPORTED_RELATIONSHIP_NAMES.contains(relationshipName)) {
            return false;
        }
        if (UNSUPPORTED_CHILD_OBJECTS.contains(childDescribe.getName())) {
            return false;
        }
        return true;
    }

    private static Boolean isDefaultRelationship(String childObjectName) {
        Set<String> defaults = new Set<String>{
            'Opportunity', 'Contact', 'Case', 'Task', 'Event',
            'OpportunityLineItem', 'OpportunityContactRole',
            'CampaignMember', 'Lead'
        };
        return defaults.contains(childObjectName);
    }

    private static RelatedRecordSet fetchRelatedRecords(
        Schema.ChildRelationship cr,
        String recordId,
        Schema.DescribeSObjectResult childDescribe,
        Integer maxRecords
    ) {
        String childObjectName = childDescribe.getName();
        String foreignKeyField = cr.getField().getDescribe().getName();
        String relName = cr.getRelationshipName();

        List<String> queryFields = RecordSchemaUtils.buildFieldList(childDescribe);

        // Object/field names sourced from Schema Describe, not user input -- safe for dynamic SOQL
        String soql = 'SELECT ' + String.join(queryFields, ', ')
                     + ' FROM ' + childObjectName
                     + ' WHERE ' + foreignKeyField + ' = :recordId'
                     + ' ORDER BY LastModifiedDate DESC NULLS LAST'
                     + ' LIMIT ' + maxRecords;

        List<SObject> records;
        try {
            records = Database.query(soql);
        } catch (QueryException qe) {
            String fallbackFields = RecordSchemaUtils.buildIdentityFieldClause(childDescribe);
            records = Database.query(
                'SELECT ' + fallbackFields + ' FROM ' + childObjectName
                + ' WHERE ' + foreignKeyField + ' = :recordId LIMIT ' + maxRecords
            );
        }
        records = stripReadableRecords(records);

        RelatedRecordSet rrs = new RelatedRecordSet(relName, childObjectName, childDescribe.getLabel());
        Map<String, Schema.SObjectField> childFieldMap = childDescribe.fields.getMap();

        for (SObject rec : records) {
            rrs.records.add(buildRecordMap(rec, childFieldMap, queryFields));
        }

        return rrs;
    }

    /**
     * Recursively fetches descendant records up to maxDepth.
     * currentDepth starts at 2 (grandchildren) and increments each level.
     * Reduces record limits at each level to stay within governor budgets.
     */
    private static void fetchDescendants(
        RelatedRecordSet parentRrs,
        RecordContext ctx,
        Schema.DescribeSObjectResult parentDescribe,
        Integer currentDepth,
        Integer maxDepth,
        ContextCompleteness completeness
    ) {
        if (currentDepth > maxDepth) return;
        if (Limits.getQueries() >= Limits.getLimitQueries() - QUERY_SAFETY_BUFFER) return;

        List<Schema.ChildRelationship> childRels = parentDescribe.getChildRelationships();
        Integer maxParents = (currentDepth <= 2) ? 3 : 2;
        Integer maxRecords = (currentDepth <= 2) ? 5 : 3;

        for (Schema.ChildRelationship cr : childRels) {
            if (Limits.getQueries() >= Limits.getLimitQueries() - QUERY_SAFETY_BUFFER) break;

            String relName = cr.getRelationshipName();
            if (relName == null) continue;

                Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
                if (!isSupportedRelationship(cr, relName, childDescribe)) continue;
                if (!isDefaultRelationship(childDescribe.getName())) continue;

            Integer parentCount = 0;
            for (Map<String, Object> parentRec : parentRrs.records) {
                if (parentCount >= maxParents) break;
                if (Limits.getQueries() >= Limits.getLimitQueries() - QUERY_SAFETY_BUFFER) break;

                String parentRecordId = extractIdValue(parentRec.get('Id'));
                if (parentRecordId == null) continue;

                try {
                    triggerDescendantFetchFailureIfRequested();
                    RelatedRecordSet childRrs = fetchRelatedRecords(
                        cr, parentRecordId, childDescribe, maxRecords
                    );
                    if (childRrs != null && !childRrs.records.isEmpty()) {
                        childRrs.relationshipName = parentRrs.childObjectApiName + '.' + relName;
                        ctx.relatedRecordSets.add(childRrs);

                        if (currentDepth < maxDepth) {
                            fetchDescendants(
                                childRrs,
                                ctx,
                                childDescribe,
                                currentDepth + 1,
                                maxDepth,
                                completeness
                            );
                        }
                    }
                } catch (Exception e) {
                    noteSkippedDescendant(completeness, parentRrs.childObjectApiName, relName);
                }
                parentCount++;
            }
        }
    }

    private static String extractIdValue(Object wrapped) {
        if (wrapped instanceof Map<String, Object>) {
            Object val = ((Map<String, Object>) wrapped).get('value');
            return val != null ? String.valueOf(val) : null;
        }
        return wrapped != null ? String.valueOf(wrapped) : null;
    }

    private static Map<String, Object> buildRecordMap(
        SObject record,
        Map<String, Schema.SObjectField> fieldMap,
        List<String> queriedFields
    ) {
        Map<String, Object> result = new Map<String, Object>();
        for (String fieldName : queriedFields) {
            try {
                Object val = record.get(fieldName);
                Map<String, Object> fieldData = new Map<String, Object>();
                fieldData.put('value', RecordSchemaUtils.normalizeValue(val));

                if (fieldMap.containsKey(fieldName)) {
                    Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
                    fieldData.put('label', dfr.getLabel());
                }

                result.put(fieldName, fieldData);
            } catch (Exception e) {
                // Skip non-serializable fields
            }
        }

        return result;
    }

    private static void noteSkippedField(ContextCompleteness completeness) {
        completeness.skippedFieldCount++;
        markIncomplete(
            completeness,
            'Some field values could not be included in the record context.'
        );
    }

    private static void noteSkippedRelationship(ContextCompleteness completeness, String relationshipName) {
        completeness.skippedRelationshipCount++;
        markIncomplete(
            completeness,
            'Some related records could not be loaded and were omitted from the context.'
        );
        if (String.isNotBlank(relationshipName)) {
            addWarning(
                completeness,
                'Related records skipped for relationship ' + relationshipName + '.'
            );
        }
    }

    private static void noteSkippedDescendant(
        ContextCompleteness completeness,
        String parentObjectApiName,
        String relationshipName
    ) {
        completeness.skippedDescendantCount++;
        markIncomplete(
            completeness,
            'Some descendant related records could not be loaded at deeper context levels.'
        );
        if (String.isNotBlank(parentObjectApiName) && String.isNotBlank(relationshipName)) {
            addWarning(
                completeness,
                'Descendant records skipped for ' + parentObjectApiName + '.' + relationshipName + '.'
            );
        }
    }

    private static void noteTruncatedRelationshipCount(ContextCompleteness completeness) {
        completeness.truncatedRelationshipCount++;
        markIncomplete(
            completeness,
            'Some related record counts could not be calculated and are shown without counts.'
        );
    }

    private static void markRelationshipCountKnown(RelationshipInfo info, Integer recordCount) {
        if (info == null) return;
        info.recordCount = recordCount;
        info.countStatus = COUNT_STATUS_KNOWN;
    }

    private static void markRelationshipCountUnknown(RelationshipInfo info) {
        if (info == null) return;
        info.recordCount = null;
        info.countStatus = COUNT_STATUS_UNKNOWN;
    }

    private static void markIncomplete(ContextCompleteness completeness, String warningMessage) {
        if (completeness == null) return;
        completeness.isComplete = false;
        completeness.hasWarnings = true;
        addWarning(completeness, warningMessage);
    }

    private static void addWarning(ContextCompleteness completeness, String warningMessage) {
        if (completeness == null || String.isBlank(warningMessage)) return;
        if (!completeness.warningMessages.contains(warningMessage)) {
            completeness.warningMessages.add(warningMessage);
        }
    }

    private static String fetchRecordName(
        Schema.DescribeSObjectResult objDescribe,
        String objectApiName,
        String recordId
    ) {
        try {
            String nameField = RecordSchemaUtils.getNameField(objDescribe);
            // Object/field names sourced from Schema Describe, not user input -- safe for dynamic SOQL
            String soql = 'SELECT ' + nameField + ' FROM ' + objectApiName + ' WHERE Id = :recordId LIMIT 1';
            List<SObject> records = stripReadableRecords(Database.query(soql));
            if (!records.isEmpty()) {
                return String.valueOf(records[0].get(nameField));
            }
        } catch (Exception e) {
            // Fall through to the safest available label.
        }

        return String.isNotBlank(recordId) ? recordId : objDescribe.getLabel();
    }

    private static void triggerFieldSerializationFailureIfRequested() {
        if (Test.isRunningTest() && forceFieldSerializationFailure) {
            forceFieldSerializationFailure = false;
            triggerTestFailure();
        }
    }

    private static void triggerRelationshipFetchFailureIfRequested() {
        if (Test.isRunningTest() && forceRelationshipFetchFailure) {
            forceRelationshipFetchFailure = false;
            triggerTestFailure();
        }
    }

    private static void triggerDescendantFetchFailureIfRequested() {
        if (Test.isRunningTest() && forceDescendantFetchFailure) {
            forceDescendantFetchFailure = false;
            triggerTestFailure();
        }
    }

    private static void triggerTestFailure() {
        Integer zero = 0;
        Integer failure = 1 / zero;
        failure++;
    }

    private static List<SObject> stripReadableRecords(List<SObject> records) {
        if (records == null || records.isEmpty()) {
            return records;
        }

        try {
            SObjectAccessDecision decision = Security.stripInaccessible(AccessType.READABLE, records);
            return decision == null ? records : decision.getRecords();
        } catch (Exception e) {
            return records;
        }
    }

}
