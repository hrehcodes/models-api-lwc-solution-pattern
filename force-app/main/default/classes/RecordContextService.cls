/**
 * Generic, object-agnostic record context builder for Agentforce Record Insights.
 * Uses Schema Describe APIs to dynamically discover fields, relationships, and metadata
 * for ANY standard or custom object -- zero configuration required.
 *
 * Security: Enforces FLS, CRUD, and sharing rules at every layer.
 */
public with sharing class RecordContextService {

    private static final Integer DEFAULT_RELATED_RECORD_LIMIT = 10;
    private static final Integer MAX_RELATIONSHIP_QUERIES = 20;
    private static final Integer QUERY_SAFETY_BUFFER = 10;

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
        @AuraEnabled public Boolean includedByDefault { get; set; }
    }

    public class RecordContext {
        @AuraEnabled public String recordId { get; set; }
        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String objectLabel { get; set; }
        @AuraEnabled public String recordName { get; set; }
        @AuraEnabled public Map<String, Object> fields { get; set; }
        @AuraEnabled public List<RelatedRecordSet> relatedRecordSets { get; set; }

        public RecordContext() {
            this.fields = new Map<String, Object>();
            this.relatedRecordSets = new List<RelatedRecordSet>();
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
        ctx.relationships = discoverRelationships(objDescribe, recordId);

        // Fetch record name
        try {
            String nameField = RecordSchemaUtils.getNameField(objDescribe);
            // Object/field names sourced from Schema Describe, not user input -- safe for dynamic SOQL
            String soql = 'SELECT ' + nameField + ' FROM ' + objectApiName + ' WHERE Id = :recordId LIMIT 1';
            List<SObject> records = Database.query(soql);
            if (!records.isEmpty()) {
                ctx.recordName = String.valueOf(records[0].get(nameField));
            }
        } catch (Exception e) {
            ctx.recordName = recordId;
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
        List<String> includedRelationships
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
            records = Database.query('SELECT Id, ' + nameField + ' FROM ' + objectApiName + ' WHERE Id = :recordId LIMIT 1');
        }

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
                // Skip fields that fail
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
                if (!childDescribe.isAccessible()) continue;

                try {
                    RelatedRecordSet rrs = fetchRelatedRecords(
                        cr, recordId, childDescribe, DEFAULT_RELATED_RECORD_LIMIT
                    );
                    if (rrs != null && !rrs.records.isEmpty()) {
                        ctx.relatedRecordSets.add(rrs);

                        if (depth >= 2) {
                            fetchDescendants(rrs, ctx, childDescribe, 2, depth);
                        }
                    }
                } catch (Exception e) {
                    // Skip relationships that fail
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

        if (maxRecords == null || maxRecords <= 0) { maxRecords = DEFAULT_RELATED_RECORD_LIMIT; }
        if (maxRecords > 50) { maxRecords = 50; }

        for (Schema.ChildRelationship cr : objDescribe.getChildRelationships()) {
            if (cr.getRelationshipName() == relationshipName) {
                Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
                if (!childDescribe.isAccessible()) {
                    throw new AuraHandledException('You do not have access to the related object.');
                }
                return fetchRelatedRecords(cr, recordId, childDescribe, maxRecords);
            }
        }

        throw new AuraHandledException('Relationship not found: ' + relationshipName);
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
            'Industry', 'Department', 'AccountId', 'ContactId'
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

        for (String fieldName : fieldMap.keySet()) {
            Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();

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
        Schema.DescribeSObjectResult objDescribe, String recordId
    ) {
        List<RelationshipInfo> relationships = new List<RelationshipInfo>();
        List<Schema.ChildRelationship> childRels = objDescribe.getChildRelationships();
        Integer countQueriesUsed = 0;

        for (Schema.ChildRelationship cr : childRels) {
            String relName = cr.getRelationshipName();
            if (relName == null) continue;

            Schema.DescribeSObjectResult childDescribe = cr.getChildSObject().getDescribe();
            if (!childDescribe.isAccessible()) continue;

            if (isSystemRelationship(relName, childDescribe.getName())) continue;

            RelationshipInfo info = new RelationshipInfo();
            info.relationshipName = relName;
            info.childObjectApiName = childDescribe.getName();
            info.childObjectLabel = childDescribe.getLabel();
            info.fieldName = cr.getField().getDescribe().getName();
            info.includedByDefault = isDefaultRelationship(childDescribe.getName());

            if (countQueriesUsed >= MAX_RELATIONSHIP_QUERIES) {
                info.recordCount = -1;
                relationships.add(info);
                continue;
            }

            // Object/field names sourced from Schema Describe, not user input -- safe for dynamic SOQL
            try {
                String countSoql = 'SELECT COUNT() FROM ' + childDescribe.getName()
                    + ' WHERE ' + info.fieldName + ' = :recordId';
                info.recordCount = Database.countQuery(countSoql);
                countQueriesUsed++;
            } catch (Exception e) {
                info.recordCount = 0;
            }

            if (info.recordCount > 0 || info.recordCount == -1) {
                relationships.add(info);
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

    private static Boolean isDefaultRelationship(String childObjectName) {
        Set<String> defaults = new Set<String>{
            'Opportunity', 'Contact', 'Case', 'Task', 'Event',
            'OpportunityLineItem', 'OpportunityContactRole',
            'CampaignMember', 'Lead'
        };
        if (defaults.contains(childObjectName)) return true;
        // Include custom objects by default
        if (childObjectName.endsWith('__c')) return true;
        return false;
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
            String nameField = RecordSchemaUtils.getNameField(childDescribe);
            records = Database.query('SELECT Id, ' + nameField + ' FROM ' + childObjectName
                + ' WHERE ' + foreignKeyField + ' = :recordId LIMIT ' + maxRecords);
        }

        RelatedRecordSet rrs = new RelatedRecordSet(relName, childObjectName, childDescribe.getLabel());
        Map<String, Schema.SObjectField> childFieldMap = childDescribe.fields.getMap();

        for (SObject rec : records) {
            rrs.records.add(buildRecordMap(rec, childFieldMap));
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
        Integer maxDepth
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
            if (!childDescribe.isAccessible()) continue;
            if (isSystemRelationship(relName, childDescribe.getName())) continue;
            if (!isDefaultRelationship(childDescribe.getName())) continue;

            Integer parentCount = 0;
            for (Map<String, Object> parentRec : parentRrs.records) {
                if (parentCount >= maxParents) break;
                if (Limits.getQueries() >= Limits.getLimitQueries() - QUERY_SAFETY_BUFFER) break;

                String parentRecordId = extractIdValue(parentRec.get('Id'));
                if (parentRecordId == null) continue;

                try {
                    RelatedRecordSet childRrs = fetchRelatedRecords(
                        cr, parentRecordId, childDescribe, maxRecords
                    );
                    if (childRrs != null && !childRrs.records.isEmpty()) {
                        childRrs.relationshipName = parentRrs.childObjectApiName + '.' + relName;
                        ctx.relatedRecordSets.add(childRrs);

                        if (currentDepth < maxDepth) {
                            fetchDescendants(childRrs, ctx, childDescribe, currentDepth + 1, maxDepth);
                        }
                    }
                } catch (Exception e) {
                    // Skip descendant relationships that fail
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

    private static Map<String, Object> buildRecordMap(SObject record, Map<String, Schema.SObjectField> fieldMap) {
        Map<String, Object> result = new Map<String, Object>();
        Map<String, Object> populated = record.getPopulatedFieldsAsMap();

        for (String fieldName : populated.keySet()) {
            try {
                Object val = populated.get(fieldName);
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

}
