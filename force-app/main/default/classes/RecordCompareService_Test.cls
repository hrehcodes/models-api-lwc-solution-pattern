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

        insert new List<Contact>{
            new Contact(FirstName = 'Alpha', LastName = 'Contact', AccountId = accounts[0].Id, Email = 'alpha@example.com'),
            new Contact(FirstName = 'Beta', LastName = 'Contact', AccountId = accounts[1].Id, Email = 'beta@example.com')
        };

        insert new List<Opportunity>{
            new Opportunity(
                Name = 'Compare Opportunity 1',
                AccountId = accounts[0].Id,
                StageName = 'Prospecting',
                CloseDate = Date.today().addDays(10),
                Amount = 32000,
                Probability = 30,
                NextStep = 'Schedule discovery call'
            ),
            new Opportunity(
                Name = 'Compare Opportunity 2',
                AccountId = accounts[1].Id,
                StageName = 'Proposal/Price Quote',
                CloseDate = Date.today().addDays(5),
                Amount = 98000,
                Probability = 70,
                NextStep = 'Finalize pricing review'
            )
        };
    }

    @IsTest
    static void testGetComparisonContext_TwoRecords() {
        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 2];
        List<String> ids = new List<String>();
        for (Account a : accounts) ids.add(a.Id);

        Test.startTest();
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(ids, 1, null, null, null, null, null);
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
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(ids, 1, null, null, null, null, null);
        Test.stopTest();

        System.assertEquals(3, ctx.records.size());
    }

    @IsTest
    static void testGetComparisonContext_OpportunityIncludesPrioritizationFields() {
        List<Opportunity> opportunities = [
            SELECT Id, Name, StageName, CloseDate, Amount, Probability, NextStep
            FROM Opportunity
            WHERE Name LIKE 'Compare Opportunity %'
            ORDER BY Name
        ];
        List<String> ids = new List<String>();
        for (Opportunity opp : opportunities) ids.add(opp.Id);

        Test.startTest();
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(
            ids,
            1,
            new List<String>{ 'core', 'status', 'financial', 'dates' },
            null,
            null,
            null,
            null
        );
        Test.stopTest();

        System.assertEquals('Opportunity', ctx.objectApiName);
        System.assert(ctx.commonFields.contains('StageName'), 'Common fields should include StageName');
        System.assert(ctx.commonFields.contains('CloseDate'), 'Common fields should include CloseDate');
        System.assert(ctx.commonFields.contains('Amount'), 'Common fields should include Amount');
        System.assert(ctx.commonFields.contains('Probability'), 'Common fields should include Probability');
        System.assert(ctx.commonFields.contains('NextStep'), 'Common fields should include NextStep');

        for (RecordCompareService.ComparisonRecord record : ctx.records) {
            System.assert(record.fields.containsKey('StageName'), 'Comparison record should include StageName');
            System.assert(record.fields.containsKey('CloseDate'), 'Comparison record should include CloseDate');
            System.assert(record.fields.containsKey('Amount'), 'Comparison record should include Amount');
            System.assert(record.fields.containsKey('Probability'), 'Comparison record should include Probability');
            System.assert(record.fields.containsKey('NextStep'), 'Comparison record should include NextStep');

            Map<String, Object> stageField = (Map<String, Object>) record.fields.get('StageName');
            System.assertEquals('Stage', String.valueOf(stageField.get('label')));
            System.assertNotEquals(null, stageField.get('value'));
        }
    }

    @IsTest
    static void testGetComparisonContext_AppliesSharedContextSelections() {
        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 2];
        List<String> ids = new List<String>();
        for (Account accountRecord : accounts) ids.add(accountRecord.Id);

        Test.startTest();
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(
            ids,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'Contacts' },
            5,
            10,
            null
        );
        Test.stopTest();

        System.assertEquals(false, ctx.commonFields.contains('AnnualRevenue'), 'Only the selected categories should be included');
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Supported account compare context should not warn');

        for (RecordCompareService.ComparisonRecord record : ctx.records) {
            System.assert(record.fields.containsKey('Name'), 'Core fields should still be included');
            System.assertEquals(false, record.fields.containsKey('AnnualRevenue'), 'Financial fields should be excluded');
            System.assertEquals(1, record.relatedRecordSets.size(), 'The selected relationship should be loaded for each record');
            System.assertEquals('Contacts', record.relatedRecordSets[0].relationshipName);
        }
    }

    @IsTest
    static void testGetComparisonContext_TooFew() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(new List<String>{ acc.Id }, 1, null, null, null, null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should require at least 2 records');
    }

    @IsTest
    static void testGetComparisonContext_InvalidId() {
        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(new List<String>{ 'bad', 'ids' }, 1, null, null, null, null, null);
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
            RecordCompareService.getComparisonContext(new List<String>{ acc.Id, acc.Id }, 1, null, null, null, null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should require at least 2 unique records');
    }

    @IsTest
    static void testGetComparisonContext_RespectsMaxCompareRecords() {
        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 3];
        List<String> ids = new List<String>();
        for (Account accountRecord : accounts) ids.add(accountRecord.Id);

        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(ids, 1, null, null, 2, null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assertEquals(true, exceptionThrown, 'Should enforce maxCompareRecords server-side');
    }

    @IsTest
    static void testGetComparisonContext_RespectsMaxRelatedRecords() {
        Account targetAccount = [SELECT Id FROM Account WHERE Name = 'Compare Account 1' LIMIT 1];
        insert new Contact(FirstName = 'Extra', LastName = 'Contact', AccountId = targetAccount.Id, Email = 'extra@example.com');

        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 2];
        List<String> ids = new List<String>();
        for (Account accountRecord : accounts) ids.add(accountRecord.Id);

        Test.startTest();
        RecordCompareService.ComparisonContext ctx = RecordCompareService.getComparisonContext(
            ids,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'Contacts' },
            5,
            1,
            null
        );
        Test.stopTest();

        for (RecordCompareService.ComparisonRecord record : ctx.records) {
            if (record.recordName == 'Compare Account 1') {
                System.assertEquals(1, record.relatedRecordSets[0].records.size(), 'Compare mode should respect maxRelatedRecords');
            }
        }
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

        List<String> unsupportedCandidates = new List<String>{
            'ActivityHistory',
            'AttachedContentDocument',
            'CombinedAttachment',
            'EntityDefinition',
            'FieldDefinition',
            'OpenActivity',
            'UserRecordAccess'
        };
        String unsupportedObjectApiName;
        Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
        for (String candidateApiName : unsupportedCandidates) {
            if (!globalDescribe.containsKey(candidateApiName)) {
                continue;
            }
            if (!RecordCompareService.isCompareSupportedObject(
                globalDescribe.get(candidateApiName).getDescribe()
            )) {
                unsupportedObjectApiName = candidateApiName;
                break;
            }
        }

        if (String.isNotBlank(unsupportedObjectApiName)) {
            Boolean containsUnsupportedObject = false;
            for (RecordCompareService.ObjectOption option : options) {
                if (option.apiName == unsupportedObjectApiName) {
                    containsUnsupportedObject = true;
                    break;
                }
            }
            System.assertEquals(
                false,
                containsUnsupportedObject,
                'Objects without reliable compare-search support should be filtered out'
            );
        }
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

    @IsTest
    static void testGetComparisonContext_RejectsOverThresholdComparisonContext() {
        List<Account> accounts = [SELECT Id FROM Account ORDER BY Name LIMIT 2];
        List<String> ids = new List<String>();
        for (Account accountRecord : accounts) ids.add(accountRecord.Id);

        Boolean exceptionThrown = false;
        try {
            RecordCompareService.getComparisonContext(
                ids,
                1,
                new List<String>{ 'core', 'financial', 'status', 'dates', 'custom', 'other' },
                new List<String>{ 'Contacts' },
                5,
                10,
                1
            );
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assertEquals(true, exceptionThrown, 'Large comparison contexts should be rejected above the configured ceiling');
    }

    @IsTest
    static void testGetSuggestionLookupFields_RespectsCapOverride() {
        RecordCompareService.suggestionLookupLimitOverride = 2;
        List<String> lookupFields = RecordCompareService.getSuggestionLookupFields(Account.SObjectType.getDescribe());
        RecordCompareService.suggestionLookupLimitOverride = null;

        System.assertEquals(2, lookupFields.size(), 'Lookup probing should respect the configured per-request cap');
    }
}
