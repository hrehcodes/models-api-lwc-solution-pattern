@IsTest
private class RecordContextService_Test {

    @TestSetup
    static void setup() {
        Account testAccount = new Account(
            Name = 'Test Account',
            Industry = 'Technology',
            Phone = '555-1234',
            Website = 'https://test.com',
            AnnualRevenue = 1000000,
            Type = 'Customer'
        );
        insert testAccount;

        Contact testContact = new Contact(
            FirstName = 'Test',
            LastName = 'Contact',
            Email = 'test@test.com',
            Phone = '555-5678',
            AccountId = testAccount.Id
        );
        Contact secondContact = new Contact(
            FirstName = 'Second',
            LastName = 'Contact',
            Email = 'second@test.com',
            Phone = '555-9012',
            AccountId = testAccount.Id
        );
        insert new List<Contact>{ testContact, secondContact };

        Opportunity testOpp = new Opportunity(
            Name = 'Test Opportunity',
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30),
            Amount = 50000,
            AccountId = testAccount.Id
        );
        insert testOpp;

    }

    @IsTest
    static void testGetAvailableContext_Account() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(acc.Id);
        Test.stopTest();

        System.assertNotEquals(null, ctx, 'Context should not be null');
        System.assertEquals('Account', ctx.objectApiName, 'Object type should be Account');
        System.assertEquals('Test Account', ctx.recordName, 'Record name should match');
        System.assert(!ctx.fieldCategories.isEmpty(), 'Should have field categories');
    }

    @IsTest
    static void testGetAvailableContext_Opportunity() {
        Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(opp.Id);
        Test.stopTest();

        System.assertEquals('Opportunity', ctx.objectApiName);
        System.assertEquals('Test Opportunity', ctx.recordName);
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Supported opportunity relationships should not warn during discovery');

        Boolean probabilityCategorizedAsStatus = false;
        Boolean nextStepCategorizedAsCore = false;
        for (RecordContextService.FieldCategory category : ctx.fieldCategories) {
            for (RecordContextService.FieldInfo fieldInfo : category.fields) {
                if (category.name == 'status' && fieldInfo.apiName == 'Probability') {
                    probabilityCategorizedAsStatus = true;
                }
                if (category.name == 'core' && fieldInfo.apiName == 'NextStep') {
                    nextStepCategorizedAsCore = true;
                }
            }
        }
        System.assertEquals(true, probabilityCategorizedAsStatus, 'Probability should be categorized as a status field');
        System.assertEquals(true, nextStepCategorizedAsCore, 'NextStep should be categorized as a core field');

        Set<String> relationshipNames = new Set<String>();
        for (RecordContextService.RelationshipInfo info : ctx.relationships) {
            relationshipNames.add(info.relationshipName);
        }
        System.assertEquals(false, relationshipNames.contains('OpenActivities'));
        System.assertEquals(false, relationshipNames.contains('RelatedClients'));
    }

    @IsTest
    static void testGetAvailableContext_Contact() {
        Contact con = [SELECT Id FROM Contact LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(con.Id);
        Test.stopTest();

        System.assertEquals('Contact', ctx.objectApiName);
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Discovery count metadata should not mark the context incomplete');
    }

    @IsTest
    static void testGetAvailableContextForObject_WithReferenceRecord() {
        Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContextForObject(
            'Opportunity',
            opp.Id
        );
        Test.stopTest();

        System.assertEquals('Opportunity', ctx.objectApiName);
        System.assertEquals('Test Opportunity', ctx.recordName);
        System.assertNotEquals(null, ctx.relationships);
    }

    @IsTest
    static void testGetAvailableContextForObject_WithoutReferenceRecord() {
        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContextForObject(
            'Contact',
            null
        );
        Test.stopTest();

        System.assertEquals('Contact', ctx.objectApiName);
        System.assertEquals('Contact comparison settings', ctx.recordName);
        System.assertNotEquals(null, ctx.fieldCategories);
        System.assertNotEquals(null, ctx.relationships);
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Object-level metadata should not warn without a reference record');
    }

    @IsTest
    static void testGetRecordContext_WithDefaults() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, null, null, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assertEquals('Account', ctx.objectApiName);
        System.assert(!ctx.fields.isEmpty(), 'Should have fields');
        System.assertNotEquals(null, ctx.completeness, 'Completeness metadata should be returned');
        System.assertEquals(true, ctx.completeness.isComplete, 'Default context should be complete');
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Default context should not warn');
    }

    @IsTest
    static void testGetRecordContext_WithCategories() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core', 'financial'}, null, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assert(!ctx.fields.isEmpty());
    }

    @IsTest
    static void testGetRecordContext_Depth2() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 2, new List<String>{'core'}, new List<String>{'Opportunities'}, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
    }

    @IsTest
    static void testGetRecordContext_WithRelationships() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        RecordContextService.AvailableContext avail = RecordContextService.getAvailableContext(acc.Id);
        List<String> relNames = new List<String>();
        for (RecordContextService.RelationshipInfo ri : avail.relationships) {
            relNames.add(ri.relationshipName);
        }

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core'}, relNames, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
    }

    @IsTest
    static void testGetRecordContext_UnsupportedRelationshipsAreIgnored() {
        Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            opp.Id,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'OpenActivities', 'RelatedClients' },
            null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Unsupported relationship noise should be filtered out');
        System.assertEquals(0, ctx.completeness.skippedRelationshipCount, 'Unsupported relationships should be skipped before fetch');
    }

    @IsTest
    static void testGetRelationshipData() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        RecordContextService.AvailableContext avail = RecordContextService.getAvailableContext(acc.Id);
        String relName;
        for (RecordContextService.RelationshipInfo ri : avail.relationships) {
            if (ri.recordCount > 0) {
                relName = ri.relationshipName;
                break;
            }
        }

        if (relName != null) {
            Test.startTest();
            RecordContextService.RelatedRecordSet rrs = RecordContextService.getRelationshipData(
                acc.Id, 'Account', relName, 5
            );
            Test.stopTest();

            System.assertNotEquals(null, rrs);
            System.assert(!rrs.records.isEmpty());
        }
    }

    @IsTest
    static void testGetRecordContext_RespectsMaxRelatedRecords() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'Contacts' },
            1
        );
        Test.stopTest();

        System.assertEquals(1, ctx.relatedRecordSets.size(), 'Selected Contacts relationship should be returned');
        System.assertEquals(
            1,
            ctx.relatedRecordSets[0].records.size(),
            'Top-level related record loading should respect the configured maxRelatedRecords setting'
        );
    }

    @IsTest
    static void testInvalidRecordId() {
        Boolean exceptionThrown = false;
        try {
            RecordContextService.getAvailableContext('invalid');
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for invalid ID');
    }

    @IsTest
    static void testBlankRecordId() {
        Boolean exceptionThrown = false;
        try {
            RecordContextService.getAvailableContext('');
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for blank ID');
    }

    @IsTest
    static void testGetRelationshipData_NotFound() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Boolean exceptionThrown = false;
        try {
            RecordContextService.getRelationshipData(acc.Id, 'Account', 'NonExistentRelationship__r', 5);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for non-existent relationship');
    }

    @IsTest
    static void testGetRecordContext_FieldWarnings() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceFieldSerializationFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core'}, null, null
        );
        Test.stopTest();

        RecordContextService.resetTestHooks();
        System.assertEquals(true, ctx.completeness.hasWarnings, 'Field serialization failure should warn');
        System.assertEquals(1, ctx.completeness.skippedFieldCount, 'One field should be recorded as skipped');
    }

    @IsTest
    static void testGetRecordContext_RelationshipWarnings() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        String relName = 'Contacts';

        RecordContextService.resetTestHooks();
        RecordContextService.forceRelationshipFetchFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core'}, new List<String>{ relName }, null
        );
        Test.stopTest();

        RecordContextService.resetTestHooks();
        System.assertEquals(true, ctx.completeness.hasWarnings, 'Relationship fetch failure should warn');
        System.assertEquals(1, ctx.completeness.skippedRelationshipCount, 'Skipped relationship count should increment');
    }

    @IsTest
    static void testGetRecordContext_DescendantWarnings() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceDescendantFetchFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 2, new List<String>{'core'}, new List<String>{ 'Opportunities' }, null
        );
        Test.stopTest();

        RecordContextService.resetTestHooks();
        System.assertEquals(true, ctx.completeness.hasWarnings, 'Descendant failure should warn');
        System.assert(
            ctx.completeness.skippedDescendantCount > 0,
            'Skipped descendant count should increment when descendant loading fails'
        );
    }

    @IsTest
    static void testGetAvailableContext_TruncationWarnings() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceRelationshipDiscoveryTruncation = true;

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(acc.Id);
        Test.stopTest();

        RecordContextService.resetTestHooks();
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Count-only discovery gaps should not mark the context incomplete');

        Boolean foundUnknownCount = false;
        for (RecordContextService.RelationshipInfo relationshipInfo : ctx.relationships) {
            if (relationshipInfo.countStatus == 'unknown') {
                foundUnknownCount = true;
                break;
            }
        }

        System.assertEquals(true, foundUnknownCount, 'Relationships with unavailable counts should be labeled with countStatus=unknown');
    }
}
