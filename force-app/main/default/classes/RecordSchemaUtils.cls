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
        Set<String> fieldSet = new Set<String>();

        queryFields.add('Id');
        fieldSet.add('Id');

        String nameField = getNameField(objDescribe);
        if (!fieldSet.contains(nameField)) {
            queryFields.add(nameField);
            fieldSet.add(nameField);
        }

        Map<String, Schema.SObjectField> fieldMap = objDescribe.fields.getMap();

        for (String fieldName : fieldMap.keySet()) {
            if (fieldSet.contains(fieldName)) continue;
            if (queryFields.size() >= MAX_FIELDS_PER_QUERY) break;

            Schema.DescribeFieldResult dfr = fieldMap.get(fieldName).getDescribe();
            if (!dfr.isAccessible()) continue;
            if (EXCLUDED_FIELD_TYPES.contains(dfr.getType())) continue;
            if (fieldName.length() > MAX_FIELD_NAME_LENGTH) continue;

            if (dfr.isCalculated() && !isImportantCalculatedField(fieldName)) {
                continue;
            }

            queryFields.add(fieldName);
            fieldSet.add(fieldName);
        }

        return queryFields;
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
        return String.join(queryFields, ', ');
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
}
