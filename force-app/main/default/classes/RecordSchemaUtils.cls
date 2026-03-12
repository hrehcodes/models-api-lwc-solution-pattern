/**
 * Shared utility methods for Schema Describe operations used by
 * RecordContextService and RecordCompareService.
 *
 * Centralizes field-list building, name-field resolution, and value
 * normalization so the logic is maintained in a single place.
 */
public with sharing class RecordSchemaUtils {

    public static final Integer MAX_FIELDS_PER_QUERY = 200;
    public static final Integer MAX_FIELD_NAME_LENGTH = 100;
    private static final String SAFE_IDENTIFIER_PATTERN = '^[A-Za-z][A-Za-z0-9_]*$';
    private static final String ORDER_BY_LAST_MODIFIED_DESC = 'LastModifiedDate DESC';
    private static final String ORDER_BY_LAST_MODIFIED_DESC_NULLS_LAST = 'LastModifiedDate DESC NULLS LAST';

    public static final Set<Schema.DisplayType> EXCLUDED_FIELD_TYPES = new Set<Schema.DisplayType>{
        Schema.DisplayType.BASE64,
        Schema.DisplayType.ADDRESS,
        Schema.DisplayType.LOCATION
    };

    private static final Set<String> IMPORTANT_CALCULATED_KEYWORDS = new Set<String>{
        'date', 'days', 'age', 'activity', 'won', 'closed', 'revenue', 'amount'
    };

    /**
     * Resolves the best human-readable "name" field for an object.
     * Falls back through Subject, CaseNumber, Title, DeveloperName, then Id.
     */
    public static String getNameField(Schema.DescribeSObjectResult objDescribe) {
        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();
        if (fieldMap.containsKey('Name') && fieldMap.get('Name').getDescribe().isAccessible()) {
            return 'Name';
        }
        for (String candidate : new List<String>{'Subject', 'CaseNumber', 'Title', 'DeveloperName'}) {
            if (fieldMap.containsKey(candidate) && fieldMap.get(candidate).getDescribe().isAccessible()) {
                return candidate;
            }
        }
        return 'Id';
    }

    /**
     * Builds a query-safe list of accessible fields for an object.
     * Always starts with Id and the name field. Skips binary/address/location
     * types and most calculated fields (keeps date/amount-related formulas).
     */
    public static List<String> buildFieldList(Schema.DescribeSObjectResult objDescribe) {
        List<String> queryFields = new List<String>();
        Set<String> normalizedFieldSet = new Set<String>();

        queryFields.add('Id');
        normalizedFieldSet.add('id');

        String nameField = getNameField(objDescribe);
        String normalizedNameField = nameField.toLowerCase();
        if (!normalizedFieldSet.contains(normalizedNameField)) {
            queryFields.add(nameField);
            normalizedFieldSet.add(normalizedNameField);
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();

        for (String fieldKey : fieldMap.keySet()) {
            if (queryFields.size() >= MAX_FIELDS_PER_QUERY) break;

            Schema.DescribeFieldResult dfr = fieldMap.get(fieldKey).getDescribe();
            String fieldName = dfr.getName();
            String normalizedFieldName = fieldName.toLowerCase();

            if (normalizedFieldSet.contains(normalizedFieldName)) continue;
            if (!dfr.isAccessible()) continue;
            if (EXCLUDED_FIELD_TYPES.contains(dfr.getType())) continue;
            if (fieldName.length() > MAX_FIELD_NAME_LENGTH) continue;

            if (dfr.isCalculated() && !isImportantCalculatedField(fieldName)) {
                continue;
            }

            queryFields.add(fieldName);
            normalizedFieldSet.add(normalizedFieldName);
        }

        return getCanonicalFieldNames(objDescribe, queryFields);
    }

    /**
     * Builds the smallest useful select clause for a record: Id plus the best
     * display field when it differs from Id.
     */
    public static String buildIdentityFieldClause(Schema.DescribeSObjectResult objDescribe) {
        List<String> queryFields = new List<String>{ 'Id' };
        String nameField = getNameField(objDescribe);
        if (nameField != 'Id') {
            queryFields.add(nameField);
        }
        return buildSelectClause(objDescribe, queryFields);
    }

    /**
     * Returns the canonical API name for an object after validating it came from
     * an accessible, queryable Describe result.
     */
    public static String getCanonicalObjectName(Schema.DescribeSObjectResult objDescribe) {
        if (objDescribe == null || !objDescribe.isAccessible() || !objDescribe.isQueryable()) {
            throw new AuraHandledException('Invalid or inaccessible object type.');
        }

        String objectApiName = objDescribe.getName();
        validateIdentifier(objectApiName, 'object');
        return objectApiName;
    }

    /**
     * Returns a canonical API name for a single accessible field.
     */
    public static String getCanonicalFieldName(
        Schema.DescribeSObjectResult objDescribe,
        String fieldApiName
    ) {
        return getCanonicalFieldNames(objDescribe, new List<String>{ fieldApiName })[0];
    }

    /**
     * Canonicalizes and validates a select list so only accessible schema-derived
     * identifiers are carried into dynamic SOQL.
     */
    public static List<String> getCanonicalFieldNames(
        Schema.DescribeSObjectResult objDescribe,
        List<String> fieldApiNames
    ) {
        if (objDescribe == null) {
            throw new AuraHandledException('Object metadata is required.');
        }
        if (fieldApiNames == null || fieldApiNames.isEmpty()) {
            throw new AuraHandledException('At least one field is required.');
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();
        List<String> canonicalFieldNames = new List<String>();
        Set<String> normalizedFieldNames = new Set<String>();

        for (String fieldApiName : fieldApiNames) {
            if (String.isBlank(fieldApiName)) {
                throw new AuraHandledException('Field API name is required.');
            }

            Schema.SObjectField fieldToken = fieldMap.get(fieldApiName);
            if (fieldToken == null) {
                throw new AuraHandledException('Invalid or inaccessible field selection: ' + fieldApiName);
            }

            Schema.DescribeFieldResult dfr = fieldToken.getDescribe();
            if (!dfr.isAccessible()) {
                throw new AuraHandledException('Invalid or inaccessible field selection: ' + fieldApiName);
            }

            String canonicalFieldName = dfr.getName();
            validateIdentifier(canonicalFieldName, 'field');

            if (canonicalFieldName.length() > MAX_FIELD_NAME_LENGTH) {
                throw new AuraHandledException('Field API name exceeds the supported length: ' + canonicalFieldName);
            }

            String normalizedFieldName = canonicalFieldName.toLowerCase();
            if (normalizedFieldNames.contains(normalizedFieldName)) {
                continue;
            }

            canonicalFieldNames.add(canonicalFieldName);
            normalizedFieldNames.add(normalizedFieldName);
        }

        return canonicalFieldNames;
    }

    /**
     * Builds a validated select clause from canonical field names.
     */
    public static String buildSelectClause(
        Schema.DescribeSObjectResult objDescribe,
        List<String> fieldApiNames
    ) {
        return String.join(getCanonicalFieldNames(objDescribe, fieldApiNames), ', ');
    }

    public static Integer normalizeQueryLimit(Integer requestedLimit, Integer defaultLimit, Integer maxLimit) {
        Integer normalizedLimit = requestedLimit;
        if (normalizedLimit == null || normalizedLimit <= 0) {
            normalizedLimit = defaultLimit;
        }
        if (maxLimit != null && maxLimit > 0 && normalizedLimit > maxLimit) {
            normalizedLimit = maxLimit;
        }
        return Math.max(normalizedLimit, 1);
    }

    /**
     * Runs a validated single-record query by Id. Identifiers are always derived
     * from Describe metadata before being interpolated into SOQL.
     */
    @SuppressWarnings('PMD.ApexSOQLInjection')
    public static List<SObject> queryById(
        Schema.DescribeSObjectResult objDescribe,
        List<String> selectFields,
        String recordId,
        Integer limitSize
    ) {
        Integer normalizedLimit = normalizeQueryLimit(limitSize, 1, 1);
        String soql = 'SELECT ' + buildSelectClause(objDescribe, selectFields)
            + ' FROM ' + getCanonicalObjectName(objDescribe)
            + ' WHERE Id = :recordId'
            + ' LIMIT :normalizedLimit';
        return Database.query(soql);
    }

    /**
     * Runs a validated equality query ordered by recency.
     */
    @SuppressWarnings('PMD.ApexSOQLInjection')
    public static List<SObject> queryByFieldEquals(
        Schema.DescribeSObjectResult objDescribe,
        List<String> selectFields,
        String filterField,
        Object filterValue,
        String excludedRecordId,
        Integer limitSize,
        Boolean nullsLast
    ) {
        Integer normalizedLimit = normalizeQueryLimit(limitSize, 1, null);
        String orderByClause = nullsLast == true
            ? ORDER_BY_LAST_MODIFIED_DESC_NULLS_LAST
            : ORDER_BY_LAST_MODIFIED_DESC;
        String soql = 'SELECT ' + buildSelectClause(objDescribe, selectFields)
            + ' FROM ' + getCanonicalObjectName(objDescribe)
            + ' WHERE ' + getCanonicalFieldName(objDescribe, filterField) + ' = :filterValue';

        if (String.isNotBlank(excludedRecordId)) {
            soql += ' AND Id != :excludedRecordId';
        }

        soql += ' ORDER BY ' + orderByClause + ' LIMIT :normalizedLimit';
        return Database.query(soql);
    }

    /**
     * Runs a validated LIKE query ordered by recency.
     */
    @SuppressWarnings('PMD.ApexSOQLInjection')
    public static List<SObject> queryByFieldLike(
        Schema.DescribeSObjectResult objDescribe,
        List<String> selectFields,
        String filterField,
        String searchPattern,
        Integer limitSize
    ) {
        Integer normalizedLimit = normalizeQueryLimit(limitSize, 1, null);
        String soql = 'SELECT ' + buildSelectClause(objDescribe, selectFields)
            + ' FROM ' + getCanonicalObjectName(objDescribe)
            + ' WHERE ' + getCanonicalFieldName(objDescribe, filterField) + ' LIKE :searchPattern'
            + ' ORDER BY ' + ORDER_BY_LAST_MODIFIED_DESC
            + ' LIMIT :normalizedLimit';
        return Database.query(soql);
    }

    /**
     * Runs a validated recency query, optionally excluding the current record.
     */
    @SuppressWarnings('PMD.ApexSOQLInjection')
    public static List<SObject> queryRecentRecords(
        Schema.DescribeSObjectResult objDescribe,
        List<String> selectFields,
        String excludedRecordId,
        Integer limitSize
    ) {
        Integer normalizedLimit = normalizeQueryLimit(limitSize, 1, null);
        String soql = 'SELECT ' + buildSelectClause(objDescribe, selectFields)
            + ' FROM ' + getCanonicalObjectName(objDescribe);

        if (String.isNotBlank(excludedRecordId)) {
            soql += ' WHERE Id != :excludedRecordId';
        }

        soql += ' ORDER BY ' + ORDER_BY_LAST_MODIFIED_DESC + ' LIMIT :normalizedLimit';
        return Database.query(soql);
    }

    /**
     * Counts records for a validated equality filter.
     */
    @SuppressWarnings('PMD.ApexSOQLInjection')
    public static Integer countByFieldEquals(
        Schema.DescribeSObjectResult objDescribe,
        String filterField,
        Object filterValue
    ) {
        String soql = 'SELECT COUNT() FROM ' + getCanonicalObjectName(objDescribe)
            + ' WHERE ' + getCanonicalFieldName(objDescribe, filterField) + ' = :filterValue';
        return Database.countQuery(soql);
    }

    /**
     * Normalizes any Salesforce field value to a JSON-safe primitive.
     */
    public static Object normalizeValue(Object val) {
        if (val == null) return null;

        if (val instanceof String || val instanceof Boolean
            || val instanceof Integer || val instanceof Long
            || val instanceof Decimal || val instanceof Double) {
            return val;
        }

        if (val instanceof Date) {
            Date d = (Date) val;
            return d.year() + '-' + String.valueOf(d.month()).leftPad(2, '0')
                + '-' + String.valueOf(d.day()).leftPad(2, '0');
        }

        if (val instanceof DateTime) {
            return ((DateTime) val).format('yyyy-MM-dd HH:mm:ss');
        }

        if (val instanceof Id) {
            return String.valueOf((Id) val);
        }

        if (val instanceof SObject) {
            SObject sobj = (SObject) val;
            try {
                Object nameVal = sobj.get('Name');
                if (nameVal != null) return String.valueOf(nameVal);
                Object idVal = sobj.get('Id');
                if (idVal != null) return String.valueOf(idVal);
            } catch (Exception e) { /* fall through */ }
            return null;
        }

        try {
            return String.valueOf(val);
        } catch (Exception e) {
            return null;
        }
    }

    private static Boolean isImportantCalculatedField(String fieldName) {
        String lower = fieldName.toLowerCase();
        for (String keyword : IMPORTANT_CALCULATED_KEYWORDS) {
            if (lower.contains(keyword)) return true;
        }
        return false;
    }

    private static void validateIdentifier(String identifier, String identifierType) {
        if (String.isBlank(identifier) || !Pattern.matches(SAFE_IDENTIFIER_PATTERN, identifier)) {
            throw new AuraHandledException('Invalid ' + identifierType + ' metadata.');
        }
    }
}
