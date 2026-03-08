@IsTest(SeeAllData=true)
private class RecordContextService_Case_Test {

    @IsTest
    static void testGetAvailableContext_Case() {
        List<Case> cases = [SELECT Id FROM Case LIMIT 1];
        System.assert(
            !cases.isEmpty(),
            'Expected at least one Case in the org because automation-heavy orgs can block Case inserts in tests.'
        );

        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContext(cases[0].Id);
        Test.stopTest();

        System.assertEquals('Case', ctx.objectApiName);
    }
}
