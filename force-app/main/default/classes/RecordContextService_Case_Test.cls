@IsTest
private class RecordContextService_Case_Test {

    @IsTest
    static void testGetAvailableContextForObject_Case() {
        Test.startTest();
        RecordContextService.AvailableContext ctx = RecordContextService.getAvailableContextForObject('Case', null);
        Test.stopTest();

        System.assertEquals('Case', ctx.objectApiName);
        System.assertEquals('Case comparison settings', ctx.recordName);
    }
}
