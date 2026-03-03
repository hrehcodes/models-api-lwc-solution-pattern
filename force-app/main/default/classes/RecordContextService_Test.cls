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
        insert testContact;

        Opportunity testOpp = new Opportunity(
            Name = 'Test Opportunity',
            StageName = 'Prospecting',
            CloseDate = Date.today().addDays(30),
            Amount = 50000,
            AccountId = testAccount.Id
        );
        insert testOpp;

        Case testCase = new Case(
            Subject = 'Test Case',
            Status = 'New',
            Priority = 'Medium',
            AccountId = testAccount.Id,
            ContactId = testContact.Id
        );
        insert testCase;
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
    }

    @IsTest
    static void testGetAvailableContext_Contact() {
        Contact con = [SELECT Id FROM Contact LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(con.Id);
        Test.stopTest();

        System.assertEquals('Contact', ctx.objectApiName);
    }

    @IsTest
    static void testGetAvailableContext_Case() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(c.Id);
        Test.stopTest();

        System.assertEquals('Case', ctx.objectApiName);
    }

    @IsTest
    static void testGetRecordContext_WithDefaults() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, null, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assertEquals('Account', ctx.objectApiName);
        System.assert(!ctx.fields.isEmpty(), 'Should have fields');
    }

    @IsTest
    static void testGetRecordContext_WithCategories() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core', 'financial'}, null
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
            acc.Id, 2, new List<String>{'core'}, new List<String>{'Opportunities'}
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
            acc.Id, 1, new List<String>{'core'}, relNames
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
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
}
