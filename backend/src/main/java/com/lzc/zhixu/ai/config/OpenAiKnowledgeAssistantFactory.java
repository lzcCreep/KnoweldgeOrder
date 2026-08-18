package com.lzc.zhixu.ai.config;

import com.lzc.zhixu.ai.model.ChatModelSettings;
import com.lzc.zhixu.ai.model.KnowledgeAssistant;
import com.lzc.zhixu.ai.model.KnowledgeAssistantFactory;
import com.lzc.zhixu.ai.model.ModelConfigurationException;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.service.AiServices;
import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import org.springframework.stereotype.Component;

@Component
public class OpenAiKnowledgeAssistantFactory implements KnowledgeAssistantFactory {

    @Override
    public KnowledgeAssistant create(ChatModelSettings settings) {
        if (settings == null) {
            throw new ModelConfigurationException("invalid_model_config", "模型配置不能为空");
        }

        String baseUrl = normalizeBaseUrl(settings.baseUrl());
        String modelName = required(settings.model(), "模型名称");
        String apiKey = settings.apiKey() == null || settings.apiKey().isBlank()
                ? "not-required"
                : settings.apiKey().trim();
        try {
            ChatLanguageModel chatModel = OpenAiChatModel.builder()
                    .baseUrl(baseUrl)
                    .apiKey(apiKey)
                    .modelName(modelName)
                    .temperature(settings.temperature() == null ? 0.2 : settings.temperature())
                    .maxTokens(settings.maxTokens() == null ? 1200 : settings.maxTokens())
                    .timeout(Duration.ofSeconds(90))
                    .maxRetries(0)
                    .build();
            return AiServices.create(KnowledgeAssistant.class, chatModel);
        } catch (ModelConfigurationException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ModelConfigurationException(
                    "invalid_model_config",
                    "模型配置无效：" + truncate(message(exception), 240));
        }
    }

    static String normalizeBaseUrl(String baseUrl) {
        try {
            String value = required(baseUrl, "模型服务 URL").replaceAll("/+$", "");
            URI uri = URI.create(value);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                throw new IllegalArgumentException();
            }
            if (value.toLowerCase(Locale.ROOT).endsWith("/chat/completions")) {
                value = value.substring(0, value.length() - "/chat/completions".length())
                        .replaceAll("/+$", "");
            }
            return value + "/";
        } catch (ModelConfigurationException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ModelConfigurationException("invalid_model_url", "模型服务 URL 不合法");
        }
    }

    private static String required(String value, String label) {
        if (value == null || value.isBlank()) {
            throw new ModelConfigurationException("invalid_model_config", label + "不能为空");
        }
        return value.trim();
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
