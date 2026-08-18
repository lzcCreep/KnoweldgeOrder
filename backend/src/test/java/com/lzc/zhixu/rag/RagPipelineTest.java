package com.lzc.zhixu.rag;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import dev.langchain4j.data.document.Metadata;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.filter.Filter;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class RagPipelineTest {

    @Test
    @SuppressWarnings("unchecked")
    void replacesDocumentVectorsAndPreservesAuthorizationMetadataOnEveryChunk() {
        EmbeddingStore<TextSegment> store = mock(EmbeddingStore.class);
        EmbeddingModel model = mock(EmbeddingModel.class);
        AtomicReference<List<TextSegment>> indexedSegments = new AtomicReference<>();

        when(model.embedAll(anyList())).thenAnswer(invocation -> {
            List<TextSegment> segments = invocation.getArgument(0);
            List<Embedding> embeddings = segments.stream()
                    .map(segment -> Embedding.from(new float[] {0.1f, 0.2f, 0.3f}))
                    .toList();
            return Response.from(embeddings);
        });
        when(store.addAll(anyList(), anyList())).thenAnswer(invocation -> {
            List<TextSegment> segments = invocation.getArgument(1);
            indexedSegments.set(segments);
            return segments.stream().map(segment -> UUID.randomUUID().toString()).toList();
        });

        RagPipeline pipeline = new RagPipeline(store, model, 80, 10);
        pipeline.ingest(
                "doc-1",
                "user-1",
                "space-1",
                "部署说明",
                "deployment.md",
                "text/markdown",
                "# 部署说明\n\n这是用于验证文档切块和权限元数据的测试内容。".repeat(8));

        ArgumentCaptor<Filter> removalFilter = ArgumentCaptor.forClass(Filter.class);
        verify(store).removeAll(removalFilter.capture());
        assertTrue(removalFilter.getValue().test(Metadata.from("document_id", "doc-1")));
        assertFalse(removalFilter.getValue().test(Metadata.from("document_id", "doc-2")));

        List<TextSegment> segments = indexedSegments.get();
        assertNotNull(segments);
        assertFalse(segments.isEmpty());
        for (TextSegment segment : segments) {
            assertEquals("doc-1", segment.metadata().getString("document_id"));
            assertEquals("user-1", segment.metadata().getString("owner_id"));
            assertEquals("space-1", segment.metadata().getString("space_id"));
            assertEquals("部署说明", segment.metadata().getString("title"));
            assertEquals("deployment.md", segment.metadata().getString("file_name"));
            assertEquals("text/markdown", segment.metadata().getString("mime_type"));
        }
    }
}
