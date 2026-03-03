@IsTest
private class RecordAdvisorController_Test {

    @IsTest
    static void testGetAvailableModels() {
        Test.startTest();
        List<RecordAdvisorController.ModelInfo> models = RecordAdvisorController.getAvailableModels();
        Test.stopTest();

        System.assert(!models.isEmpty(), 'Should return available models');
        Boolean hasDefault = false;
        for (RecordAdvisorController.ModelInfo m : models) {
            if (m.isDefault) hasDefault = true;
        }
        System.assert(hasDefault, 'Should have a default model');
    }

    @IsTest
    static void testSendMessage_BlankMessage() {
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendMessage('{}', '', null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for blank message');
    }

    @IsTest
    static void testSendMessage_TooLong() {
        String longMsg = 'x'.repeat(50001);
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendMessage('{}', longMsg, null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for message exceeding max length');
    }

    @IsTest
    static void testSendMessage_HistoryTooLong() {
        String longHistory = 'x'.repeat(2000001);
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendMessage('{}', 'test', longHistory, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for history exceeding max length');
    }

    @IsTest
    static void testSendCompareMessage_BlankMessage() {
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendCompareMessage('{}', '', null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for blank compare message');
    }

    @IsTest
    static void testSendCompareMessage_HistoryTooLong() {
        String longHistory = 'x'.repeat(2000001);
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendCompareMessage('{}', 'test', longHistory, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for compare history exceeding max length');
    }

    @IsTest
    static void testSendMessage_ContextTooLong() {
        String longContext = 'x'.repeat(300001);
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendMessage(longContext, 'test', null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for record context exceeding max length');
    }

    @IsTest
    static void testSendCompareMessage_ContextTooLong() {
        String longContext = 'x'.repeat(300001);
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.sendCompareMessage(longContext, 'test', null, null);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Should throw for comparison context exceeding max length');
    }

    @IsTest
    static void testChatResponseWrapper() {
        RecordAdvisorController.ChatResponse resp = new RecordAdvisorController.ChatResponse();
        resp.success = true;
        resp.response = 'Test response';
        resp.error = null;

        System.assertEquals(true, resp.success);
        System.assertEquals('Test response', resp.response);
        System.assertEquals(null, resp.error);
    }

    @IsTest
    static void testModelInfoWrapper() {
        RecordAdvisorController.ModelInfo info = new RecordAdvisorController.ModelInfo(
            'test_model', 'Test Model', 'TestProvider', false, 'standard'
        );

        System.assertEquals('test_model', info.apiName);
        System.assertEquals('Test Model', info.label);
        System.assertEquals('TestProvider', info.provider);
        System.assertEquals(false, info.isDefault);
        System.assertEquals('standard', info.creditType);
    }
}
