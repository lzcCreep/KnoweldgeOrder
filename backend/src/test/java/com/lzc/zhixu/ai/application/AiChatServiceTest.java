package com.lzc.zhixu.ai.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.lzc.zhixu.ai.model.ChatModelSettings;
import com.lzc.zhixu.ai.model.KnowledgeAssistant;
import com.lzc.zhixu.ai.model.KnowledgeAssistantFactory;
import com.lzc.zhixu.ai.retrieval.KnowledgeContext;
import com.lzc.zhixu.ai.retrieval.KnowledgeRetriever;
import com.lzc.zhixu.auth.AuthService;
import java.util.List;
import org.junit.jupiter.api.Test;

class AiChatServiceTest {

    @Test
    void orchestratesRetrievalAndAnnotatedAssistantWithoutChangingTheResultContract() {
        KnowledgeAssistantFactory factory = mock(KnowledgeAssistantFactory.class);
        KnowledgeRetriever retriever = mock(KnowledgeRetriever.class);
        KnowledgeAssistant assistant = mock(KnowledgeAssistant.class);
        when(factory.create(any(ChatModelSettings.class))).thenReturn(assistant);
        when(retriever.retrieve(any(), eq("space-1"), eq("测试问题"), eq("本机上下文")))
                .thenReturn(new KnowledgeContext(List.of()));
        when(assistant.answer(anyString(), eq("测试问题"))).thenReturn("测试回答");

        AiChatService service = new AiChatService(factory, retriever);
        AuthService.User user = new AuthService.User("user-1", "tester", "", "测试用户", "");
        ChatResult result = service.chat(user, new ChatCommand(
                "http://model.test/v1", "key", "test-model", "space-1", "测试问题", "本机上下文", 0.2, 256));

        assertEquals("测试回答", result.answer());
        assertEquals("test-model", result.model());
        assertEquals(0, result.referenceCount());
        verify(factory).create(any(ChatModelSettings.class));
        verify(retriever).retrieve(user, "space-1", "测试问题", "本机上下文");
    }
}
