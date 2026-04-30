@IsTest
private class RecordAdvisorController_Test {

    @IsTest
    static void testGetAvailableModels() {
        Test.startTest();
        List<RecordAdvisorController.ModelInfo> models = RecordAdvisorController.getAvailableModels(null);
        Test.stopTest();

        System.assert(!models.isEmpty(), 'Should return available models');
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

    @IsTest
    static void testBuildCoreGuidelines_IncludeExplicitDateAndMissingDataRules() {
        String guidelines = RecordAdvisorController.buildCoreGuidelines();

        System.assert(guidelines.contains('Today\'s date: ' + Datetime.now().format('yyyy-MM-dd')));
        System.assert(guidelines.contains('not provided in the current context selection'));
        System.assert(guidelines.contains('blank on the record'));
    }

    @IsTest
    static void testBuildCompareSystemPrompt_IncludesSelectionSummaryAndPrioritizationGuidance() {
        String prompt = RecordAdvisorController.buildCompareSystemPrompt('{"selectionSummary":{},"comparisonContext":{}}');

        System.assert(prompt.contains('selectionSummary'));
        System.assert(prompt.contains('active or open records over closed or completed ones'));
        System.assert(prompt.contains('Use markdown tables only for compact scalar field comparisons.'));
    }

    @IsTest
    static void testBuildInsightsSystemPrompt_IncludesNoDataFallbackAndGuidance() {
        String prompt = RecordAdvisorController.buildInsightsSystemPrompt(null);

        System.assert(prompt.contains('No record data provided.'));
        System.assert(prompt.contains('selectionSummary'));
        System.assert(prompt.contains('If completeness metadata indicates warnings'));
    }

    @IsTest
    static void testBuildModelFallbackChain_DeduplicatesAndKeepsPrimaryFirst() {
        List<String> fallbackChain = RecordAdvisorController.buildModelFallbackChain('sfdc_ai__DefaultGPT5');
        Integer primaryCount = 0;
        for (String modelName : fallbackChain) {
            if (modelName == 'sfdc_ai__DefaultGPT5') {
                primaryCount++;
            }
        }

        System.assertEquals('sfdc_ai__DefaultGPT5', fallbackChain[0]);
        System.assertEquals(1, primaryCount, 'The primary model should only appear once in the fallback chain');
        System.assert(fallbackChain.contains('sfdc_ai__DefaultGPT4Omni'));
    }

    @IsTest
    static void testBuildModelFallbackChain_BlankPrimaryStartsWithDefault() {
        List<String> fallbackChain = RecordAdvisorController.buildModelFallbackChain(null);

        System.assert(!fallbackChain.isEmpty(), 'Fallback chain should not be empty');
        System.assertEquals('sfdc_ai__DefaultVertexAIGeminiPro31', fallbackChain[0]);
        System.assert(!fallbackChain.contains(null), 'Fallback chain should not include null values');
    }

    @IsTest
    static void testGetAvailableModels_DoesNotUseCmdtDefaultFlag() {
        List<RecordAdvisorController.ModelInfo> models = RecordAdvisorController.getAvailableModels('Default');
        Integer defaultCount = 0;

        for (RecordAdvisorController.ModelInfo model : models) {
            if (model.isDefault) {
                defaultCount++;
            }
        }

        System.assert(!models.isEmpty(), 'Subscriber configuration or fallback catalog should provide available models');
        System.assertEquals(0, defaultCount, 'Configured model metadata should not advertise a default model');
    }

    @IsTest
    static void testBuildConfiguredModelInfos_FiltersNormalizesAndDeduplicates() {
        List<RecordAdvisorController.ModelInfo> models = RecordAdvisorController.buildConfiguredModelInfos(new List<Record_Insights_Model_Alias__mdt>{
            new Record_Insights_Model_Alias__mdt(
                MasterLabel = 'Configured Primary',
                Model_API_Name__c = ' configured_primary ',
                Display_Label__c = ' Configured Primary ',
                Provider__c = ' Test Provider ',
                Credit_Type__c = 'ADVANCED',
                Enabled__c = true,
                Model_Set__c = 'Custom'
            ),
            new Record_Insights_Model_Alias__mdt(
                MasterLabel = 'Duplicate Primary',
                Model_API_Name__c = 'configured_primary',
                Display_Label__c = 'Duplicate Primary',
                Provider__c = 'Test Provider',
                Credit_Type__c = 'basic',
                Enabled__c = true,
                Model_Set__c = 'Custom'
            ),
            new Record_Insights_Model_Alias__mdt(
                MasterLabel = 'Other Set',
                Model_API_Name__c = 'other_set_model',
                Enabled__c = true,
                Model_Set__c = 'Other'
            ),
            new Record_Insights_Model_Alias__mdt(
                MasterLabel = 'Disabled',
                Model_API_Name__c = 'disabled_model',
                Enabled__c = false,
                Model_Set__c = 'Custom'
            )
        }, ' Custom ');

        System.assertEquals(1, models.size(), 'Only one active unique model from the selected model set should remain');
        System.assertEquals('configured_primary', models[0].apiName);
        System.assertEquals('Configured Primary', models[0].label);
        System.assertEquals('Test Provider', models[0].provider);
        System.assertEquals('advanced', models[0].creditType);
        System.assertEquals(false, models[0].isDefault);
    }

    @IsTest
    static void testBuildConfiguredModelInfos_DoesNotSetMetadataDefault() {
        List<RecordAdvisorController.ModelInfo> models = RecordAdvisorController.buildConfiguredModelInfos(new List<Record_Insights_Model_Alias__mdt>{
            new Record_Insights_Model_Alias__mdt(
                MasterLabel = 'Bad Tier',
                Model_API_Name__c = 'bad_tier_model',
                Display_Label__c = 'Bad Tier',
                Provider__c = '',
                Credit_Type__c = 'premium',
                Enabled__c = true,
                Model_Set__c = ''
            ),
            new Record_Insights_Model_Alias__mdt(
                MasterLabel = 'Second Model',
                Model_API_Name__c = 'second_model',
                Display_Label__c = 'Second Model',
                Credit_Type__c = 'basic',
                Enabled__c = true,
                Model_Set__c = 'Default'
            )
        }, null);

        System.assertEquals(2, models.size());
        System.assertEquals(false, models[0].isDefault, 'Model defaults are controlled by Lightning App Builder, not custom metadata');
        System.assertEquals('Configured', models[0].provider, 'Blank providers should use a stable fallback label');
        System.assertEquals('standard', models[0].creditType, 'Unsupported tiers should normalize to standard');
        System.assertEquals(false, models[1].isDefault);
    }

    @IsTest
    static void testModelSetPicklist_ReturnsDefaultValueAndAcceptsValues() {
        RecordInsightsModelSetPicklist picklist = new RecordInsightsModelSetPicklist();

        System.assertNotEquals(null, picklist.getDefaultValue());
        System.assertNotEquals(null, picklist.getValues(), 'Configured model sets should be available to Lightning App Builder');
        System.assertEquals(true, picklist.isValid('Any Subscriber Set'));
        System.assertEquals('Any Subscriber Set', picklist.getLabel('Any Subscriber Set'));
    }

    @IsTest
    static void testAddHistoryMessages_FiltersRolesAndTruncatesLongMessages() {
        String longAssistantMessage = 'a'.repeat(9000);
        String historyJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{ 'role' => 'USER', 'message' => 'First prompt' },
            new Map<String, Object>{ 'role' => 'assistant', 'message' => longAssistantMessage },
            new Map<String, Object>{ 'role' => 'system', 'message' => 'Skip this' },
            new Map<String, Object>{ 'role' => 'user', 'message' => '' }
        });
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>();

