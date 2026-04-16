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
    private static final String DEFAULT_MODEL = 'sfdc_ai__DefaultVertexAIGeminiPro31';
    private static final String FOLLOW_UP_MODEL = 'sfdc_ai__DefaultVertexAIGemini30Flash';
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

    private class ModelCatalogEntry {
        public String apiName { get; private set; }
        public String label { get; private set; }
        public String provider { get; private set; }
        public Boolean isDefault { get; private set; }
        public String creditType { get; private set; }

        public ModelCatalogEntry(String apiName, String label, String provider, Boolean isDefault, String creditType) {
            this.apiName = apiName;
            this.label = label;
            this.provider = provider;
            this.isDefault = isDefault;
            this.creditType = creditType;
        }

        public ModelInfo toModelInfo() {
            return new ModelInfo(apiName, label, provider, isDefault, creditType);
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
            List<aiplatform.ModelsAPI_ChatMessageRequest> messages = new List<aiplatform.ModelsAPI_ChatMessageRequest>();

            aiplatform.ModelsAPI_ChatMessageRequest sysMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            sysMsg.role = 'system';
            sysMsg.content = 'You are a follow-up question generator for a Salesforce CRM insights tool. '
                + 'Your job is to suggest the next questions a business user would naturally want to ask about their record data. '
                + 'Return exactly 3 questions, one per line, with no numbering, bullets, or extra formatting.';
            messages.add(sysMsg);

            String prompt = 'Based on the Salesforce record context and recent conversation below, '
                + 'generate exactly 3 follow-up questions the user might want to ask next.\n\n'
                + 'Rules:\n'
                + '- Each question must be answerable from the provided record data.\n'
                + '- Each question should explore a different aspect (e.g., risk, opportunity, timeline, relationships, or next actions).\n'
                + '- Do not repeat or rephrase questions already asked in the conversation.\n'
                + '- Keep each question under 15 words.\n'
                + '- Return exactly 3 questions, one per line, without numbering or bullets.\n\n'
                + 'Record Context:\n' + (String.isNotBlank(recordContextJson) ? recordContextJson.abbreviate(3000) : 'None') + '\n\n'
                + 'Recent Conversation:\n' + (String.isNotBlank(recentConversationJson) ? recentConversationJson.abbreviate(2000) : 'None');

            aiplatform.ModelsAPI_ChatMessageRequest userMsg = new aiplatform.ModelsAPI_ChatMessageRequest();
            userMsg.role = 'user';
            userMsg.content = prompt;
            messages.add(userMsg);

            String response = callModelsAPI(messages, FOLLOW_UP_MODEL);

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
        List<ModelInfo> models = new List<ModelInfo>();
        for (ModelCatalogEntry entry : getModelCatalog()) {
            models.add(entry.toModelInfo());
        }
        return models;
    }

    // ── Private Methods ──

    @TestVisible
    private static String buildCoreGuidelines() {
        String today = Datetime.now().format('yyyy-MM-dd');
        String guidelines = '=== CORE GUIDELINES ===\n';
        guidelines += 'Today\'s date: ' + today + '\n\n';

        guidelines += '--- Audience ---\n';
        guidelines += 'The user is a Salesforce CRM professional — likely a sales rep, account executive, '
            + 'service agent, or manager. Tailor language for a business audience, not a technical one.\n\n';

        guidelines += '--- Data Integrity ---\n';
        guidelines += '- Ground every answer in the actual data provided. Cite specific field values and labels.\n';
        guidelines += '- NEVER fabricate or infer field values that are not present in the provided data.\n';
        guidelines += '- If a field or related record set is absent from the payload, treat it as not provided in the current context selection unless completeness metadata indicates truncation or skipped data.\n';
        guidelines += '- If a field is present with a null, blank, or empty value, state that it is blank on the record rather than guessing.\n';
        guidelines += '- If a question cannot be answered from the available data, say so clearly and explain what data would be needed.\n\n';

        guidelines += '--- Scope ---\n';
        guidelines += '- You are an analysis-only advisor. Do not attempt to modify records or take actions.\n';
        guidelines += '- Do not generate SOQL queries, code, or API calls unless the user explicitly asks.\n\n';

        guidelines += '--- Formatting ---\n';
        guidelines += '- Use markdown: **bold** for key values, headers for sections, bullet lists for details.\n';
        guidelines += '- Aim for 150–400 words unless the user requests more or less detail.\n';
        guidelines += '- When discussing dates, calculate relative timeframes from today (e.g., "3 days ago", "2 weeks overdue").\n';
        guidelines += '- For currency values, format with appropriate symbols and thousands separators.\n\n';

        guidelines += '--- Conversation ---\n';
        guidelines += '- You may receive prior conversation messages as context. Maintain continuity — '
            + 'reference earlier topics naturally, avoid repeating information already discussed, and build on previous analysis.\n';

        return guidelines;
    }

    @TestVisible
    private static String buildInsightsSystemPrompt(String recordContextJson) {
        String prompt = 'You are Agentforce Record Insights, an AI advisor that helps Salesforce users '
            + 'understand their CRM data.\n\n';
        prompt += 'You have been given a JSON payload with `selectionSummary` and `recordContext`. '
            + '`selectionSummary` describes which categories, relationships, parent references, '
            + 'and depth were included. '
            + '`recordContext` contains the actual grounded field values, related records, parent records, '
            + 'sibling records, and completeness metadata. '
            + 'Field API names map to objects containing a human-readable `label` and `value`. '
            + 'Use field labels (not API names) when referring to data in your responses.\n\n';

        prompt += '=== RECORD DATA ===\n';
        if (String.isNotBlank(recordContextJson)) {
            prompt += recordContextJson + '\n\n';
        } else {
            prompt += 'No record data provided.\n\n';
        }

        prompt += '=== PARENT RECORDS ===\n';
        prompt += '- `recordContext.parentRecordContexts` (if present) lists parent lookup records selected by the user.\n';
        prompt += '- Each entry contains the parent\'s own fields plus optional `sameObjectSiblings` and `selectedChildRelationship` collections.\n';
        prompt += '- Treat parent data as supplementary context. Do not traverse further lookups beyond what the payload provides.\n\n';

        prompt += '=== SIBLING RECORDS (THROUGH PARENT) ===\n';
        prompt += '- `parentRecordContexts[].sameObjectSiblings` (if present) lists other records of the same object type that share the selected parent. These exclude the active record itself.\n';
        prompt += '- `parentRecordContexts[].selectedChildRelationship` (if present) contains one user-picked child-relationship expansion on the parent.\n';
        prompt += '- Sibling data is provided for comparison and benchmarking only. It is one hop deep; do not infer further relationships, automation, or workflow rules from it.\n\n';

        prompt += buildCoreGuidelines() + '\n';

        prompt += '=== INSIGHTS-SPECIFIC GUIDELINES ===\n';
        prompt += '- Start with a short fact-grounded summary of the most important current state.\n';
        prompt += '- Then provide recommendations separately, with rationale tied directly to the provided data.\n';
        prompt += '- Prioritize actionable insights — surface risks, opportunities, overdue items, and anomalies.\n';
        prompt += '- When related records are available, draw connections across them '
            + '(e.g., open cases on an account, recent activities on an opportunity).\n';
        prompt += '- When parent records or sibling records are available, use them to enrich the summary '
            + '(e.g., "the parent Account is in the Healthcare industry" or "2 sibling Orders share this Account and are both Closed").\n';
        prompt += '- If completeness metadata indicates warnings, state that some context may have been skipped or truncated.\n';
        prompt += '- If the user asks for something not covered by the selected context, say which additional context would help '
            + '(including whether enabling specific parent records or siblings would resolve the gap).\n';

        return prompt;
    }

    @TestVisible
    private static String buildCompareSystemPrompt(String comparisonContextJson) {
        String prompt = 'You are Agentforce Record Insights in comparison mode. '
            + 'You help users compare multiple Salesforce records of the same type.\n\n';
        prompt += 'The JSON payload includes `selectionSummary` and `comparisonContext`. '
            + '`selectionSummary` describes which categories, relationships, parent references, '
            + 'and depth were included. '
            + '`comparisonContext` contains the comparison-level metadata and the list of records. '
            + 'Each record contains `fields` with field API names mapped to objects with a human-readable `label` and `value`. '
            + 'Records may also contain `relatedRecordSets`, `parentRecordContexts`, and `completeness` metadata. '
            + 'Always refer to each record by its name, not its ID.\n\n';

        prompt += '=== RECORDS TO COMPARE ===\n';
        if (String.isNotBlank(comparisonContextJson)) {
            prompt += comparisonContextJson + '\n\n';
        } else {
            prompt += 'No comparison data provided.\n\n';
        }

        prompt += '=== PARENT RECORDS ===\n';
        prompt += '- Each compared record may include `parentRecordContexts` with parent lookup data the user elected to load.\n';
        prompt += '- Treat parent data as supplementary context for differentiating the compared records. Do not traverse further relationships beyond what is provided.\n\n';

        prompt += '=== SIBLING RECORDS (THROUGH PARENT) ===\n';
        prompt += '- `parentRecordContexts[].sameObjectSiblings` shows other records of the same object sharing a parent (excluding the compared record itself).\n';
        prompt += '- `parentRecordContexts[].selectedChildRelationship` shows one optional user-picked child-relationship expansion under the parent.\n';
        prompt += '- Use these only to enrich comparison takeaways (e.g., "both records share the same Account and that Account has 4 other open Orders"). Do not infer workflow rules or aggregate metrics beyond what the data contains.\n\n';

        prompt += buildCoreGuidelines() + '\n';

        prompt += '=== COMPARISON-SPECIFIC GUIDELINES ===\n';
        prompt += '- Structure comparisons as: (1) an executive summary of how the records differ, '
            + '(2) a field-by-field comparison table for the most relevant fields, '
            + '(3) recommendations with rationale.\n';
        prompt += '- Use markdown tables only for compact scalar field comparisons. Use bullet lists for related-record patterns, qualitative differences, and narrative takeaways.\n';
        prompt += '- When evaluating fields, read values from each record\'s `fields` map. '
            + 'Use `relatedRecordSets` only when the user\'s question depends on related-record context.\n';
        prompt += '- If comparison-level or record-level `completeness` metadata indicates warnings, mention that the answer may be incomplete.\n';
        prompt += '- If a field is absent from the payload, treat it as not provided in the current context selection. If it is present with a null or empty value, call that out explicitly — missing data is itself an insight.\n';
        prompt += '- For prioritization or triage questions, prefer active or open records over closed or completed ones, and weigh urgency, deadlines, business impact, risk signals, next-step clarity, and blockers. If all compared records are closed or completed, say there may be no current execution priority unless the user wants a retrospective comparison.\n';
        prompt += '- Provide actionable recommendations (e.g., which to prioritize, which needs attention).\n';

        return prompt;
    }

    @TestVisible
    private static List<ModelCatalogEntry> getModelCatalog() {
        return new List<ModelCatalogEntry>{
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGeminiPro31', 'Gemini 3.1 Pro (Beta)', 'Google', true, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini30Flash', 'Gemini 3 Flash (Beta)', 'Google', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGeminiPro25', 'Gemini 2.5 Pro', 'Google', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini25Flash001', 'Gemini 2.5 Flash', 'Google', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini25FlashLite001', 'Gemini 2.5 Flash Lite', 'Google', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT5', 'GPT-5', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT5Mini', 'GPT-5 Mini', 'OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT51', 'GPT-5.1 (Beta)', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT52', 'GPT-5.2 (Beta)', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT41', 'GPT-4.1', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT41Mini', 'GPT-4.1 Mini', 'OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT4Omni', 'GPT-4o', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT4OmniMini', 'GPT-4o Mini', 'OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultO3', 'O3', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultO4Mini', 'O4 Mini', 'OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet', 'Claude Sonnet 4.5', 'Anthropic', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet', 'Claude Sonnet 4', 'Anthropic', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude45Haiku', 'Claude Haiku 4.5', 'Anthropic', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude45Opus', 'Claude Opus 4.5 (Beta)', 'Anthropic', false, 'advanced'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAmazonNovaPro', 'Nova Pro', 'Amazon', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAmazonNovaLite', 'Nova Lite', 'Amazon', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockNvidiaNemotronNano330b', 'Nemotron 3 Nano 30B (Beta)', 'NVIDIA', false, 'basic')
        };
    }

    @TestVisible
    private static List<String> buildModelFallbackChain(String primaryModel) {
        List<String> modelsToTry = new List<String>();
        if (String.isNotBlank(primaryModel)) {
            modelsToTry.add(primaryModel);
        }

        modelsToTry.addAll(new List<String>{
            DEFAULT_MODEL,
            'sfdc_ai__DefaultGPT5',
            'sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet',
            'sfdc_ai__DefaultGPT4Omni',
            'sfdc_ai__DefaultVertexAIGemini25Flash001',
            'sfdc_ai__DefaultGPT4OmniMini'
        });

        Set<String> seen = new Set<String>();
        List<String> uniqueModels = new List<String>();
        for (String modelName : modelsToTry) {
            if (String.isBlank(modelName) || !seen.add(modelName)) {
                continue;
            }
            uniqueModels.add(modelName);
        }

        return uniqueModels;
    }

    @TestVisible
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

    @TestVisible
    private static void validateContextLength(String contextJson, String errorMessage) {
        if (String.isNotBlank(contextJson) && contextJson.length() > MAX_CONTEXT_LENGTH) {
            throw new AuraHandledException(errorMessage);
        }
    }

    private static String callModelsAPI(
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages,
        String primaryModel
    ) {
        List<String> modelsToTry = buildModelFallbackChain(primaryModel);
        Boolean sawResponseException = false;
        Integer lastResponseCode;

        for (Integer i = 0; i < modelsToTry.size(); i++) {
            String modelName = modelsToTry[i];
            Boolean isLast = (i == modelsToTry.size() - 1);
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
                sawResponseException = true;
                lastResponseCode = e.responseCode;
                System.debug('Model ' + modelName + ' failed: ' + e.responseCode + ' - ' + e.getMessage());
                if (isLast) {
                    throwUnavailableModelsException(primaryModel, lastResponseCode, sawResponseException);
                }
            } catch (AuraHandledException e) {
                throw e;
            } catch (Exception e) {
                System.debug('Model ' + modelName + ' unexpected error: ' + e.getMessage());
                if (isLast) {
                    if (sawResponseException) {
                        throwUnavailableModelsException(primaryModel, lastResponseCode, true);
                    }
                    throw new AuraHandledException('Error calling AI model: ' + e.getMessage());
                }
            }
        }

        throw new AuraHandledException('Failed to get response from AI models.');
    }

    @TestVisible
    private static void throwUnavailableModelsException(
        String primaryModel,
        Integer lastResponseCode,
        Boolean hadConfiguredModelFailures
    ) {
        if (hadConfiguredModelFailures) {
            String targetModel = String.isNotBlank(primaryModel) ? primaryModel : DEFAULT_MODEL;
            String message = 'No configured AI models are currently available in this org. '
                + 'Verify Salesforce Models API access and the configured model aliases';
            if (String.isNotBlank(targetModel)) {
                message += ' (starting with ' + targetModel + ')';
            }
            if (lastResponseCode != null) {
                message += '. Last model error code: ' + lastResponseCode + '.';
            } else {
                message += '.';
            }
            throw new AuraHandledException(message);
        }

        throw new AuraHandledException('Failed to get response from AI models.');
    }
}
