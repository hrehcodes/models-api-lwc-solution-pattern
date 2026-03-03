/**
 * Controller for Agentforce Record Insights chat functionality.
 * Standalone -- no dependency on custom objects or research sessions.
 * Calls the Salesforce Models API with record context as the knowledge base.
 *
 * Security: with sharing, input validation, length limits.
 */
public with sharing class RecordAdvisorController {

    private static final Integer MAX_PROMPT_LENGTH = 50000;
    private static final Integer MAX_CONTEXT_LENGTH = 300000;
    private static final Integer MAX_HISTORY_LENGTH = 2000000;
    private static final Integer MAX_HISTORY_MESSAGES = 60;
    private static final Integer MAX_HISTORY_MESSAGE_LENGTH = 8000;
    private static final String DEFAULT_MODEL = 'sfdc_ai__DefaultVertexAIGeminiPro30';
    private static final Set<String> ALLOWED_HISTORY_ROLES = new Set<String>{ 'user', 'assistant' };

    // ── Wrapper Classes ──

    public class ChatResponse {
        @AuraEnabled public String response { get; set; }
        @AuraEnabled public Boolean success { get; set; }
        @AuraEnabled public String error { get; set; }
    }

    public class ModelInfo {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String provider { get; set; }
        @AuraEnabled public Boolean isDefault { get; set; }
        @AuraEnabled public String creditType { get; set; } // 'basic' or 'standard'

        public ModelInfo(String apiName, String label, String provider, Boolean isDefault, String creditType) {
            this.apiName = apiName;
            this.label = label;
            this.provider = provider;
            this.isDefault = isDefault;
            this.creditType = creditType;
        }
    }

    // ── Public Methods ──

    /**
     * Sends a user message to the Models API with record context.
     * Fully stateless: context and history are passed in each call.
     */
    @AuraEnabled
    public static ChatResponse sendMessage(
        String recordContextJson,
        String userMessage,
        String conversationHistoryJson,
        String modelApiName
    ) {
        if (String.isBlank(userMessage)) {
            throw new AuraHandledException('Message is required.');
        }
        if (userMessage.length() > MAX_PROMPT_LENGTH) {
            throw new AuraHandledException('Message exceeds maximum length.');
        }
        if (String.isNotBlank(conversationHistoryJson) && conversationHistoryJson.length() > MAX_HISTORY_LENGTH) {
            throw new AuraHandledException('Conversation history exceeds maximum length.');
        }
        validateContextLength(recordContextJson, 'Record context exceeds maximum length.');

        ChatResponse result = new ChatResponse();
        result.success = false;

        try {
            String systemPrompt = buildInsightsSystemPrompt(recordContextJson);

            List<aiplatform.ModelsAPI_ChatMessageRequest> messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>();

            // System message
            aiplatform.ModelsAPI_ChatMessageRequest sysMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            sysMsg.role = 'system';
            sysMsg.content = systemPrompt;
            messages.add(sysMsg);

            // Conversation history
            if (String.isNotBlank(conversationHistoryJson)) {
                addHistoryMessages(messages, conversationHistoryJson);
            }

            // Current user message
            aiplatform.ModelsAPI_ChatMessageRequest userMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            userMsg.role = 'user';
            userMsg.content = userMessage;
            messages.add(userMsg);

            String selectedModel = String.isNotBlank(modelApiName) ? modelApiName : DEFAULT_MODEL;
            result.response = callModelsAPI(messages, selectedModel);
            result.success = true;

        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Unexpected error in sendMessage: ' + e.getMessage());
            result.error = 'Unexpected error generating response. Please try again.';
        }

        return result;
    }

    /**
     * Sends a comparison request to the Models API.
     */
    @AuraEnabled
    public static ChatResponse sendCompareMessage(
        String comparisonContextJson,
        String userMessage,
        String conversationHistoryJson,
        String modelApiName
    ) {
        if (String.isBlank(userMessage)) {
            throw new AuraHandledException('Message is required.');
        }
        if (userMessage.length() > MAX_PROMPT_LENGTH) {
            throw new AuraHandledException('Message exceeds maximum length.');
        }
        if (String.isNotBlank(conversationHistoryJson) && conversationHistoryJson.length() > MAX_HISTORY_LENGTH) {
            throw new AuraHandledException('Conversation history exceeds maximum length.');
        }
        validateContextLength(comparisonContextJson, 'Comparison context exceeds maximum length.');

        ChatResponse result = new ChatResponse();
        result.success = false;

        try {
            String systemPrompt = buildCompareSystemPrompt(comparisonContextJson);

            List<aiplatform.ModelsAPI_ChatMessageRequest> messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>();

            aiplatform.ModelsAPI_ChatMessageRequest sysMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            sysMsg.role = 'system';
            sysMsg.content = systemPrompt;
            messages.add(sysMsg);

            if (String.isNotBlank(conversationHistoryJson)) {
                addHistoryMessages(messages, conversationHistoryJson);
            }

            aiplatform.ModelsAPI_ChatMessageRequest userMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            userMsg.role = 'user';
            userMsg.content = userMessage;
            messages.add(userMsg);

            String selectedModel = String.isNotBlank(modelApiName) ? modelApiName : DEFAULT_MODEL;
            result.response = callModelsAPI(messages, selectedModel);
            result.success = true;

        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Unexpected error in sendCompareMessage: ' + e.getMessage());
            result.error = 'Unexpected error generating comparison response. Please try again.';
        }

        return result;
    }

    /**
     * Generates contextual follow-up prompt suggestions.
     */
    @AuraEnabled
    public static ChatResponse generateFollowUpPrompts(
        String recordContextJson,
        String recentConversationJson
    ) {
        ChatResponse result = new ChatResponse();
        result.success = false;

        try {
            String prompt = 'Based on the Salesforce record context and recent conversation below, '
                + 'generate exactly 3 concise follow-up questions the user might want to ask. '
                + 'Questions must be answerable from the provided record data. '
                + 'Return exactly 3 questions, one per line, without numbering or bullets.\n\n'
                + 'Record Context:\n' + (String.isNotBlank(recordContextJson) ? recordContextJson.abbreviate(3000) : 'None') + '\n\n'
                + 'Recent Conversation:\n' + (String.isNotBlank(recentConversationJson) ? recentConversationJson.abbreviate(2000) : 'None');

            List<aiplatform.ModelsAPI_ChatMessageRequest> messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>();
            aiplatform.ModelsAPI_ChatMessageRequest userMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            userMsg.role = 'user';
            userMsg.content = prompt;
            messages.add(userMsg);

            String response = callModelsAPI(messages, 'sfdc_ai__DefaultVertexAIGemini30Flash');

            List<String> prompts = new List<String>();
            if (String.isNotBlank(response)) {
                for (String line : response.split('\n')) {
                    line = line.trim()
                        .replaceAll('^\\d+[.)]\\s*', '')
                        .replaceAll('^[-*•]\\s*', '');
                    if (String.isNotBlank(line) && line.length() > 10 && prompts.size() < 3) {
                        prompts.add(line);
                    }
                }
            }

            // Defaults if generation falls short
            while (prompts.size() < 3) {
                if (prompts.size() == 0) prompts.add('What are the key things I should know about this record?');
                else if (prompts.size() == 1) prompts.add('Are there any risks or concerns I should be aware of?');
                else prompts.add('What actions would you recommend based on this data?');
            }

            result.response = JSON.serialize(prompts);
            result.success = true;

        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Unexpected error in generateFollowUpPrompts: ' + e.getMessage());
            result.error = 'Unable to generate follow-up prompts right now.';
        }

        return result;
    }

    /**
     * Returns the list of available AI models for the model picker.
     */
    @AuraEnabled(cacheable=true)
    public static List<ModelInfo> getAvailableModels() {
        return new List<ModelInfo>{
            // ── Google Vertex AI ──
            new ModelInfo('sfdc_ai__DefaultVertexAIGeminiPro30', 'Gemini 3 Pro (Beta)', 'Google', true, 'standard'),
            new ModelInfo('sfdc_ai__DefaultVertexAIGemini30Flash', 'Gemini 3 Flash (Beta)', 'Google', false, 'basic'),
            new ModelInfo('sfdc_ai__DefaultVertexAIGeminiPro25', 'Gemini 2.5 Pro', 'Google', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultVertexAIGemini25Flash001', 'Gemini 2.5 Flash', 'Google', false, 'basic'),
            new ModelInfo('sfdc_ai__DefaultVertexAIGemini25FlashLite001', 'Gemini 2.5 Flash Lite', 'Google', false, 'basic'),

            // ── OpenAI / Azure OpenAI ──
            new ModelInfo('sfdc_ai__DefaultGPT5', 'GPT-5', 'OpenAI', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultGPT5Mini', 'GPT-5 Mini', 'OpenAI', false, 'basic'),
            new ModelInfo('sfdc_ai__DefaultGPT51', 'GPT-5.1 (Beta)', 'OpenAI', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultGPT52', 'GPT-5.2 (Beta)', 'OpenAI', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultGPT41', 'GPT-4.1', 'OpenAI', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultGPT41Mini', 'GPT-4.1 Mini', 'OpenAI', false, 'basic'),
            new ModelInfo('sfdc_ai__DefaultGPT4Omni', 'GPT-4o', 'OpenAI', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultGPT4OmniMini', 'GPT-4o Mini', 'OpenAI', false, 'basic'),
            new ModelInfo('sfdc_ai__DefaultO3', 'O3', 'OpenAI', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultO4Mini', 'O4 Mini', 'OpenAI', false, 'standard'),

            // ── Anthropic on Amazon Bedrock ──
            new ModelInfo('sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet', 'Claude Sonnet 4.5', 'Anthropic', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet', 'Claude Sonnet 4', 'Anthropic', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultBedrockAnthropicClaude45Haiku', 'Claude Haiku 4.5', 'Anthropic', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultBedrockAnthropicClaude45Opus', 'Claude Opus 4.5 (Beta)', 'Anthropic', false, 'advanced'),

            // ── Amazon on Bedrock ──
            new ModelInfo('sfdc_ai__DefaultBedrockAmazonNovaPro', 'Nova Pro', 'Amazon', false, 'standard'),
            new ModelInfo('sfdc_ai__DefaultBedrockAmazonNovaLite', 'Nova Lite', 'Amazon', false, 'basic'),

            // ── NVIDIA on Amazon Bedrock ──
            new ModelInfo('sfdc_ai__DefaultBedrockNvidiaNemotronNano330b', 'Nemotron 3 Nano 30B (Beta)', 'NVIDIA', false, 'basic')
        };
    }

    // ── Private Methods ──

    private static String buildInsightsSystemPrompt(String recordContextJson) {
        String prompt = 'You are Agentforce Record Insights, an AI advisor that helps Salesforce users understand their CRM data.\n\n';
        prompt += 'You have been given the field values and related records for a Salesforce record. '
            + 'Use this data to answer the user\'s questions with specific, data-backed insights.\n\n';

        prompt += '=== RECORD DATA ===\n';
        if (String.isNotBlank(recordContextJson)) {
            prompt += recordContextJson + '\n\n';
        } else {
            prompt += 'No record data provided.\n\n';
        }

        prompt += '=== GUIDELINES ===\n';
        prompt += '- Ground every answer in the actual data provided. Cite specific field values.\n';
        prompt += '- If a question cannot be answered from the available data, say so clearly.\n';
        prompt += '- Use markdown for formatting: **bold** for key points, headers for sections, bullet lists.\n';
        prompt += '- Be concise but thorough. Prioritize actionable insights.\n';
        prompt += '- When discussing dates, calculate relative timeframes (e.g., "3 days ago", "2 weeks overdue").\n';
        prompt += '- For currency values, format with appropriate symbols.\n';

        return prompt;
    }

    private static String buildCompareSystemPrompt(String comparisonContextJson) {
        String prompt = 'You are Agentforce Record Insights in comparison mode. '
            + 'You help users compare multiple Salesforce records of the same type.\n\n';

        prompt += '=== RECORDS TO COMPARE ===\n';
        if (String.isNotBlank(comparisonContextJson)) {
            prompt += comparisonContextJson + '\n\n';
        } else {
            prompt += 'No comparison data provided.\n\n';
        }

        prompt += '=== GUIDELINES ===\n';
        prompt += '- Compare records by highlighting key differences and similarities.\n';
        prompt += '- Use tables when comparing specific field values across records.\n';
        prompt += '- Provide actionable recommendations (e.g., which to prioritize, which needs attention).\n';
        prompt += '- Cite specific field values from each record.\n';
        prompt += '- Use markdown formatting for clear structure.\n';

        return prompt;
    }

    private static void addHistoryMessages(
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages,
        String conversationHistoryJson
    ) {
        try {
            List<Object> history = (List<Object>) JSON.deserializeUntyped(conversationHistoryJson);
            Integer added = 0;
            for (Object entry : history) {
                if (added >= MAX_HISTORY_MESSAGES) break;
                Map<String, Object> msgMap = (Map<String, Object>) entry;
                Object roleObj = msgMap.get('role');
                Object contentObj = msgMap.get('message');
                String role = roleObj == null ? null : String.valueOf(roleObj);
                String content = contentObj == null ? null : String.valueOf(contentObj);
                if (String.isBlank(role) || String.isBlank(content)) continue;
                role = role.trim().toLowerCase();
                if (!ALLOWED_HISTORY_ROLES.contains(role)) continue;
                if (content.length() > MAX_HISTORY_MESSAGE_LENGTH) {
                    content = content.left(MAX_HISTORY_MESSAGE_LENGTH);
                }

                aiplatform.ModelsAPI_ChatMessageRequest msg = new aiplatform.ModelsAPI_ChatMessageRequest();
                msg.role = role;
                msg.content = content;
                messages.add(msg);
                added++;
            }
        } catch (Exception e) {
            System.debug('Error parsing conversation history: ' + e.getMessage());
        }
    }

    private static void validateContextLength(String contextJson, String errorMessage) {
        if (String.isNotBlank(contextJson) && contextJson.length() > MAX_CONTEXT_LENGTH) {
            throw new AuraHandledException(errorMessage);
        }
    }

    private static String callModelsAPI(
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages,
        String primaryModel
    ) {
        List<String> modelsToTry = new List<String>{
            primaryModel,
            DEFAULT_MODEL,
            'sfdc_ai__DefaultGPT5',
            'sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet',
            'sfdc_ai__DefaultGPT4Omni',
            'sfdc_ai__DefaultVertexAIGemini25Flash001',
            'sfdc_ai__DefaultGPT4OmniMini'
        };

        // Deduplicate while preserving order
        Set<String> seen = new Set<String>();
        List<String> uniqueModels = new List<String>();
        for (String m : modelsToTry) {
            if (seen.add(m)) {
                uniqueModels.add(m);
            }
        }

        for (Integer i = 0; i < uniqueModels.size(); i++) {
            String modelName = uniqueModels[i];
            Boolean isLast = (i == uniqueModels.size() - 1);

            try {
                aiplatform.ModelsAPI modelsAPI = new aiplatform.ModelsAPI();
                aiplatform.ModelsAPI.createChatGenerations_Request request =
                    new aiplatform.ModelsAPI.createChatGenerations_Request();
                aiplatform.ModelsAPI_ChatGenerationsRequest body =
                    new aiplatform.ModelsAPI_ChatGenerationsRequest();

                request.modelName = modelName;
                body.messages = messages;
                request.body = body;

                aiplatform.ModelsAPI.createChatGenerations_Response apiResponse =
                    modelsAPI.createChatGenerations(request);

                if (apiResponse?.Code200?.generationDetails?.generations != null
                    && !apiResponse.Code200.generationDetails.generations.isEmpty()) {
                    String content = apiResponse.Code200.generationDetails.generations[0].content;
                    if (String.isNotBlank(content)) {
                        return content.trim();
                    }
                }

                if (isLast) {
                    throw new AuraHandledException('Empty response from all AI models.');
                }

            } catch (aiplatform.ModelsAPI.createChatGenerations_ResponseException e) {
                System.debug('Model ' + modelName + ' failed: ' + e.responseCode + ' - ' + e.getMessage());
                if (isLast) {
                    throw new AuraHandledException('AI model error (code ' + e.responseCode + '). Please try again.');
                }
            } catch (AuraHandledException e) {
                throw e;
            } catch (Exception e) {
                System.debug('Model ' + modelName + ' unexpected error: ' + e.getMessage());
                if (isLast) {
                    throw new AuraHandledException('Error calling AI model: ' + e.getMessage());
                }
            }
        }

        throw new AuraHandledException('Failed to get response from AI models.');
    }
}