        RecordAdvisorController.addHistoryMessages(messages, historyJson);

        System.assertEquals(2, messages.size(), 'Only user and assistant history should be preserved');
        System.assertEquals('user', messages[0].role);
        System.assertEquals('First prompt', messages[0].content);
        System.assertEquals('assistant', messages[1].role);
        System.assertEquals(8000, messages[1].content.length(), 'Long history entries should be truncated');
    }

    @IsTest
    static void testAddHistoryMessages_IgnoresMalformedJson() {
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>();

        RecordAdvisorController.addHistoryMessages(messages, 'not-json');

        System.assertEquals(0, messages.size(), 'Malformed history should be ignored instead of throwing');
    }

    @IsTest
    static void testValidateContextLength_AllowsBoundaryAndThrowsAboveLimit() {
        RecordAdvisorController.validateContextLength('x'.repeat(300000), 'Boundary should be allowed');

        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.validateContextLength('x'.repeat(300001), 'Context too large');
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assertEquals(true, exceptionThrown, 'Expected a size validation exception above the max length');
    }

    @IsTest
    static void testThrowUnavailableModelsException_UsesConfiguredFailureMessage() {
        Boolean exceptionThrown = false;
        try {
            RecordAdvisorController.throwUnavailableModelsException('sfdc_ai__DefaultGPT5', 503, true);
        } catch (AuraHandledException e) {
            exceptionThrown = true;
        }
        System.assertEquals(true, exceptionThrown, 'Expected an unavailable model exception when configured model failures are present');
    }

    @IsTest
    static void testThrowUnavailableModelsException_UsesGenericFailureMessage() {
        try {
            RecordAdvisorController.throwUnavailableModelsException(null, null, false);
            System.assert(false, 'Expected a generic failure exception');
        } catch (AuraHandledException e) {
            System.assertEquals('Script-thrown exception', e.getMessage());
        }
    }
}
