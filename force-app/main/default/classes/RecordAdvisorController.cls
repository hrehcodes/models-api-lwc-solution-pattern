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
    private static final String DEFAULT_MODEL_SET = 'Default';
    private static final String FOLLOW_UP_MODEL = 'sfdc_ai__DefaultVertexAIGemini30Flash';
    private static final Set<String> ALLOWED_HISTORY_ROLES = new Set<String>{ 'user', 'assistant' };
    private static final Set<String> SUPPORTED_CREDIT_TYPES = new Set<String>{ 'basic', 'standard', 'advanced' };

    // ── Wrapper Classes ──

    public class ChatResponse {
        @AuraEnabled public String response { get; set; }
        @AuraEnabled public Boolean success { get; set; }
        @AuraEnabled public String error { get; set; }
        @AuraEnabled public List<GroundingCitation> citations { get; set; }
        @AuraEnabled public String modelApiName { get; set; }
        @AuraEnabled public String modelLabel { get; set; }
        @AuraEnabled public Integer latencyMs { get; set; }
        @AuraEnabled public Integer estimatedTokens { get; set; }
        @AuraEnabled public Integer estimatedCredits { get; set; }
    }

    public class GroundingCitation {
        @AuraEnabled public String sourceId { get; set; }
        @AuraEnabled public String sourceType { get; set; }
        @AuraEnabled public String displayLabel { get; set; }
        @AuraEnabled public String objectApiName { get; set; }
        @AuraEnabled public String recordId { get; set; }
        @AuraEnabled public String fieldApiName { get; set; }
        @AuraEnabled public String relationshipName { get; set; }
        @AuraEnabled public String valueSummary { get; set; }
    }

    public class ModelComparisonResponse {
        @AuraEnabled public Boolean success { get; set; }
        @AuraEnabled public String error { get; set; }
        @AuraEnabled public List<ModelComparisonResult> results { get; set; }
    }

    public class ModelComparisonResult {
        @AuraEnabled public String modelApiName { get; set; }
        @AuraEnabled public String modelLabel { get; set; }
        @AuraEnabled public String response { get; set; }
        @AuraEnabled public Boolean success { get; set; }
        @AuraEnabled public String error { get; set; }
        @AuraEnabled public List<GroundingCitation> citations { get; set; }
        @AuraEnabled public Integer latencyMs { get; set; }
        @AuraEnabled public Integer estimatedTokens { get; set; }
        @AuraEnabled public Integer estimatedCredits { get; set; }
    }

    private class ModelCallResult {
        public String content { get; set; }
        public String modelApiName { get; set; }
        public Integer latencyMs { get; set; }
    }

    public class ModelInfo {
        @AuraEnabled public String apiName { get; set; }
        @AuraEnabled public String label { get; set; }
        @AuraEnabled public String provider { get; set; }
        @AuraEnabled public Boolean isDefault { get; set; }
        @AuraEnabled public String creditType { get; set; } // 'basic', 'standard', or 'advanced'

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
            List<aiplatform.ModelsAPI_ChatMessageRequest> messages =
                buildChatMessages(systemPrompt, conversationHistoryJson, userMessage);
            Map<String, GroundingCitation> sourceRegistry = extractSourceRegistry(recordContextJson);

            String selectedModel = String.isNotBlank(modelApiName) ? modelApiName : DEFAULT_MODEL;
            ModelCallResult modelResult = callModelsAPIDetailed(messages, selectedModel);
            List<GroundingCitation> citations = extractCitations(modelResult.content, sourceRegistry);
            result.response = sanitizeCitationMarkers(modelResult.content, sourceRegistry);
            result.citations = citations;
            result.modelApiName = modelResult.modelApiName;
            result.modelLabel = getModelDisplayLabel(modelResult.modelApiName);
            result.latencyMs = modelResult.latencyMs;
            result.estimatedTokens = estimateTokens(recordContextJson, conversationHistoryJson, userMessage, result.response);
            result.estimatedCredits = estimateCredits(result.estimatedTokens, modelResult.modelApiName);
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
            List<aiplatform.ModelsAPI_ChatMessageRequest> messages =
                buildChatMessages(systemPrompt, conversationHistoryJson, userMessage);
            Map<String, GroundingCitation> sourceRegistry = extractSourceRegistry(comparisonContextJson);

            String selectedModel = String.isNotBlank(modelApiName) ? modelApiName : DEFAULT_MODEL;
            ModelCallResult modelResult = callModelsAPIDetailed(messages, selectedModel);
            List<GroundingCitation> citations = extractCitations(modelResult.content, sourceRegistry);
            result.response = sanitizeCitationMarkers(modelResult.content, sourceRegistry);
            result.citations = citations;
            result.modelApiName = modelResult.modelApiName;
            result.modelLabel = getModelDisplayLabel(modelResult.modelApiName);
            result.latencyMs = modelResult.latencyMs;
            result.estimatedTokens = estimateTokens(comparisonContextJson, conversationHistoryJson, userMessage, result.response);
            result.estimatedCredits = estimateCredits(result.estimatedTokens, modelResult.modelApiName);
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
    @AuraEnabled
    public static List<ModelInfo> getAvailableModels(String modelSetName) {
        List<ModelInfo> models = new List<ModelInfo>();
        List<ModelCatalogEntry> catalog = getConfiguredModelCatalog(modelSetName);
        if (catalog.isEmpty()) {
            catalog = getModelCatalog();
        }

        for (ModelCatalogEntry entry : catalog) {
            models.add(entry.toModelInfo());
        }
        return models;
    }

    /**
     * Sends one prompt to two selected models and returns independent results.
     */
    @AuraEnabled
    public static ModelComparisonResponse compareModels(
        String contextJson,
        String userMessage,
        String conversationHistoryJson,
        String primaryModelApiName,
        String secondaryModelApiName,
        String mode
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
        validateContextLength(contextJson, 'Context exceeds maximum length.');

        ModelComparisonResponse response = new ModelComparisonResponse();
        response.success = false;
        response.results = new List<ModelComparisonResult>();

        String firstModel = String.isNotBlank(primaryModelApiName) ? primaryModelApiName : DEFAULT_MODEL;
        String secondModel = String.isNotBlank(secondaryModelApiName) ? secondaryModelApiName : null;
        if (String.isBlank(secondModel)) {
            throw new AuraHandledException('A second model is required for model comparison.');
        }
        if (firstModel == secondModel) {
            throw new AuraHandledException('Choose two different models for model comparison.');
        }

        try {
            Boolean compareMode = String.valueOf(mode).toLowerCase() == 'compare';
            String systemPrompt = compareMode
                ? buildCompareSystemPrompt(contextJson)
                : buildInsightsSystemPrompt(contextJson);
            List<aiplatform.ModelsAPI_ChatMessageRequest> messages =
                buildChatMessages(systemPrompt, conversationHistoryJson, userMessage);
            Map<String, GroundingCitation> sourceRegistry = extractSourceRegistry(contextJson);

            response.results.add(runModelComparison(messages, sourceRegistry, contextJson, conversationHistoryJson, userMessage, firstModel));
            response.results.add(runModelComparison(messages, sourceRegistry, contextJson, conversationHistoryJson, userMessage, secondModel));
            response.success = true;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Unexpected error in compareModels: ' + e.getMessage());
            response.error = 'Unexpected error comparing model responses. Please try again.';
        }

        return response;
    }

    // ── Private Methods ──

    @TestVisible
    private static String buildCoreGuidelines() {
        return buildCoreGuidelines(false);
    }

    private static String buildCoreGuidelines(Boolean includeSourceGrounding) {
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
        guidelines += '- Only the fields listed in the provided record payload are available; do not assume other fields exist, are missing, or contain any particular value.\n';
        guidelines += '- If a question cannot be answered from the available data, say so clearly and explain what data would be needed.\n\n';

        guidelines += '--- Generic Context Signals ---\n';
        guidelines += '- `contextSignals` and `comparisonSignals`, when present, are deterministic summaries derived from the selected fields and relationships. Use them as an evidence index, not as hidden data.\n';
        guidelines += '- Apply signals object-agnostically. Do not assume Opportunity, Case, Account, or any other object-specific process unless the payload includes fields or relationships that support that process.\n';
        guidelines += '- Distinguish absent context from selected-empty context: if a selected relationship returned zero records, you may mention that zero records were included; if a relationship is absent, say it was not provided.\n';
        guidelines += '- Do not interpret expected, weighted, forecast, or calculated financial values as discounts or pricing concessions unless an explicit discount, rebate, or pricing field is present.\n\n';
        guidelines += '- Do not treat generic record age or days-since-created fields as time in the current stage/status. Only say a record has been in a stage/status for N days when a field label or API name explicitly indicates days in stage, status age, or last stage/status change.\n';
        guidelines += '- Do not attribute recommendations to Einstein, predictive, scoring, or discovery fields unless those fields contain explicit nonblank recommendation, prescription, cause, score, or prediction values in the payload.\n\n';

        if (includeSourceGrounding) {
            guidelines += '--- Source Citations ---\n';
            guidelines += '- Use only source IDs that appear in `sourceRegistry`.\n';
            guidelines += '- Add compact source markers like [src1] after factual claims that use a specific source.\n';
            guidelines += '- Prefer 1-3 high-value source markers per section; do not cite every sentence.\n';
            guidelines += '- Never invent source IDs. If no source directly supports a claim, omit the marker and say the context is insufficient.\n\n';
        }

        guidelines += '--- Scope ---\n';
        guidelines += '- You are an analysis-only advisor. Do not attempt to modify records or take actions.\n';
        guidelines += '- Do not generate SOQL queries, code, or API calls unless the user explicitly asks.\n\n';

        guidelines += '--- Formatting ---\n';
        guidelines += '- Use markdown: **bold** for key values, headers for sections, bullet lists for details.\n';
        guidelines += '- Start with a short executive summary, then separate factual observations from recommendations.\n';
        guidelines += '- Use tables only for compact comparisons or scalar field summaries; use bullets for narrative insights.\n';
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
        Boolean includeSourceGrounding = hasSourceRegistry(recordContextJson);
        String prompt = 'You are Agentforce Record Insights, an AI advisor that helps Salesforce users '
            + 'understand their CRM data.\n\n';
        prompt += 'You have been given a JSON payload with `selectionSummary`, optional `contextSignals`, and `recordContext`. '
            + '`selectionSummary` describes which categories, relationships, parent references, '
            + 'and depth were included. '
            + '`sourceRegistry`, when present, lists stable source IDs that can be cited in the final answer. '
            + '`contextSignals`, when present, summarizes object-agnostic data-quality, timing, status, field, and relationship coverage observations derived from the payload. '
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

        prompt += buildCoreGuidelines(includeSourceGrounding) + '\n';

        prompt += '=== INSIGHTS-SPECIFIC GUIDELINES ===\n';
        prompt += '- Start with a short fact-grounded executive summary of the most important current state.\n';
        prompt += '- Then provide a `Key observations` section and a separate `Recommended next steps` section.\n';
        prompt += '- Prioritize actionable insights from the object and fields provided — surface risks, opportunities, overdue items, missing data, selected-empty relationships, and anomalies when supported by the context.\n';
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
        Boolean includeSourceGrounding = hasSourceRegistry(comparisonContextJson);
        String prompt = 'You are Agentforce Record Insights in comparison mode. '
            + 'You help users compare multiple Salesforce records of the same type.\n\n';
        prompt += 'The JSON payload includes `selectionSummary`, optional `comparisonSignals`, and `comparisonContext`. '
            + '`selectionSummary` describes which categories, relationships, parent references, '
            + 'and depth were included. '
            + '`sourceRegistry`, when present, lists stable source IDs that can be cited in the final answer. '
            + '`comparisonSignals`, when present, summarizes object-agnostic per-record and cross-record differences derived from the payload. '
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

        prompt += buildCoreGuidelines(includeSourceGrounding) + '\n';

        prompt += '=== COMPARISON-SPECIFIC GUIDELINES ===\n';
        prompt += '- Structure comparisons as: (1) an executive summary of how the records differ, '
            + '(2) a compact comparison table for the most relevant fields, '
            + '(3) risks or differentiators, and (4) recommendations with rationale.\n';
        prompt += '- Use markdown tables only for compact scalar field comparisons. Use bullet lists for related-record patterns, qualitative differences, and narrative takeaways.\n';
        prompt += '- When evaluating fields, read values from each record\'s `fields` map. '
            + 'Use `relatedRecordSets` only when the user\'s question depends on related-record context.\n';
        prompt += '- If comparison-level or record-level `completeness` metadata indicates warnings, mention that the answer may be incomplete.\n';
        prompt += '- If a field is absent from the payload, treat it as not provided in the current context selection. If it is present with a null or empty value, call that out explicitly — missing data is itself an insight.\n';
        prompt += '- For prioritization or triage questions, prefer records with supported urgency, deadline, status, action-field, related-record, missing-data, or numeric outlier signals. Prefer active/open records over closed/completed records only when those fields exist in the payload. If all compared records are closed or completed, say there may be no current execution priority unless the user wants a retrospective comparison.\n';
        prompt += '- Provide actionable recommendations (e.g., which to prioritize, which needs attention).\n';

        return prompt;
    }

    @TestVisible
    private static List<ModelCatalogEntry> getModelCatalog() {
        return new List<ModelCatalogEntry>{
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGeminiPro31', 'Gemini 3.1 Pro (Beta)', 'Vertex AI (Google)', true, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAmazonNovaLite', 'Amazon Nova Lite', 'Amazon Bedrock', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAmazonNovaPro', 'Amazon Nova Pro', 'Amazon Bedrock', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude45Haiku', 'Claude Haiku 4.5', 'Amazon Bedrock', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude45Opus', 'Claude Opus 4.5', 'Amazon Bedrock', false, 'advanced'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude46Opus', 'Claude Opus 4.6 (Beta)', 'Amazon Bedrock', false, 'advanced'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude47Opus', 'Claude Opus 4.7 (Beta)', 'Amazon Bedrock', false, 'advanced'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude4Sonnet', 'Claude Sonnet 4', 'Amazon Bedrock', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude45Sonnet', 'Claude Sonnet 4.5', 'Amazon Bedrock', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet', 'Claude Sonnet 4.6', 'Amazon Bedrock', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultBedrockNvidiaNemotronNano330b', 'NVIDIA Nemotron 3 Nano 30B (Beta)', 'Amazon Bedrock', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT4Omni', 'GPT-4o', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT4OmniMini', 'GPT-4o Mini', 'OpenAI / Azure OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultOpenAIGPT4OmniMini', 'GPT-4o Mini', 'OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT41', 'GPT-4.1', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT41Mini', 'GPT-4.1 Mini', 'OpenAI / Azure OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT5', 'GPT-5', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT5Mini', 'GPT-5 Mini', 'OpenAI / Azure OpenAI', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT51', 'GPT-5.1', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT52', 'GPT-5.2', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultGPT54', 'GPT-5.4', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultO3', 'O3', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultO4Mini', 'O4 Mini', 'OpenAI / Azure OpenAI', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini25Flash001', 'Gemini 2.5 Flash', 'Vertex AI (Google)', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini25FlashLite001', 'Gemini 2.5 Flash Lite', 'Vertex AI (Google)', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGeminiPro25', 'Gemini 2.5 Pro', 'Vertex AI (Google)', false, 'standard'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini30Flash', 'Gemini 3 Flash', 'Vertex AI (Google)', false, 'basic'),
            new ModelCatalogEntry('sfdc_ai__DefaultVertexAIGemini31FlashLite', 'Gemini 3.1 Flash Lite (Beta)', 'Vertex AI (Google)', false, 'basic')
        };
    }

    @TestVisible
    private static List<ModelCatalogEntry> getConfiguredModelCatalog(String modelSetName) {
        return buildConfiguredModelCatalog([
            SELECT DeveloperName,
                MasterLabel,
                Model_API_Name__c,
                Display_Label__c,
                Provider__c,
                Credit_Type__c,
                Enabled__c,
                Sort_Order__c,
                Model_Set__c
            FROM Record_Insights_Model_Alias__mdt
            WHERE Enabled__c = true
            ORDER BY Sort_Order__c ASC NULLS LAST, MasterLabel ASC
        ], modelSetName);
    }

    @TestVisible
    private static List<ModelCatalogEntry> buildConfiguredModelCatalog(
        List<Record_Insights_Model_Alias__mdt> configuredRows,
        String modelSetName
    ) {
        String normalizedModelSet = normalizeModelSetName(modelSetName);
        Set<String> seenApiNames = new Set<String>();
        List<ModelCatalogEntry> catalog = new List<ModelCatalogEntry>();

        for (Record_Insights_Model_Alias__mdt row : configuredRows) {
            if (row == null || row.Enabled__c == false) {
                continue;
            }
            if (normalizeModelSetName(row.Model_Set__c) != normalizedModelSet) {
                continue;
            }

            String apiName = normalizeText(row.Model_API_Name__c);
            if (String.isBlank(apiName) || !seenApiNames.add(apiName)) {
                continue;
            }

            String label = normalizeText(row.Display_Label__c);
            if (String.isBlank(label)) {
                label = normalizeText(row.MasterLabel);
            }
            String provider = normalizeText(row.Provider__c);

            catalog.add(new ModelCatalogEntry(
                apiName,
                String.isNotBlank(label) ? label : apiName,
                String.isNotBlank(provider) ? provider : 'Configured',
                false,
                normalizeCreditType(row.Credit_Type__c)
            ));
        }

        return catalog;
    }

    @TestVisible
    private static List<ModelInfo> buildConfiguredModelInfos(
        List<Record_Insights_Model_Alias__mdt> configuredRows,
        String modelSetName
    ) {
        List<ModelInfo> models = new List<ModelInfo>();
        for (ModelCatalogEntry entry : buildConfiguredModelCatalog(configuredRows, modelSetName)) {
            models.add(entry.toModelInfo());
        }
        return models;
    }

    public static List<String> getAvailableModelSetNames() {
        Set<String> seenModelSets = new Set<String>();
        List<String> modelSets = new List<String>();

        for (Record_Insights_Model_Alias__mdt row : [
            SELECT Model_Set__c
            FROM Record_Insights_Model_Alias__mdt
            WHERE Enabled__c = true
            ORDER BY Model_Set__c ASC NULLS FIRST
        ]) {
            String modelSet = normalizeModelSetName(row.Model_Set__c);
            if (seenModelSets.add(modelSet)) {
                modelSets.add(modelSet);
            }
        }

        if (modelSets.isEmpty()) {
            modelSets.add(DEFAULT_MODEL_SET);
        }
        return modelSets;
    }

    @TestVisible
    private static String normalizeModelSetName(String modelSetName) {
        String normalized = normalizeText(modelSetName);
        return String.isBlank(normalized) ? DEFAULT_MODEL_SET : normalized;
    }

    private static String normalizeCreditType(String creditType) {
        String normalized = normalizeText(creditType);
        if (String.isBlank(normalized)) {
            return 'standard';
        }

        normalized = normalized.toLowerCase();
        return SUPPORTED_CREDIT_TYPES.contains(normalized) ? normalized : 'standard';
    }

    private static String normalizeText(String value) {
        return value == null ? null : value.trim();
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

    private static List<aiplatform.ModelsAPI_ChatMessageRequest> buildChatMessages(
        String systemPrompt,
        String conversationHistoryJson,
        String userMessage
    ) {
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

        return messages;
    }

    private static ModelComparisonResult runModelComparison(
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages,
        Map<String, GroundingCitation> sourceRegistry,
        String contextJson,
        String conversationHistoryJson,
        String userMessage,
        String modelApiName
    ) {
        ModelComparisonResult result = new ModelComparisonResult();
        result.modelApiName = modelApiName;
        result.modelLabel = getModelDisplayLabel(modelApiName);
        result.success = false;

        try {
            ModelCallResult modelResult = callModelsAPIDetailed(messages, modelApiName);
            result.modelApiName = modelResult.modelApiName;
            result.modelLabel = getModelDisplayLabel(modelResult.modelApiName);
            result.citations = extractCitations(modelResult.content, sourceRegistry);
            result.response = sanitizeCitationMarkers(modelResult.content, sourceRegistry);
            result.latencyMs = modelResult.latencyMs;
            result.estimatedTokens = estimateTokens(contextJson, conversationHistoryJson, userMessage, result.response);
            result.estimatedCredits = estimateCredits(result.estimatedTokens, modelResult.modelApiName);
            result.success = true;
        } catch (Exception e) {
            result.error = e.getMessage();
        }

        return result;
    }

    @TestVisible
    private static Boolean hasSourceRegistry(String contextJson) {
        return !extractSourceRegistry(contextJson).isEmpty();
    }

    @TestVisible
    private static Map<String, GroundingCitation> extractSourceRegistry(String contextJson) {
        Map<String, GroundingCitation> registry = new Map<String, GroundingCitation>();
        if (String.isBlank(contextJson)) {
            return registry;
        }

        try {
            Object raw = JSON.deserializeUntyped(contextJson);
            if (!(raw instanceof Map<String, Object>)) {
                return registry;
            }
            Map<String, Object> root = (Map<String, Object>) raw;
            Object sourceRegistryObj = root.get('sourceRegistry');
            if (!(sourceRegistryObj instanceof List<Object>)) {
                return registry;
            }

            for (Object sourceObj : (List<Object>) sourceRegistryObj) {
                if (!(sourceObj instanceof Map<String, Object>)) {
                    continue;
                }
                Map<String, Object> sourceMap = (Map<String, Object>) sourceObj;
                String sourceId = normalizeText(stringValue(sourceMap.get('sourceId')));
                if (String.isBlank(sourceId) || registry.containsKey(sourceId)) {
                    continue;
                }

                GroundingCitation citation = new GroundingCitation();
                citation.sourceId = sourceId;
                citation.sourceType = normalizeText(stringValue(sourceMap.get('sourceType')));
                citation.displayLabel = normalizeText(stringValue(sourceMap.get('displayLabel')));
                citation.objectApiName = normalizeText(stringValue(sourceMap.get('objectApiName')));
                citation.recordId = normalizeText(stringValue(sourceMap.get('recordId')));
                citation.fieldApiName = normalizeText(stringValue(sourceMap.get('fieldApiName')));
                citation.relationshipName = normalizeText(stringValue(sourceMap.get('relationshipName')));
                citation.valueSummary = normalizeText(stringValue(sourceMap.get('valueSummary')));
                registry.put(sourceId, citation);
            }
        } catch (Exception e) {
            System.debug('Error parsing source registry: ' + e.getMessage());
        }

        return registry;
    }

    @TestVisible
    private static List<GroundingCitation> extractCitations(
        String responseText,
        Map<String, GroundingCitation> sourceRegistry
    ) {
        List<GroundingCitation> citations = new List<GroundingCitation>();
        if (String.isBlank(responseText) || sourceRegistry == null || sourceRegistry.isEmpty()) {
            return citations;
        }

        Set<String> seen = new Set<String>();
        Pattern citationPattern = Pattern.compile('src\\d+');
        Matcher matcher = citationPattern.matcher(responseText);
        while (matcher.find()) {
            String sourceId = matcher.group(0);
            if (seen.add(sourceId) && sourceRegistry.containsKey(sourceId)) {
                citations.add(sourceRegistry.get(sourceId));
            }
        }
        return citations;
    }

    @TestVisible
    private static String sanitizeCitationMarkers(
        String responseText,
        Map<String, GroundingCitation> sourceRegistry
    ) {
        if (String.isBlank(responseText)) {
            return responseText;
        }
        return responseText.replaceAll('\\s*\\[((?:src\\d+\\s*,\\s*)*src\\d+)\\]', '').trim();
    }

    private static String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Integer estimateTokens(
        String contextJson,
        String conversationHistoryJson,
        String userMessage,
        String responseText
    ) {
        Integer totalChars = 800;
        totalChars += String.isBlank(contextJson) ? 0 : contextJson.length();
        totalChars += String.isBlank(conversationHistoryJson) ? 0 : conversationHistoryJson.length();
        totalChars += String.isBlank(userMessage) ? 0 : userMessage.length();
        totalChars += String.isBlank(responseText) ? 0 : responseText.length();
        return Math.max(1, (Integer) Math.ceil(Decimal.valueOf(totalChars) / 4));
    }

    private static Integer estimateCredits(Integer estimatedTokens, String modelApiName) {
        Integer chunks = Math.max(1, (Integer) Math.ceil(Decimal.valueOf(estimatedTokens == null ? 0 : estimatedTokens) / 2000));
        String creditType = getModelCreditType(modelApiName);
        Integer costPerChunk = creditType == 'advanced' ? 16 : (creditType == 'basic' ? 2 : 4);
        return chunks * costPerChunk;
    }

    private static String getModelCreditType(String modelApiName) {
        for (ModelCatalogEntry entry : getModelCatalog()) {
            if (entry.apiName == modelApiName) {
                return entry.creditType;
            }
        }
        String normalized = String.isBlank(modelApiName) ? '' : modelApiName.toLowerCase();
        if (normalized.contains('mini') || normalized.contains('flash') || normalized.contains('lite') || normalized.contains('nano')) {
            return 'basic';
        }
        if (normalized.contains('opus')) {
            return 'advanced';
        }
        return 'standard';
    }

    private static String getModelDisplayLabel(String modelApiName) {
        for (ModelCatalogEntry entry : getModelCatalog()) {
            if (entry.apiName == modelApiName) {
                return entry.label;
            }
        }
        return String.isNotBlank(modelApiName) ? modelApiName : DEFAULT_MODEL;
    }

    private static String callModelsAPI(
        List<aiplatform.ModelsAPI_ChatMessageRequest> messages,
        String primaryModel
    ) {
        return callModelsAPIDetailed(messages, primaryModel).content;
    }

    private static ModelCallResult callModelsAPIDetailed(
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
                Long startedAt = DateTime.now().getTime();
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
                        ModelCallResult result = new ModelCallResult();
                        result.content = content.trim();
                        result.modelApiName = modelName;
                        Long elapsedMs = DateTime.now().getTime() - startedAt;
                        result.latencyMs = elapsedMs > 2147483647
                            ? 2147483647
                            : Integer.valueOf(String.valueOf(elapsedMs));
                        return result;
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
