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
    private static final Integer MAX_PARENT_REFERENCES = 25;
    private static final Integer MAX_PARENT_SELECTIONS = 5;
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
    private static final Set<String> SYSTEM_REFERENCE_FIELDS = new Set<String>{
        'CreatedById', 'LastModifiedById', 'MasterRecordId'
    };
    private static final Set<String> DEFAULT_PARENT_REFERENCE_FIELDS = new Set<String>{
        'AccountId', 'ContactId', 'OwnerId'
    };
    @TestVisible private static Boolean forceFieldSerializationFailure = false;
    @TestVisible private static Boolean forceRelationshipFetchFailure = false;
    @TestVisible private static Boolean forceDescendantFetchFailure = false;
    @TestVisible private static Boolean forceRelationshipDiscoveryTruncation = false;
    @TestVisible private static Boolean forceParentFetchFailure = false;

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
        @AuraEnabled public List<ParentReferenceInfo> parentReferences { get; set; }
        @AuraEnabled public ContextCompleteness completeness { get; set; }

        public AvailableContext() {
            this.fieldCategories = new List<FieldCategory>();
            this.relationships = new List<RelationshipInfo>();
            this.parentReferences = new List<ParentReferenceInfo>();
            this.completeness = new ContextCompleteness();
        }
    }

    public class ParentReferenceInfo {
        @AuraEnabled public String referenceFieldApiName { get; set; }
        @AuraEnabled public String referenceFieldLabel { get; set; }
        @AuraEnabled public String parentObjectApiName { get; set; }
        @AuraEnabled public String parentObjectLabel { get; set; }
        @AuraEnabled public String parentRecordId { get; set; }
        @AuraEnabled public String parentRecordName { get; set; }
        @AuraEnabled public Boolean includedByDefault { get; set; }
    }

    public class ParentChildRelationshipInfo {
        @AuraEnabled public String relationshipName { get; set; }
        @AuraEnabled public String childObjectApiName { get; set; }
        @AuraEnabled public String childObjectLabel { get; set; }
        @AuraEnabled public String fieldName { get; set; }

        public ParentChildRelationshipInfo(String relationshipName, String childObjectApiName,
                                           String childObjectLabel, String fieldName) {
            this.relationshipName = relationshipName;
            this.childObjectApiName = childObjectApiName;
            this.childObjectLabel = childObjectLabel;
            this.fieldName = fieldName;
        }
    }

    public class ParentRecordContext {
        @AuraEnabled public String referenceFieldApiName { get; set; }
        @AuraEnabled public String parentObjectApiName { get; set; }
        @AuraEnabled public String parentObjectLabel { get; set; }
        @AuraEnabled public String parentRecordId { get; set; }
        @AuraEnabled public String parentRecordName { get; set; }
        @AuraEnabled public Map<String, Object> fields { get; set; }
        @AuraEnabled public List<Map<String, Object>> sameObjectSiblings { get; set; }
        @AuraEnabled public String sameObjectSiblingsObjectApiName { get; set; }
        @AuraEnabled public String sameObjectSiblingsRelationshipName { get; set; }
        @AuraEnabled public RelatedRecordSet selectedChildRelationship { get; set; }
        @AuraEnabled public ContextCompleteness completeness { get; set; }

        public ParentRecordContext() {
            this.fields = new Map<String, Object>();
            this.sameObjectSiblings = new List<Map<String, Object>>();
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
        @AuraEnabled public List<ParentRecordContext> parentRecordContexts { get; set; }
        @AuraEnabled public ContextCompleteness completeness { get; set; }

        public RecordContext() {
            this.fields = new Map<String, Object>();
            this.relatedRecordSets = new List<RelatedRecordSet>();
            this.parentRecordContexts = new List<ParentRecordContext>();
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

        SObject anchorRecord = requireReadableAnchorRecord(objDescribe, recordId);
        String nameField = RecordSchemaUtils.getNameField(objDescribe);

        AvailableContext ctx = new AvailableContext();
        ctx.recordId = recordId;
        ctx.objectApiName = objectApiName;
        ctx.objectLabel = objDescribe.getLabel();
        ctx.fieldCategories = categorizeFields(objDescribe);
        ctx.relationships = discoverRelationships(objDescribe, recordId, ctx.completeness);
        ctx.parentReferences = discoverParentReferences(objDescribe, recordId, ctx.completeness);
        ctx.recordName = resolveRecordDisplayName(anchorRecord, nameField, recordId);

        return ctx;
    }

    /**
     * Returns the accessible child relationships of a parent object so the user
     * can optionally include one parent-child relationship when expanding a
     * selected parent. Intentionally does not execute count queries to keep
     * this call cheap; counts come from the standard relationship fetch path.
     */
    @AuraEnabled(cacheable=true)
    public static List<ParentChildRelationshipInfo> getParentChildRelationships(String parentObjectApiName) {
        if (String.isBlank(parentObjectApiName)) {
            throw new AuraHandledException('Parent object type is required.');
        }

        Schema.SObjectType objType = Schema.getGlobalDescribe().get(parentObjectApiName);
        if (objType == null) {
            throw new AuraHandledException('Invalid or inaccessible object type.');
        }

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        List<ParentChildRelationshipInfo> result = new List<ParentChildRelationshipInfo>();
        for (Schema.ChildRelationship cr : objDescribe.getChildRelationships()) {
            String relName = cr.getRelationshipName();
            if (String.isBlank(relName) || cr.isDeprecatedAndHidden() || cr.getField() == null) {
                continue;
            }

            Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
            if (!isSupportedRelationship(cr, relName, childDescribe)) {
                continue;
            }

            result.add(new ParentChildRelationshipInfo(
                relName,
                childDescribe.getName(),
                childDescribe.getLabel(),
                cr.getField().getDescribe().getName()
            ));
        }

        result.sort(new ParentChildRelationshipComparator());
        return result;
    }

    private class ParentChildRelationshipComparator implements System.Comparator<ParentChildRelationshipInfo> {
        public Integer compare(ParentChildRelationshipInfo a, ParentChildRelationshipInfo b) {
            String aLabel = a == null || a.childObjectLabel == null ? '' : a.childObjectLabel.toLowerCase();
            String bLabel = b == null || b.childObjectLabel == null ? '' : b.childObjectLabel.toLowerCase();
            if (aLabel == bLabel) return 0;
            return aLabel < bLabel ? -1 : 1;
        }
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

            SObject anchorRecord = requireReadableAnchorRecord(objDescribe, referenceRecordId);
            String nameField = RecordSchemaUtils.getNameField(objDescribe);
            ctx.recordId = referenceRecordId;
            ctx.recordName = resolveRecordDisplayName(anchorRecord, nameField, referenceRecordId);
            ctx.relationships = discoverRelationships(objDescribe, referenceRecordId, ctx.completeness);
            ctx.parentReferences = discoverParentReferences(objDescribe, referenceRecordId, ctx.completeness);
        } else {
            ctx.recordName = objDescribe.getLabel() + ' comparison settings';
            ctx.relationships = describeRelationships(objDescribe);
            ctx.parentReferences = describeParentReferences(objDescribe);
        }

        return ctx;
    }

    /**
     * Returns the flat, describe-validated list of accessible FieldInfo entries for an
     * object, exactly as produced by categorizeFields() (which already enforces
     * isAccessible + EXCLUDED_FIELD_TYPES). This is the single hardened entry point
     * the UI uses to render the per-field override picker. The server never trusts
     * the UI field list; it intersects at query time again via buildQueryFieldList().
     */
    @AuraEnabled(cacheable=true)
    public static List<FieldInfo> getAccessibleFieldsForObject(String objectApiName) {
        if (String.isBlank(objectApiName)) {
            throw new AuraHandledException('Object API name is required.');
        }

        Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectApiName);
        if (objType == null) {
            throw new AuraHandledException('Invalid or inaccessible object type.');
        }

        Schema.DescribeSObjectResult objDescribe = objType.getDescribe();
        if (!objDescribe.isAccessible()) {
            throw new AuraHandledException('You do not have access to this object type.');
        }

        List<FieldInfo> result = new List<FieldInfo>();
        Set<String> seen = new Set<String>();
        for (FieldCategory cat : categorizeFields(objDescribe)) {
            for (FieldInfo fi : cat.fields) {
                if (fi == null || String.isBlank(fi.apiName)) continue;
                String key = fi.apiName.toLowerCase();
                if (seen.contains(key)) continue;
                seen.add(key);
                result.add(fi);
            }
        }
        return result;
    }

    /**
     * Fetches the full record context: field values and related records.
     * Parameters control which fields and relationships to include.
     *
     * New (v1.3) parameters support one-hop parent lookup expansion and bounded
     * sibling records through a selected parent:
     *   - includedParentReferenceFields: list of reference field API names on the
     *     active record whose parent records should be loaded.
     *   - includeSameObjectSiblingsThroughParents: when true, for each selected
     *     parent, load same-object siblings (records of the active record's
     *     object sharing the same parent) excluding the active record.
     *   - parentSiblingRelationshipByReferenceField: optional map from a
     *     reference field API name to a child-relationship name on the parent
     *     object to expand (one level only).
     */
    @AuraEnabled
    public static RecordContext getRecordContext(
        String recordId,
        Integer depth,
        List<String> includedCategories,
        List<String> includedRelationships,
        Integer maxRelatedRecords,
        List<String> includedParentReferenceFields,
        Boolean includeSameObjectSiblingsThroughParents,
        Map<String, String> parentSiblingRelationshipByReferenceField,
        List<String> includedFields
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
        List<String> fieldsToQuery = buildQueryFieldList(
            objDescribe,
            allCategories,
            categorySet,
            includedFields,
            ctx.completeness
        );
        String nameField = RecordSchemaUtils.getNameField(objDescribe);

        // Query the record
        List<SObject> records;
        try {
            records = RecordSchemaUtils.queryById(objDescribe, fieldsToQuery, recordId, 1);
        } catch (QueryException qe) {
            // Fallback to just Id + Name
            records = RecordSchemaUtils.queryById(
                objDescribe,
                new List<String>{ 'Id', nameField },
                recordId,
                1
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

        // Fetch parent records and sibling context (one-hop only).
        if (includedParentReferenceFields != null && !includedParentReferenceFields.isEmpty()) {
            ctx.parentRecordContexts = fetchParentContexts(
                objDescribe,
                recordId,
                ctx,
                includedParentReferenceFields,
                includeSameObjectSiblingsThroughParents == true,
                parentSiblingRelationshipByReferenceField,
                maxRelatedRecords
            );
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

        requireReadableAnchorRecord(objDescribe, recordId);
        maxRecords = normalizeRelatedRecordLimit(maxRecords);

        for (Schema.ChildRelationship cr : objDescribe.getChildRelationships()) {
            if (cr.getRelationshipName() == relationshipName) {
                Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
                if (!isSupportedRelationship(cr, relationshipName, childDescribe)) {
                    throw new AuraHandledException('This relationship is not supported for context loading.');
                }
                try {
                    triggerRelationshipFetchFailureIfRequested();
                    return fetchRelatedRecords(cr, recordId, childDescribe, maxRecords);
                } catch (Exception e) {
                    throw new AuraHandledException(
                        'Unable to load this relationship for the current user.'
                    );
                }
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
        forceParentFetchFailure = false;
    }

    // ── Private Methods ──

    private static SObject requireReadableAnchorRecord(
        Schema.DescribeSObjectResult objDescribe,
        String recordId
    ) {
        String nameField = RecordSchemaUtils.getNameField(objDescribe);
        List<String> identityFields = nameField == 'Id'
            ? new List<String>{ 'Id' }
            : new List<String>{ 'Id', nameField };

        try {
            List<SObject> records = stripReadableRecords(
                RecordSchemaUtils.queryById(objDescribe, identityFields, recordId, 1)
            );
            if (!records.isEmpty()) {
                return records[0];
            }
        } catch (Exception e) {
            // Fall through to a handled error below.
        }

        throw new AuraHandledException('Record not found or you do not have access.');
    }

    private static String resolveRecordDisplayName(
        SObject record,
        String nameField,
        String recordId
    ) {
        if (record == null) {
            return String.isNotBlank(recordId) ? recordId : null;
        }

        if (String.isBlank(nameField) || nameField == 'Id') {
            return String.isNotBlank(recordId) ? recordId : String.valueOf(record.get('Id'));
        }

        Object nameValue = record.get(nameField);
        return nameValue == null ? recordId : String.valueOf(nameValue);
    }

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

    /**
     * Discovers accessible single-target reference (lookup/master-detail) fields on
     * the active record, resolves their current value, and returns a descriptor per
     * reference. Polymorphic references (resolving to multiple sObject types) are
     * skipped for v1 and a warning is recorded on completeness.
     */
    private static List<ParentReferenceInfo> discoverParentReferences(
        Schema.DescribeSObjectResult objDescribe,
        String recordId,
        ContextCompleteness completeness
    ) {
        List<ParentReferenceInfo> results = new List<ParentReferenceInfo>();
        if (objDescribe == null || String.isBlank(recordId)) {
            return results;
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();
        List<Schema.DescribeFieldResult> candidates = new List<Schema.DescribeFieldResult>();
        List<Schema.DescribeFieldResult> polymorphic = new List<Schema.DescribeFieldResult>();

        for (String fn : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fn).getDescribe();
            if (dfr.getType() != Schema.DisplayType.REFERENCE) continue;
            if (!dfr.isAccessible()) continue;
            String apiName = dfr.getName();
            if (apiName == 'Id') continue;
            if (SYSTEM_REFERENCE_FIELDS.contains(apiName)) continue;

            List<Schema.SObjectType> refs = dfr.getReferenceTo();
            if (refs == null || refs.isEmpty()) continue;

            if (refs.size() > 1) {
                polymorphic.add(dfr);
                continue;
            }

            Schema.DescribeSObjectResult parentDescribe = refs[0].getDescribe();
            if (!parentDescribe.isAccessible() || !parentDescribe.isQueryable()) continue;

            candidates.add(dfr);
        }

        if (!polymorphic.isEmpty()) {
            addWarning(
                completeness,
                'Polymorphic lookup fields were skipped for parent record expansion (v1 supports single-target lookups only).'
            );
        }

        if (candidates.isEmpty()) {
            return results;
        }

        // Query foreign key values in one SOQL call.
        List<String> fkFields = new List<String>();
        fkFields.add('Id');
        for (Schema.DescribeFieldResult dfr : candidates) {
            fkFields.add(dfr.getName());
        }
        fkFields = RecordSchemaUtils.getCanonicalFieldNames(objDescribe, fkFields);

        SObject activeRecord;
        try {
            List<SObject> records = RecordSchemaUtils.queryById(objDescribe, fkFields, recordId, 1);
            records = stripReadableRecords(records);
            if (records.isEmpty()) {
                return results;
            }
            activeRecord = records[0];
        } catch (Exception e) {
            addWarning(
                completeness,
                'Parent lookup values could not be loaded for the active record.'
            );
            return results;
        }

        Integer added = 0;
        for (Schema.DescribeFieldResult dfr : candidates) {
            if (added >= MAX_PARENT_REFERENCES) {
                addWarning(
                    completeness,
                    'Parent lookup list was truncated at ' + MAX_PARENT_REFERENCES
                        + ' entries. Use the builder property defaultParentReferencesCsv to preselect the most relevant lookups.'
                );
                break;
            }

            String apiName = dfr.getName();
            Object fkValue = null;
            try {
                fkValue = activeRecord.get(apiName);
            } catch (Exception e) {
                continue;
            }

            Schema.DescribeSObjectResult parentDescribe = dfr.getReferenceTo()[0].getDescribe();

            ParentReferenceInfo info = new ParentReferenceInfo();
            info.referenceFieldApiName = apiName;
            info.referenceFieldLabel = dfr.getLabel();
            info.parentObjectApiName = parentDescribe.getName();
            info.parentObjectLabel = parentDescribe.getLabel();
            info.includedByDefault = isDefaultParentReference(apiName);

            if (fkValue != null) {
                String parentId = String.valueOf(fkValue);
                info.parentRecordId = parentId;
                info.parentRecordName = fetchRecordName(parentDescribe, parentId);
            }

            results.add(info);
            added++;
        }

        return results;
    }

    private static List<ParentReferenceInfo> describeParentReferences(Schema.DescribeSObjectResult objDescribe) {
        List<ParentReferenceInfo> results = new List<ParentReferenceInfo>();
        if (objDescribe == null) {
            return results;
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();
        Integer added = 0;
        for (String fn : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fn).getDescribe();
            if (dfr.getType() != Schema.DisplayType.REFERENCE) continue;
            if (!dfr.isAccessible()) continue;
            String apiName = dfr.getName();
            if (apiName == 'Id') continue;
            if (SYSTEM_REFERENCE_FIELDS.contains(apiName)) continue;

            List<Schema.SObjectType> refs = dfr.getReferenceTo();
            if (refs == null || refs.isEmpty() || refs.size() > 1) continue;

            Schema.DescribeSObjectResult parentDescribe = refs[0].getDescribe();
            if (!parentDescribe.isAccessible() || !parentDescribe.isQueryable()) continue;

            if (added >= MAX_PARENT_REFERENCES) break;
            ParentReferenceInfo info = new ParentReferenceInfo();
            info.referenceFieldApiName = apiName;
            info.referenceFieldLabel = dfr.getLabel();
            info.parentObjectApiName = parentDescribe.getName();
            info.parentObjectLabel = parentDescribe.getLabel();
            info.includedByDefault = isDefaultParentReference(apiName);
            results.add(info);
            added++;
        }

        return results;
    }

    private static Boolean isDefaultParentReference(String fieldApiName) {
        return fieldApiName != null && DEFAULT_PARENT_REFERENCE_FIELDS.contains(fieldApiName);
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
            return RecordSchemaUtils.countByFieldEquals(
                candidate.childDescribe,
                candidate.info.fieldName,
                recordId
            );
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

        List<SObject> records;
        try {
            records = RecordSchemaUtils.queryByFieldEquals(
                childDescribe,
                queryFields,
                foreignKeyField,
                recordId,
                null,
                maxRecords,
                true
            );
        } catch (QueryException qe) {
            records = RecordSchemaUtils.queryByFieldEquals(
                childDescribe,
                new List<String>{ 'Id', RecordSchemaUtils.getNameField(childDescribe) },
                foreignKeyField,
                recordId,
                null,
                maxRecords,
                false
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
     * Fetches parent record context (one-hop only) for each selected parent
     * reference field on the active record. Optionally includes same-object
     * siblings through the parent and one user-chosen parent-child relationship.
     * Applies a per-request cap and honors USER_MODE throughout.
     */
    private static List<ParentRecordContext> fetchParentContexts(
        Schema.DescribeSObjectResult objDescribe,
        String recordId,
        RecordContext ctx,
        List<String> includedParentReferenceFields,
        Boolean includeSameObjectSiblings,
        Map<String, String> parentSiblingRelationshipByReferenceField,
        Integer maxRelatedRecords
    ) {
        List<ParentRecordContext> results = new List<ParentRecordContext>();

        Map<String, String> relByRef = parentSiblingRelationshipByReferenceField == null
            ? new Map<String, String>()
            : parentSiblingRelationshipByReferenceField;

        // Dedupe and cap selections.
        List<String> selections = new List<String>();
        Set<String> seen = new Set<String>();
        for (String ref : includedParentReferenceFields) {
            if (String.isBlank(ref)) continue;
            String normalized = ref.trim();
            if (seen.contains(normalized)) continue;
            seen.add(normalized);
            selections.add(normalized);
            if (selections.size() >= MAX_PARENT_SELECTIONS) {
                addWarning(
                    ctx.completeness,
                    'Parent record selections were capped at ' + MAX_PARENT_SELECTIONS
                        + '. Additional selections were ignored for this request.'
                );
                break;
            }
        }

        if (selections.isEmpty()) {
            return results;
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();

        // Collect FK values for all requested references in a single query.
        List<String> fkFields = new List<String>{ 'Id' };
        List<Schema.DescribeFieldResult> validRefs = new List<Schema.DescribeFieldResult>();
        for (String ref : selections) {
            Schema.SObjectField field = fieldMap.get(ref);
            if (field == null) {
                markIncomplete(ctx.completeness,
                    'Parent reference "' + ref + '" was not found on ' + objDescribe.getName() + '.');
                continue;
            }
            Schema.DescribeFieldResult dfr = field.getDescribe();
            if (dfr.getType() != Schema.DisplayType.REFERENCE || !dfr.isAccessible()) {
                markIncomplete(ctx.completeness,
                    'Parent reference "' + ref + '" is not an accessible lookup on ' + objDescribe.getName() + '.');
                continue;
            }
            List<Schema.SObjectType> refsTo = dfr.getReferenceTo();
            if (refsTo == null || refsTo.isEmpty() || refsTo.size() > 1) {
                addWarning(ctx.completeness,
                    'Parent reference "' + ref + '" is polymorphic and was skipped.');
                continue;
            }
            validRefs.add(dfr);
            fkFields.add(dfr.getName());
        }

        if (validRefs.isEmpty()) {
            return results;
        }

        fkFields = RecordSchemaUtils.getCanonicalFieldNames(objDescribe, fkFields);

        SObject activeRecord;
        try {
            List<SObject> records = RecordSchemaUtils.queryById(objDescribe, fkFields, recordId, 1);
            records = stripReadableRecords(records);
            if (records.isEmpty()) {
                markIncomplete(ctx.completeness, 'Active record could not be re-queried for parent expansion.');
                return results;
            }
            activeRecord = records[0];
        } catch (Exception e) {
            markIncomplete(ctx.completeness, 'Parent lookup values could not be loaded for the active record.');
            return results;
        }

        for (Schema.DescribeFieldResult dfr : validRefs) {
            if (Limits.getQueries() >= Limits.getLimitQueries() - QUERY_SAFETY_BUFFER) {
                markIncomplete(ctx.completeness,
                    'Parent record expansion stopped early due to query limits.');
                break;
            }

            String refApiName = dfr.getName();
            Object fkValue = null;
            try {
                fkValue = activeRecord.get(refApiName);
            } catch (Exception e) {
                continue;
            }
            if (fkValue == null) {
                ParentRecordContext emptyCtx = new ParentRecordContext();
                emptyCtx.referenceFieldApiName = refApiName;
                emptyCtx.parentObjectApiName = dfr.getReferenceTo()[0].getDescribe().getName();
                emptyCtx.parentObjectLabel = dfr.getReferenceTo()[0].getDescribe().getLabel();
                addWarning(emptyCtx.completeness,
                    'The ' + dfr.getLabel() + ' field is blank on the active record; no parent context loaded.');
                results.add(emptyCtx);
                continue;
            }

            String parentId = String.valueOf(fkValue);
            Schema.DescribeSObjectResult parentDescribe = dfr.getReferenceTo()[0].getDescribe();

            try {
                triggerParentFetchFailureIfRequested();
                ParentRecordContext parentCtx = getParentRecordContext(
                    parentId,
                    parentDescribe,
                    refApiName,
                    includeSameObjectSiblings,
                    relByRef.get(refApiName),
                    maxRelatedRecords,
                    recordId,
                    objDescribe
                );
                if (parentCtx != null) {
                    results.add(parentCtx);
                    // Merge per-parent warnings into the overall completeness.
                    if (parentCtx.completeness != null && parentCtx.completeness.hasWarnings) {
                        ctx.completeness.hasWarnings = true;
                        if (!parentCtx.completeness.isComplete) {
                            ctx.completeness.isComplete = false;
                        }
                        for (String msg : parentCtx.completeness.warningMessages) {
                            addWarning(ctx.completeness, msg);
                        }
                    }
                }
            } catch (Exception e) {
                markIncomplete(ctx.completeness,
                    'Parent record for "' + dfr.getLabel() + '" could not be loaded.');
            }
        }

        return results;
    }

    /**
     * Loads one parent record's fields and, optionally, same-object siblings
     * through that parent plus one user-picked child relationship expansion.
     */
    @TestVisible
    private static ParentRecordContext getParentRecordContext(
        String parentRecordId,
        Schema.DescribeSObjectResult parentDescribe,
        String referenceFieldApiName,
        Boolean includeSameObjectSiblings,
        String siblingRelationshipName,
        Integer maxRelatedRecords,
        String currentRecordId,
        Schema.DescribeSObjectResult currentDescribe
    ) {
        ParentRecordContext parentCtx = new ParentRecordContext();
        parentCtx.referenceFieldApiName = referenceFieldApiName;
        parentCtx.parentObjectApiName = parentDescribe.getName();
        parentCtx.parentObjectLabel = parentDescribe.getLabel();
        parentCtx.parentRecordId = parentRecordId;

        // Build parent field list using its default-included categories.
        List<FieldCategory> allCategories = categorizeFields(parentDescribe);
        Set<String> fieldSet = new Set<String>();
        List<String> fieldsToQuery = new List<String>{ 'Id' };
        fieldSet.add('Id');

        String nameField = RecordSchemaUtils.getNameField(parentDescribe);
        if (!fieldSet.contains(nameField)) {
            fieldSet.add(nameField);
            fieldsToQuery.add(nameField);
        }

        for (FieldCategory cat : allCategories) {
            if (!cat.includedByDefault) continue;
            for (FieldInfo fi : cat.fields) {
                if (!fieldSet.contains(fi.apiName) && fieldsToQuery.size() < RecordSchemaUtils.MAX_FIELDS_PER_QUERY) {
                    fieldSet.add(fi.apiName);
                    fieldsToQuery.add(fi.apiName);
                }
            }
        }
        fieldsToQuery = RecordSchemaUtils.getCanonicalFieldNames(parentDescribe, fieldsToQuery);

        List<SObject> parentRecords;
        try {
            parentRecords = RecordSchemaUtils.queryById(parentDescribe, fieldsToQuery, parentRecordId, 1);
        } catch (QueryException qe) {
            parentRecords = RecordSchemaUtils.queryById(
                parentDescribe,
                new List<String>{ 'Id', nameField },
                parentRecordId,
                1
            );
        }
        parentRecords = stripReadableRecords(parentRecords);

        if (parentRecords.isEmpty()) {
            markIncomplete(parentCtx.completeness,
                'Parent record was not accessible or not found for ' + parentDescribe.getLabel() + '.');
            return parentCtx;
        }

        SObject parentRec = parentRecords[0];
        parentCtx.parentRecordName = String.valueOf(parentRec.get(nameField));

        Map<String, Schema.SObjectField> parentFieldMap = parentDescribe.fields.getMap();
        for (String fn : fieldsToQuery) {
            if (fn == 'Id') continue;
            try {
                Object val = parentRec.get(fn);
                Map<String, Object> fieldData = new Map<String, Object>();
                fieldData.put('value', RecordSchemaUtils.normalizeValue(val));
                if (parentFieldMap.containsKey(fn)) {
                    Schema.DescribeFieldResult dfr = parentFieldMap.get(fn).getDescribe();
                    fieldData.put('label', dfr.getLabel());
                    if (String.isNotBlank(dfr.getInlineHelpText())) {
                        fieldData.put('helpText', dfr.getInlineHelpText());
                    }
                }
                parentCtx.fields.put(fn, fieldData);
            } catch (Exception e) {
                noteSkippedField(parentCtx.completeness);
            }
        }

        // Same-object siblings: look for a child relationship on the parent that
        // targets the current record's object type (i.e., the relationship we
        // came in on), and fetch records excluding the current record.
        if (includeSameObjectSiblings && currentDescribe != null) {
            Schema.ChildRelationship matchCr = findChildRelationshipForObject(
                parentDescribe, currentDescribe.getName(), referenceFieldApiName
            );
            if (matchCr != null) {
                try {
                    RelatedRecordSet rrs = fetchRelatedRecords(
                        matchCr, parentRecordId, currentDescribe, maxRelatedRecords
                    );
                    if (rrs != null) {
                        List<Map<String, Object>> filtered = new List<Map<String, Object>>();
                        for (Map<String, Object> rec : rrs.records) {
                            String rid = extractIdValue(rec.get('Id'));
                            if (rid != null && rid.startsWith(currentRecordId.substring(0, 15))) {
                                continue;
                            }
                            filtered.add(rec);
                        }
                        parentCtx.sameObjectSiblings = filtered;
                        parentCtx.sameObjectSiblingsObjectApiName = currentDescribe.getName();
                        parentCtx.sameObjectSiblingsRelationshipName = matchCr.getRelationshipName();
                    }
                } catch (Exception e) {
                    addWarning(parentCtx.completeness,
                        'Same-object siblings through ' + parentDescribe.getLabel() + ' could not be loaded.');
                }
            } else {
                addWarning(parentCtx.completeness,
                    'No sibling child relationship was found on ' + parentDescribe.getLabel()
                        + ' for object ' + currentDescribe.getName() + '.');
            }
        }

        // Optional: user-picked child relationship expansion on the parent.
        if (String.isNotBlank(siblingRelationshipName)) {
            Schema.ChildRelationship chosen = null;
            for (Schema.ChildRelationship cr : parentDescribe.getChildRelationships()) {
                if (cr.getRelationshipName() == siblingRelationshipName) {
                    chosen = cr;
                    break;
                }
            }
            if (chosen == null) {
                addWarning(parentCtx.completeness,
                    'Relationship "' + siblingRelationshipName + '" was not found on '
                        + parentDescribe.getLabel() + '.');
            } else {
                Schema.DescribeSObjectResult childDescribe = chosen.getChildSObject().getDescribe();
                if (!isSupportedRelationship(chosen, siblingRelationshipName, childDescribe)) {
                    addWarning(parentCtx.completeness,
                        'Relationship "' + siblingRelationshipName + '" is not supported for parent-based expansion.');
                } else {
                    try {
                        parentCtx.selectedChildRelationship = fetchRelatedRecords(
                            chosen, parentRecordId, childDescribe, maxRelatedRecords
                        );
                    } catch (Exception e) {
                        addWarning(parentCtx.completeness,
                            'Related records for ' + siblingRelationshipName + ' could not be loaded.');
                    }
                }
            }
        }

        return parentCtx;
    }

    private static Schema.ChildRelationship findChildRelationshipForObject(
        Schema.DescribeSObjectResult parentDescribe,
        String targetObjectApiName,
        String preferredForeignKeyField
    ) {
        Schema.ChildRelationship fallback = null;
        for (Schema.ChildRelationship cr : parentDescribe.getChildRelationships()) {
            String relName = cr.getRelationshipName();
            if (String.isBlank(relName) || cr.isDeprecatedAndHidden() || cr.getField() == null) continue;

            Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
            if (childDescribe.getName() != targetObjectApiName) continue;
            if (!isSupportedRelationship(cr, relName, childDescribe)) continue;

            String fkName = cr.getField().getDescribe().getName();
            if (String.isNotBlank(preferredForeignKeyField) && fkName == preferredForeignKeyField) {
                return cr;
            }
            if (fallback == null) fallback = cr;
        }
        return fallback;
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
        completeness.hasWarnings = true;
        if (!completeness.warningMessages.contains(warningMessage)) {
            completeness.warningMessages.add(warningMessage);
        }
    }

    /**
     * Builds the SOQL field list for the active record, honoring every security boundary:
     * - Only fields present in categorizeFields() are considered (isAccessible + EXCLUDED_FIELD_TYPES pre-filtered).
     * - Only fields in the currently included categories are eligible.
     * - If a client-supplied includedFields override is provided, it is intersected with the above.
     * - Id and the object's name field are always present.
     * - MAX_FIELDS_PER_QUERY is always enforced; excess fields are dropped deterministically with a warning.
     * Rejected fields are counted but never echoed back.
     */
    private static List<String> buildQueryFieldList(
        Schema.DescribeSObjectResult objDescribe,
        List<FieldCategory> allCategories,
        Set<String> categorySet,
        List<String> includedFields,
        ContextCompleteness completeness
    ) {
        List<String> result = new List<String>();
        Set<String> added = new Set<String>();

        result.add('Id');
        added.add('Id');

        String nameField = RecordSchemaUtils.getNameField(objDescribe);
        if (String.isNotBlank(nameField) && !added.contains(nameField)) {
            result.add(nameField);
            added.add(nameField);
        }

        Set<String> categoryFieldUnion = new Set<String>();
        for (FieldCategory cat : allCategories) {
            Boolean included = categorySet.isEmpty() ? cat.includedByDefault : categorySet.contains(cat.name);
            if (!included) continue;
            for (FieldInfo fi : cat.fields) {
                if (String.isNotBlank(fi.apiName)) {
                    categoryFieldUnion.add(fi.apiName);
                }
            }
        }

        Boolean hasOverride = includedFields != null && !includedFields.isEmpty();
        Set<String> overrideNormalized = new Set<String>();
        Integer droppedOutsideCategories = 0;
        Integer droppedInaccessible = 0;
        if (hasOverride) {
            Set<String> seen = new Set<String>();
            for (String raw : includedFields) {
                if (String.isBlank(raw)) continue;
                String canonical = raw.trim();
                if (String.isBlank(canonical)) continue;
                String key = canonical.toLowerCase();
                if (seen.contains(key)) continue;
                seen.add(key);
                overrideNormalized.add(canonical);
            }
        }

        if (hasOverride) {
            Map<String, String> accessibleFieldByLower = new Map<String, String>();
            for (FieldCategory cat : allCategories) {
                for (FieldInfo fi : cat.fields) {
                    if (fi != null && String.isNotBlank(fi.apiName)) {
                        accessibleFieldByLower.put(fi.apiName.toLowerCase(), fi.apiName);
                    }
                }
            }

            Map<String, String> categoryFieldByLower = new Map<String, String>();
            for (String apiName : categoryFieldUnion) {
                categoryFieldByLower.put(apiName.toLowerCase(), apiName);
            }

            Integer droppedOversize = 0;
            for (String requested : overrideNormalized) {
                String resolved = categoryFieldByLower.get(requested.toLowerCase());
                if (resolved == null) {
                    if (accessibleFieldByLower.containsKey(requested.toLowerCase())) {
                        droppedOutsideCategories++;
                    } else {
                        droppedInaccessible++;
                    }
                    continue;
                }
                if (added.contains(resolved)) continue;
                if (result.size() >= RecordSchemaUtils.MAX_FIELDS_PER_QUERY) {
                    droppedOversize++;
                    continue;
                }
                result.add(resolved);
                added.add(resolved);
            }

            if (droppedOutsideCategories > 0) {
                addWarning(
                    completeness,
                    droppedOutsideCategories
                        + ' requested field(s) were outside the selected field categories and were skipped.'
                );
            }
            if (droppedInaccessible > 0) {
                addWarning(
                    completeness,
                    droppedInaccessible
                        + ' requested field(s) were not available for this object and user and were skipped.'
                );
            }
            if (droppedOversize > 0) {
                addWarning(
                    completeness,
                    droppedOversize
                        + ' requested field(s) exceeded the per-query field limit and were skipped.'
                );
            }
        } else {
            for (String apiName : categoryFieldUnion) {
                if (added.contains(apiName)) continue;
                if (result.size() >= RecordSchemaUtils.MAX_FIELDS_PER_QUERY) break;
                result.add(apiName);
                added.add(apiName);
            }
        }

        return RecordSchemaUtils.getCanonicalFieldNames(objDescribe, result);
    }

    private static String fetchRecordName(
        Schema.DescribeSObjectResult objDescribe,
        String recordId
    ) {
        try {
            String nameField = RecordSchemaUtils.getNameField(objDescribe);
            List<SObject> records = stripReadableRecords(
                RecordSchemaUtils.queryById(objDescribe, new List<String>{ nameField }, recordId, 1)
            );
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

    private static void triggerParentFetchFailureIfRequested() {
        if (Test.isRunningTest() && forceParentFetchFailure) {
            forceParentFetchFailure = false;
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
