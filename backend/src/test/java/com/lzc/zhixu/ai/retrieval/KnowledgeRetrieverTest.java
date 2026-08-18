package com.lzc.zhixu.ai.retrieval;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.lzc.zhixu.auth.AuthService;
import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.store.embedding.EmbeddingMatch;
import dev.langchain4j.store.embedding.EmbeddingSearchRequest;
import dev.langchain4j.store.embedding.EmbeddingSearchResult;
import dev.langchain4j.store.embedding.EmbeddingStore;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.simple.JdbcClient;

class KnowledgeRetrieverTest {

    @Test
    @SuppressWarnings("unchecked")
    void scopesCloudSearchToTheCurrentOwnerAndSpaceAndPreservesTheDocumentReference() {
        JdbcClient jdbc = readyDocumentsJdbc(true);
        EmbeddingModel embeddingModel = mock(EmbeddingModel.class);
        EmbeddingStore<TextSegment> embeddingStore = mock(EmbeddingStore.class);
        Embedding queryEmbedding = Embedding.from(new float[] {0.1f, 0.2f, 0.3f});
        when(embeddingModel.embed("测试问题")).thenReturn(Response.from(queryEmbedding));

        Metadata metadata = new Metadata()
                .put("document_id", "doc-1")
                .put("owner_id", "user-1")
                .put("space_id", "space-1")
                .put("title", "部署说明")
                .put("mime_type", "text/markdown");
        TextSegment segment = TextSegment.from("这是云端知识文件中的内容。", metadata);
        EmbeddingMatch<TextSegment> match = new EmbeddingMatch<>(0.91, "embedding-1", queryEmbedding, segment);
        when(embeddingStore.search(any(EmbeddingSearchRequest.class)))
                .thenReturn(new EmbeddingSearchResult<>(List.of(match)));

        KnowledgeRetriever retriever = new KnowledgeRetriever(jdbc, embeddingModel, embeddingStore, 5, 0.2);
        AuthService.User user = new AuthService.User("user-1", "tester", "", "测试用户", "");
        KnowledgeContext context = retriever.retrieve(user, "space-1", " 测试问题 ", "本机笔记内容");

        assertEquals(2, context.references().size());
        assertEquals("local_notes", context.references().get(0).type());
        KnowledgeReference cloudReference = context.references().get(1);
        assertEquals("cloud_document", cloudReference.type());
        assertEquals("doc-1", cloudReference.id());
        assertEquals("部署说明", cloudReference.title());
        assertEquals("text/markdown", cloudReference.mimeType());
        assertTrue(context.promptText().contains("云端知识文件《部署说明》"));

        ArgumentCaptor<EmbeddingSearchRequest> requestCaptor =
                ArgumentCaptor.forClass(EmbeddingSearchRequest.class);
        verify(embeddingStore).search(requestCaptor.capture());
        EmbeddingSearchRequest request = requestCaptor.getValue();
        assertEquals(5, request.maxResults());
        assertEquals(0.2, request.minScore());
        assertTrue(request.filter().test(scopedMetadata("user-1", "space-1")));
        assertFalse(request.filter().test(scopedMetadata("user-2", "space-1")));
        assertFalse(request.filter().test(scopedMetadata("user-1", "space-2")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void skipsEmbeddingWhenThereAreNoReadyCloudDocuments() {
        JdbcClient jdbc = readyDocumentsJdbc(false);
        EmbeddingModel embeddingModel = mock(EmbeddingModel.class);
        EmbeddingStore<TextSegment> embeddingStore = mock(EmbeddingStore.class);
        KnowledgeRetriever retriever = new KnowledgeRetriever(jdbc, embeddingModel, embeddingStore, 5, 0.2);
        AuthService.User user = new AuthService.User("user-1", "tester", "", "测试用户", "");

        KnowledgeContext context = retriever.retrieve(user, "space-1", "测试问题", "本机笔记内容");

        assertEquals(1, context.references().size());
        assertEquals("local_notes", context.references().get(0).type());
        verifyNoInteractions(embeddingModel, embeddingStore);
    }

    @SuppressWarnings("unchecked")
    private static JdbcClient readyDocumentsJdbc(boolean hasReadyDocuments) {
        JdbcClient jdbc = mock(JdbcClient.class);
        JdbcClient.StatementSpec statement = mock(JdbcClient.StatementSpec.class);
        JdbcClient.MappedQuerySpec<Boolean> query = mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(statement);
        when(statement.param(anyString(), any())).thenReturn(statement);
        when(statement.query(Boolean.class)).thenReturn(query);
        when(query.single()).thenReturn(hasReadyDocuments);
        return jdbc;
    }

    private static Metadata scopedMetadata(String ownerId, String spaceId) {
        return new Metadata().put("owner_id", ownerId).put("space_id", spaceId);
    }
}
