@IsTest
private class RecordCompareService_Test {

    @TestSetup
    static void setup() {
        List<Account> accounts = new List<Account>{
            new Account(Name = 'Compare Account 1', Industry = 'Technology', AnnualRevenue = 500000),
            new Account(Name = 'Compare Account 2', Industry = 'Finance', AnnualRevenue = 1000000),
            new Account(Name = 'Compare Account 3', Industry = 'Healthcare', AnnualRevenue = 750000)
        };
        insert accounts;
    }

    @IsTest
    static void testGetComparisonContext_TwoRecords() {
        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 2];
        List<String> ids = new List<String>();
        for (Account a : accounts) ids.add(a.Id);

        Test.startTest();
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(ids);
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assertEquals('Account', ctx.objectApiName);
        System.assertEquals(2, ctx.recordCount);
        System.assertEquals(2, ctx.records.size());
    }

    @IsTest
    static void testGetComparisonContext_ThreeRecords() {
        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 3];
        List<String> ids = new List<String>();
        for (Account a : accounts) ids.add(a.Id);

        Test.startTest();
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(ids);
        Test.stopTest();

        System.assertEquals(3, ctx.records.size());
    }

    @IsTest
    static void testGetComparisonContext_TooFew() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(new List<String>{ acc.Id });
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should require at least 2 records');
    }

    @IsTest
    static void testGetComparisonContext_InvalidId() {
        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(new List<String>{ 'bad', 'ids' });
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for invalid IDs');
    }

    @IsTest
    static void testGetComparisonContext_DuplicateIdsNotEnoughUnique() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(new List<String>{ acc.Id, acc.Id });
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should require at least 2 unique records');
    }

    @IsTest
    static void testSearchRecords_NoTerm() {
        Test.startTest();
        List<Map<String, String>> results = RecordCompareService.searchRecords('Account', null, 5);
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Should return recent records');
    }

    @IsTest
    static void testSearchRecords_WithTerm() {
        Test.startTest();
        List<Map<String, String>> results = RecordCompareService.searchRecords('Account', 'Compare', 5);
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Should find matching records');
    }

    @IsTest
    static void testGetAvailableCompareObjects() {
        Test.startTest();
        List<RecordCompareService.ObjectOption> options = RecordCompareService.getAvailableCompareObjects();
        Test.stopTest();

        System.assert(!options.isEmpty(), 'Should return accessible compare objects');

        Boolean containsAccount = false;
        for (RecordCompareService.ObjectOption option : options) {
            if (option.apiName == 'Account') {
                containsAccount = true;
                break;
            }
        }
        System.assertEquals(true, containsAccount, 'Account should be included in dynamic object discovery');
    }

    @IsTest
    static void testSearchRecords_InvalidObject() {
        Boolean exceptionThrown = false;
        try {
            RecordCompareService.searchRecords('NotARealObject__x', 'test', 5);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for invalid object type');
    }

    @IsTest
    static void testGetSuggestedRecords_WithRecord() {
        Account acc = [SELECT Id FROM Account WHERE Name = 'Compare Account 1' LIMIT 1];

        Test.startTest();
        List<Map<String, String>> results = RecordCompareService.getSuggestedRecords(acc.Id, 5);
        Test.stopTest();

        System.assert(!results.isEmpty(), 'Should return suggested records');
        for (Map<String, String> r : results) {
            System.assertNotEquals(acc.Id, r.get('id'), 'Should not include the source record');
        }
    }

    @IsTest
    static void testGetSuggestedRecords_InvalidId() {
        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getSuggestedRecords(null, 5);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for null ID');
    }

    @IsTest
    static void testGetSuggestedRecords_MalformedId() {
        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getSuggestedRecords('not-an-id', 5);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for malformed ID');
    }

    @IsTest
    static void testComparisonContextWrapper() {
        RecordCompareService.ComparisonContext ctx = new RecordCompareService.ComparisonContext();
        System.assertNotEquals(null, ctx.records);
        System.assertNotEquals(null, ctx.commonFields);

        RecordCompareService.ComparisonRecord cr = new RecordCompareService.ComparisonRecord();
        System.assertNotEquals(null, cr.fields);
    }
}
