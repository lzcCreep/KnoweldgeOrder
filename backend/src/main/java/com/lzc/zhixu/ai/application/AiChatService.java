package com.lzc.zhixu.ai.application;

import com.lzc.zhixu.ai.model.ChatModelSettings;
import com.lzc.zhixu.ai.model.KnowledgeAssistant;
import com.lzc.zhixu.ai.model.KnowledgeAssistantFactory;
import com.lzc.zhixu.ai.model.ModelConfigurationException;
import com.lzc.zhixu.ai.retrieval.KnowledgeContext;
import com.lzc.zhixu.ai.retrieval.KnowledgeRetrievalException;
import com.lzc.zhixu.ai.retrieval.KnowledgeRetriever;
import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class AiChatService {
    private final KnowledgeAssistantFactory assistantFactory;
    private final KnowledgeRetriever knowledgeRetriever;

    public AiChatService(KnowledgeAssistantFactory assistantFactory, KnowledgeRetriever knowledgeRetriever) {
        this.assistantFactory = assistantFactory;
        this.knowledgeRetriever = knowledgeRetriever;
    }

    public ChatResult chat(AuthService.User user, ChatCommand command) {
        if (command == null || command.prompt() == null || command.prompt().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "问题不能为空");
        }

        KnowledgeAssistant assistant;
        try {
            assistant = assistantFactory.create(new ChatModelSettings(
                    command.baseUrl(),
                    command.apiKey(),
                    command.model(),
                    command.temperature(),
                    command.maxTokens()));
        } catch (ModelConfigurationException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, exception.code(), exception.getMessage());
        }

        KnowledgeContext context;
        try {
            context = knowledgeRetriever.retrieve(
                    user,
                    command.spaceId(),
                    command.prompt(),
                    command.clientContext());
        } catch (KnowledgeRetrievalException exception) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "rag_unavailable", exception.getMessage());
        }

        try {
            String answer = assistant.answer(context.promptText(), command.prompt().trim());
            if (answer == null || answer.isBlank()) {
                throw new ApiException(
                        HttpStatus.BAD_GATEWAY,
                        "invalid_model_response",
                        "模型服务未返回可识别的文本");
            }
            return new ChatResult(answer.trim(), command.model().trim(), context.references());
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ApiException(
                    HttpStatus.BAD_GATEWAY,
                    "model_unavailable",
                    "无法连接模型服务：" + truncate(message(exception), 240));
        }
    }

    private static String message(Exception exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? exception.getClass().getSimpleName() : message;
    }

    private static String truncate(String value, int maxLength) {
        if (value == null || value.isBlank()) return "";
        return value.length() <= maxLength ? value : value.substring(0, maxLength) + "…";
    }
}
