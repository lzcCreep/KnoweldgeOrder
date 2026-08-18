package com.lzc.zhixu.ai.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lzc.zhixu.ai.model.ChatModelSettings;
import com.lzc.zhixu.ai.model.KnowledgeAssistant;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class OpenAiKnowledgeAssistantFactoryTest {

    @Test
    void sendsAnnotatedSystemAndUserMessagesToAnOpenAiCompatibleEndpoint() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = ("{\"id\":\"chatcmpl-test\",\"object\":\"chat.completion\","
                    + "\"created\":1,\"model\":\"test-model\",\"choices\":[{\"index\":0,"
                    + "\"message\":{\"role\":\"assistant\",\"content\":\"LangChain4j 真实回复\"},"
                    + "\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,"
                    + "\"completion_tokens\":1,\"total_tokens\":2}}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();

        try {
            KnowledgeAssistant assistant = new OpenAiKnowledgeAssistantFactory().create(new ChatModelSettings(
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/chat/completions",
                    "",
                    "test-model",
                    0.2,
                    256));

            String answer = assistant.answer("《部署说明》\n向量检索资料", "请回答测试问题");

            assertEquals("LangChain4j 真实回复", answer);
            assertEquals("Bearer not-required", authorization.get());
            JsonNode messages = new ObjectMapper().readTree(requestBody.get()).path("messages");
            assertEquals("system", messages.get(0).path("role").asText());
            assertTrue(messages.get(0).path("content").asText().contains("你是知序个人知识库助手"));
            assertEquals("user", messages.get(1).path("role").asText());
            assertTrue(messages.get(1).path("content").asText().contains("《部署说明》"));
            assertTrue(messages.get(1).path("content").asText().contains("请回答测试问题"));
        } finally {
            server.stop(0);
        }
    }
}
