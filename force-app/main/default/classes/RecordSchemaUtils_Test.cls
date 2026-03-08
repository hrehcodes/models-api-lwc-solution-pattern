@IsTest
private class RecordSchemaUtils_Test {

    @IsTest
    static void testGetNameField_Account() {
        Schema.DescribeSObjectResult accountDescribe = Account.SObjectType.getDescribe();
        String nameField = RecordSchemaUtils.getNameField(accountDescribe);
        System.assertEquals('Name', nameField, 'Account should use Name field');
    }

    @IsTest
    static void testGetNameField_Case() {
        Schema.DescribeSObjectResult caseDescribe = Case.SObjectType.getDescribe();
        String nameField = RecordSchemaUtils.getNameField(caseDescribe);
        System.assert(
            nameField == 'Subject' || nameField == 'CaseNumber',
            'Case should use Subject or CaseNumber, got: ' + nameField
        );
    }

    @IsTest
    static void testBuildFieldList_StartsWithId() {
        Schema.DescribeSObjectResult accountDescribe = Account.SObjectType.getDescribe();

        Test.startTest();
        List<String> fields = RecordSchemaUtils.buildFieldList(accountDescribe);
        Test.stopTest();

        System.assert(!fields.isEmpty(), 'Field list should not be empty');
        System.assertEquals('Id', fields[0], 'First field should be Id');
        System.assert(fields.size() <= RecordSchemaUtils.MAX_FIELDS_PER_QUERY, 'Should not exceed max fields');
    }

    @IsTest
    static void testBuildFieldList_IncludesNameField() {
        Schema.DescribeSObjectResult accountDescribe = Account.SObjectType.getDescribe();
        List<String> fields = RecordSchemaUtils.buildFieldList(accountDescribe);
        System.assert(fields.contains('Name'), 'Should include Name field for Account');
    }

    @IsTest
    static void testBuildFieldList_UsesCanonicalFieldNamesWithoutDuplicates() {
        Schema.DescribeSObjectResult opportunityDescribe = Opportunity.SObjectType.getDescribe();

        List<String> fields = RecordSchemaUtils.buildFieldList(opportunityDescribe);
        Set<String> normalizedFields = new Set<String>();

        for (String fieldName : fields) {
            String normalizedFieldName = fieldName.toLowerCase();
            System.assert(
                !normalizedFields.contains(normalizedFieldName),
                'Field list should not contain case-insensitive duplicates. Duplicate: ' + fieldName
            );
            normalizedFields.add(normalizedFieldName);
        }

        System.assert(fields.contains('StageName'), 'Opportunity field list should include StageName');
        System.assert(fields.contains('CloseDate'), 'Opportunity field list should include CloseDate');
        System.assert(fields.contains('Amount'), 'Opportunity field list should include Amount');
        System.assert(fields.contains('Probability'), 'Opportunity field list should include Probability');
        System.assert(fields.contains('NextStep'), 'Opportunity field list should include NextStep');
        System.assert(!fields.contains('id'), 'Field list should not include lowercase duplicate Id');
        System.assert(!fields.contains('name'), 'Field list should not include lowercase duplicate Name');
    }

    @IsTest
    static void testBuildIdentityFieldClause_DeduplicatesId() {
        Schema.DescribeSObjectResult accountDescribe = Account.SObjectType.getDescribe();
        String fieldClause = RecordSchemaUtils.buildIdentityFieldClause(accountDescribe);
        System.assertEquals('Id, Name', fieldClause, 'Account should query Id and Name without duplicates');
    }

    @IsTest
    static void testNormalizeValue_Null() {
        System.assertEquals(null, RecordSchemaUtils.normalizeValue(null));
    }

    @IsTest
    static void testNormalizeValue_String() {
        System.assertEquals('hello', RecordSchemaUtils.normalizeValue('hello'));
    }

    @IsTest
    static void testNormalizeValue_Boolean() {
        System.assertEquals(true, RecordSchemaUtils.normalizeValue(true));
        System.assertEquals(false, RecordSchemaUtils.normalizeValue(false));
    }

    @IsTest
    static void testNormalizeValue_Integer() {
        System.assertEquals(42, RecordSchemaUtils.normalizeValue(42));
    }

    @IsTest
    static void testNormalizeValue_Decimal() {
        System.assertEquals(3.14, RecordSchemaUtils.normalizeValue(3.14));
    }

    @IsTest
    static void testNormalizeValue_Date() {
        Date d = Date.newInstance(2026, 3, 2);
        System.assertEquals('2026-03-02', RecordSchemaUtils.normalizeValue(d));
    }

    @IsTest
    static void testNormalizeValue_DateSingleDigitMonth() {
        Date d = Date.newInstance(2026, 1, 5);
        System.assertEquals('2026-01-05', RecordSchemaUtils.normalizeValue(d));
    }

    @IsTest
    static void testNormalizeValue_Id() {
        Account acc = new Account(Name = 'Test');
        insert acc;
        Object result = RecordSchemaUtils.normalizeValue(acc.Id);
        System.assertEquals(String.valueOf(acc.Id), result);
    }

    @IsTest
    static void testConstants() {
        System.assertEquals(200, RecordSchemaUtils.MAX_FIELDS_PER_QUERY);
        System.assertEquals(100, RecordSchemaUtils.MAX_FIELD_NAME_LENGTH);
        System.assert(RecordSchemaUtils.EXCLUDED_FIELD_TYPES.contains(Schema.DisplayType.BASE64));
        System.assert(RecordSchemaUtils.EXCLUDED_FIELD_TYPES.contains(Schema.DisplayType.ADDRESS));
        System.assert(RecordSchemaUtils.EXCLUDED_FIELD_TYPES.contains(Schema.DisplayType.LOCATION));
    }
}
