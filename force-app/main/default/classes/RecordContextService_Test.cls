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
        Contact blankContact = new Contact(
            FirstName = 'Blank',
            LastName = 'Contact',
            AccountId = testAccount.Id
        );
        insert new List<Contact>{ testContact, secondContact, blankContact };

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
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

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
        Opportunity opp = [SELECT Id FROM Opportunity WITH SYSTEM_MODE LIMIT 1];

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
        Contact con = [SELECT Id FROM Contact WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(con.Id);
        Test.stopTest();

        System.assertEquals('Contact', ctx.objectApiName);
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Discovery count metadata should not mark the context incomplete');
    }

    @IsTest
    static void testGetAvailableContextForObject_WithReferenceRecord() {
        Opportunity opp = [SELECT Id FROM Opportunity WITH SYSTEM_MODE LIMIT 1];

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
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, null, null, null, null, false, null, null
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
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core', 'financial'}, null, null, null, false, null, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assert(!ctx.fields.isEmpty());
    }

    @IsTest
    static void testGetRecordContext_Depth2() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 2, new List<String>{'core'}, new List<String>{'Opportunities'}, null, null, false, null, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
    }

    @IsTest
    static void testGetRecordContext_WithRelationships() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        RecordContextService.AvailableContext avail = RecordContextService.getAvailableContext(acc.Id);
        List<String> relNames = new List<String>();
        for (RecordContextService.RelationshipInfo ri : avail.relationships) {
            relNames.add(ri.relationshipName);
        }

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core'}, relNames, null, null, false, null, null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
    }

    @IsTest
    static void testGetRecordContext_UnsupportedRelationshipsAreIgnored() {
        Opportunity opp = [SELECT Id FROM Opportunity WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            opp.Id,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'OpenActivities', 'RelatedClients' },
            null,
            null,
            false,
            null,
            null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx);
        System.assertEquals(false, ctx.completeness.hasWarnings, 'Unsupported relationship noise should be filtered out');
        System.assertEquals(0, ctx.completeness.skippedRelationshipCount, 'Unsupported relationships should be skipped before fetch');
    }

    @IsTest
    static void testGetRelationshipData() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

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
    static void testGetAvailableContext_DeletedRecordThrows() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];
        delete acc;

        Boolean threw = false;
        try {
            Test.startTest();
            RecordContextService.getAvailableContext(acc.Id);
            Test.stopTest();
        } catch (AuraHandledException e) {
            threw = true;
            Test.stopTest();
        }

        System.assertEquals(true, threw, 'Unavailable anchor records should fail closed.');
    }

    @IsTest
    static void testGetAvailableContextForObject_DeletedReferenceRecordThrows() {
        Opportunity opp = [SELECT Id FROM Opportunity WITH SYSTEM_MODE LIMIT 1];
        delete opp;

        Boolean threw = false;
        try {
            Test.startTest();
            RecordContextService.getAvailableContextForObject('Opportunity', opp.Id);
            Test.stopTest();
        } catch (AuraHandledException e) {
            threw = true;
            Test.stopTest();
        }

        System.assertEquals(true, threw, 'Reference-record metadata discovery should fail closed.');
    }

    @IsTest
    static void testGetRelationshipData_DeletedAnchorThrows() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];
        delete acc;

        Boolean threw = false;
        try {
            Test.startTest();
            RecordContextService.getRelationshipData(acc.Id, 'Account', 'Contacts', 5);
            Test.stopTest();
        } catch (AuraHandledException e) {
            threw = true;
            Test.stopTest();
        }

        System.assertEquals(true, threw, 'Relationship fetch should require a readable anchor record.');
    }

    @IsTest
    static void testGetRecordContext_RespectsMaxRelatedRecords() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'Contacts' },
            1,
            null,
            false,
            null,
            null
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
    static void testGetRecordContext_RelatedRecordsIncludeExplicitNullValues() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'core' },
            new List<String>{ 'Contacts' },
            5,
            null,
            false,
            null,
            null
        );
        Test.stopTest();

        Map<String, Object> blankContact;
        for (Map<String, Object> contactRecord : ctx.relatedRecordSets[0].records) {
            Map<String, Object> lastNameField = (Map<String, Object>) contactRecord.get('LastName');
            if (lastNameField != null && String.valueOf(lastNameField.get('value')) == 'Contact') {
                Map<String, Object> firstNameField = (Map<String, Object>) contactRecord.get('FirstName');
                if (firstNameField != null && String.valueOf(firstNameField.get('value')) == 'Blank') {
                    blankContact = contactRecord;
                    break;
                }
            }
        }

        System.assertNotEquals(null, blankContact, 'Expected the blank contact to be included in related records');
        System.assert(blankContact.containsKey('Email'), 'Null related-record fields should still be serialized');
        System.assertEquals(
            null,
            ((Map<String, Object>) blankContact.get('Email')).get('value'),
            'Blank related-record fields should be represented as explicit null values'
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
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Boolean exceptionThrown = false;
        try {
            RecordContextService.getRelationshipData(acc.Id, 'Account', 'NonExistentRelationship__r', 5);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for non-existent relationship');
    }

    @IsTest
    static void testGetRelationshipData_QueryFailureReturnsHandledError() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceRelationshipFetchFailure = true;

        Boolean exceptionThrown = false;
        try {
            RecordContextService.getRelationshipData(acc.Id, 'Account', 'Contacts', 5);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }

        RecordContextService.resetTestHooks();
        System.assertEquals(true, exceptionThrown, 'Relationship load failures should return a handled exception');
    }

    @IsTest
    static void testGetRecordContext_FieldWarnings() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceFieldSerializationFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core'}, null, null, null, false, null, null
        );
        Test.stopTest();

        RecordContextService.resetTestHooks();
        System.assertEquals(true, ctx.completeness.hasWarnings, 'Field serialization failure should warn');
        System.assertEquals(1, ctx.completeness.skippedFieldCount, 'One field should be recorded as skipped');
    }

    @IsTest
    static void testGetRecordContext_RelationshipWarnings() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];
        String relName = 'Contacts';

        RecordContextService.resetTestHooks();
        RecordContextService.forceRelationshipFetchFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 1, new List<String>{'core'}, new List<String>{ relName }, null, null, false, null, null
        );
        Test.stopTest();

        RecordContextService.resetTestHooks();
        System.assertEquals(true, ctx.completeness.hasWarnings, 'Relationship fetch failure should warn');
        System.assertEquals(1, ctx.completeness.skippedRelationshipCount, 'Skipped relationship count should increment');
    }

    @IsTest
    static void testGetRecordContext_DescendantWarnings() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceDescendantFetchFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id, 2, new List<String>{'core'}, new List<String>{ 'Opportunities' }, null, null, false, null, null
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
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

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

    @IsTest
    static void testAvailableContext_IncludesParentReferences() {
        Contact con = [SELECT Id FROM Contact WHERE FirstName = 'Test' WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(con.Id);
        Test.stopTest();

        System.assertNotEquals(null, ctx.parentReferences, 'parentReferences should be present on AvailableContext');
        Boolean foundAccount = false;
        for (RecordContextService.ParentReferenceInfo p : ctx.parentReferences) {
            if (p.referenceFieldApiName == 'AccountId') {
                foundAccount = true;
                System.assertEquals('Account', p.parentObjectApiName, 'AccountId should resolve to Account parent');
                System.assertNotEquals(null, p.parentRecordId, 'AccountId should have the active record FK populated');
            }
        }
        System.assertEquals(true, foundAccount, 'Contact parent references should include AccountId');
    }

    @IsTest
    static void testAvailableContextForObject_DescribesParentReferencesWithoutRecord() {
        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContextForObject('Contact', null);
        Test.stopTest();

        System.assertNotEquals(null, ctx.parentReferences, 'describeParentReferences should return entries even without a record');
        Boolean foundAccount = false;
        for (RecordContextService.ParentReferenceInfo p : ctx.parentReferences) {
            if (p.referenceFieldApiName == 'AccountId') {
                foundAccount = true;
                System.assertEquals(null, p.parentRecordId, 'Without a record id, parentRecordId should not be set');
            }
        }
        System.assertEquals(true, foundAccount, 'AccountId should surface in object-level parent reference describe');
    }

    @IsTest
    static void testGetParentChildRelationships_ReturnsSupportedChildren() {
        Test.startTest();
        List<RecordContextService.ParentChildRelationshipInfo> rels =
            RecordContextService.getParentChildRelationships('Account');
        Test.stopTest();

        System.assertNotEquals(null, rels, 'Parent-child relationships should not be null');
        Boolean foundContacts = false;
        Boolean foundOpportunities = false;
        for (RecordContextService.ParentChildRelationshipInfo info : rels) {
            if (info.relationshipName == 'Contacts') foundContacts = true;
            if (info.relationshipName == 'Opportunities') foundOpportunities = true;
        }
        System.assertEquals(true, foundContacts, 'Account should expose Contacts child relationship');
        System.assertEquals(true, foundOpportunities, 'Account should expose Opportunities child relationship');
    }

    @IsTest
    static void testGetParentChildRelationships_InvalidObjectThrows() {
        Boolean threw = false;
        try {
            RecordContextService.getParentChildRelationships('NotARealObject__c');
        } catch (AuraHandledException e) {
            threw = true;
        }
        System.assertEquals(true, threw, 'Invalid object type should throw AuraHandledException');
    }

    @IsTest
    static void testGetRecordContext_LoadsParentRecords() {
        Contact con = [SELECT Id, AccountId FROM Contact WHERE FirstName = 'Test' WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            con.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            new List<String>{ 'AccountId' },
            false,
            null,
            null
        );
        Test.stopTest();

        System.assertNotEquals(null, ctx.parentRecordContexts, 'Parent record contexts should not be null when a parent reference is selected');
        System.assertEquals(1, ctx.parentRecordContexts.size(), 'One parent record context should be returned for AccountId');
        RecordContextService.ParentRecordContext prc = ctx.parentRecordContexts[0];
        System.assertEquals('AccountId', prc.referenceFieldApiName);
        System.assertEquals('Account', prc.parentObjectApiName);
        System.assertEquals(con.AccountId, prc.parentRecordId);
        System.assert(prc.fields != null && !prc.fields.isEmpty(), 'Parent record fields should be populated');
    }

    @IsTest
    static void testGetRecordContext_LoadsSameObjectSiblingsThroughParent() {
        Contact con = [SELECT Id, AccountId FROM Contact WHERE FirstName = 'Test' WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            con.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            new List<String>{ 'AccountId' },
            true,
            null,
            null
        );
        Test.stopTest();

        System.assertEquals(1, ctx.parentRecordContexts.size());
        RecordContextService.ParentRecordContext prc = ctx.parentRecordContexts[0];
        System.assertNotEquals(null, prc.sameObjectSiblings, 'Sibling records should be populated when siblings requested');
        System.assert(prc.sameObjectSiblings.size() >= 1, 'At least one sibling Contact should be returned (excluding active record)');
        for (Map<String, Object> rec : prc.sameObjectSiblings) {
            Map<String, Object> idField = (Map<String, Object>) rec.get('Id');
            System.assertNotEquals(null, idField, 'Sibling payloads should include wrapped Id metadata');
            System.assertNotEquals(
                con.Id,
                String.valueOf(idField.get('value')),
                'Active record should be excluded from sibling results'
            );
        }
    }

    @IsTest
    static void testGetRecordContext_ParentChildRelationshipExpansion() {
        Contact con = [SELECT Id, AccountId FROM Contact WHERE FirstName = 'Test' WITH SYSTEM_MODE LIMIT 1];

        Map<String, String> parentChildMap = new Map<String, String>{ 'AccountId' => 'Opportunities' };

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            con.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            new List<String>{ 'AccountId' },
            false,
            parentChildMap,
            null
        );
        Test.stopTest();

        System.assertEquals(1, ctx.parentRecordContexts.size());
        RecordContextService.ParentRecordContext prc = ctx.parentRecordContexts[0];
        System.assertNotEquals(null, prc.selectedChildRelationship, 'Parent child relationship expansion should be populated');
        System.assertEquals('Opportunities', prc.selectedChildRelationship.relationshipName);
        System.assert(!prc.selectedChildRelationship.records.isEmpty(), 'Opportunities child expansion should return records');
    }

    @IsTest
    static void testGetRecordContext_PolymorphicLookupsAreSkippedWithWarning() {
        Task tsk = new Task(Subject = 'Test Task', Status = 'Not Started', Priority = 'Normal');
        insert tsk;

        Test.startTest();
        RecordContextService.AvailableContext avail = RecordContextService.getAvailableContext(tsk.Id);
        Test.stopTest();

        Boolean hasPolymorphicWhatId = false;
        for (RecordContextService.ParentReferenceInfo p : avail.parentReferences) {
            if (p.referenceFieldApiName == 'WhatId' || p.referenceFieldApiName == 'WhoId') {
                hasPolymorphicWhatId = true;
            }
        }
        System.assertEquals(false, hasPolymorphicWhatId, 'Polymorphic lookups (WhatId/WhoId) should be skipped from parent references');

        Boolean warned = false;
        if (avail.completeness != null && avail.completeness.warningMessages != null) {
            for (String w : avail.completeness.warningMessages) {
                if (w != null && w.toLowerCase().contains('polymorphic')) {
                    warned = true;
                    break;
                }
            }
        }
        System.assertEquals(true, warned, 'A warning should note that polymorphic lookup fields were skipped');
    }

    @IsTest
    static void testGetRecordContext_ParentFetchFailureAddsWarning() {
        Contact con = [SELECT Id FROM Contact WHERE FirstName = 'Test' WITH SYSTEM_MODE LIMIT 1];

        RecordContextService.resetTestHooks();
        RecordContextService.forceParentFetchFailure = true;

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            con.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            new List<String>{ 'AccountId' },
            false,
            null,
            null
        );
        Test.stopTest();
        RecordContextService.resetTestHooks();

        System.assertEquals(true, ctx.completeness.hasWarnings, 'Parent fetch failure should produce a warning');
    }

    // ------------------------------------------------------------------
    // Per-field override (includedFields)
    // ------------------------------------------------------------------

    @IsTest
    static void testGetAccessibleFieldsForObject_ReturnsAccessibleFieldsOnly() {
        Test.startTest();
        List<RecordContextService.FieldInfo> fields = RecordContextService.getAccessibleFieldsForObject('Account');
        Test.stopTest();

        System.assertNotEquals(null, fields, 'Accessible field list should not be null');
        System.assert(!fields.isEmpty(), 'Account should have accessible fields');

        Set<String> apiNames = new Set<String>();
        for (RecordContextService.FieldInfo fi : fields) {
            System.assertNotEquals(null, fi.apiName, 'FieldInfo should have apiName');
            System.assertNotEquals(null, fi.label, 'FieldInfo should have label');
            apiNames.add(fi.apiName.toLowerCase());
        }
        System.assert(apiNames.contains('name'), 'Account Name should be exposed as an accessible field');
    }

    @IsTest
    static void testGetAccessibleFieldsForObject_InvalidObjectThrows() {
        Boolean threw = false;
        try {
            RecordContextService.getAccessibleFieldsForObject('TotallyNotAnObject__c');
        } catch (AuraHandledException e) {
            threw = true;
        }
        System.assertEquals(true, threw, 'Unknown object type should throw an AuraHandledException');
    }

    @IsTest
    static void testGetAccessibleFieldsForObject_BlankThrows() {
        Boolean threw = false;
        try {
            RecordContextService.getAccessibleFieldsForObject('');
        } catch (AuraHandledException e) {
            threw = true;
        }
        System.assertEquals(true, threw, 'Blank object name should throw');
    }

    @IsTest
    static void testGetRecordContext_IncludedFields_HappyPath() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            null,
            false,
            null,
            new List<String>{ 'Name' }
        );
        Test.stopTest();

        System.assert(ctx.fields.containsKey('Id'), 'Id is always queried');
        System.assert(
            ctx.fields.containsKey('Name'),
            'Explicitly requested Name field should be present'
        );
    }

    @IsTest
    static void testGetRecordContext_IncludedFields_EmptyFallsBackToCategoryBehavior() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            null,
            false,
            null,
            new List<String>()
        );
        Test.stopTest();

        System.assert(
            ctx.fields.size() > 1,
            'Empty includedFields list should fall back to full category behavior'
        );
    }

    @IsTest
    static void testGetRecordContext_IncludedFields_OutsideCategoryDroppedWithWarning() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'dates' },
            null,
            null,
            null,
            false,
            null,
            new List<String>{ 'Industry' }
        );
        Test.stopTest();

        System.assertEquals(
            false,
            ctx.fields.containsKey('Industry'),
            'Industry is not in the dates category and must be dropped'
        );
        System.assertEquals(true, ctx.completeness.hasWarnings, 'Dropped override fields should warn');
    }

    @IsTest
    static void testGetRecordContext_IncludedFields_NonexistentDroppedWithWarning() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            null,
            null,
            null,
            null,
            false,
            null,
            new List<String>{ 'NotARealField__c', 'Name' }
        );
        Test.stopTest();

        System.assertEquals(
            false,
            ctx.fields.containsKey('NotARealField__c'),
            'Nonexistent field must never appear in the serialized payload'
        );
        System.assertEquals(
            true,
            ctx.fields.containsKey('Name'),
            'Valid override fields continue to resolve alongside skipped ones'
        );
        System.assertEquals(
            true,
            ctx.completeness.hasWarnings,
            'Dropped nonexistent override fields should warn'
        );
    }

    @IsTest
    static void testGetRecordContext_IncludedFields_IdAndNamePreserved() {
        Account acc = [SELECT Id FROM Account WITH SYSTEM_MODE LIMIT 1];

        Test.startTest();
        RecordContextService.RecordContext ctx = RecordContextService.getRecordContext(
            acc.Id,
            1,
            new List<String>{ 'core' },
            null,
            null,
            null,
            false,
            null,
            new List<String>{ 'Industry' }
        );
        Test.stopTest();

        System.assert(ctx.fields.containsKey('Id'), 'Id should always be preserved in the payload');
        System.assertNotEquals(
            null,
            ctx.recordName,
            'Record name should be resolved even when override excludes Name explicitly'
        );
    }
}
