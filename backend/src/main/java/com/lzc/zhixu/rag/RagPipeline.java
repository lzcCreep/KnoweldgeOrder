package com.lzc.zhixu.rag;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 教学用的 RAG 摄取入口。先理解这条链，再把 API、权限和异步任务接进来：
 * 原文 -> 分块 -> embedding -> pgvector。检索和生成故意放在不同服务中。
 */
@Service
public class RagPipeline {
    private final EmbeddingStore<TextSegment> embeddingStore;
    private final EmbeddingModel embeddingModel;
    private final int chunkSize;
    private final int chunkOverlap;

    public RagPipeline(
            EmbeddingStore<TextSegment> embeddingStore,
            EmbeddingModel embeddingModel,
            @Value("${zhixu.rag.chunk-size}") int chunkSize,
            @Value("${zhixu.rag.chunk-overlap}") int chunkOverlap) {
        this.embeddingStore = embeddingStore;
        this.embeddingModel = embeddingModel;
        this.chunkSize = chunkSize;
        this.chunkOverlap = chunkOverlap;
    }

    public void ingest(String noteId, String title, String content, String collection) {
        Document document = Document.from(content);
        document.metadata().put("note_id", noteId);
        document.metadata().put("title", title);
        document.metadata().put("collection", collection);
        EmbeddingStoreIngestor ingestor = EmbeddingStoreIngestor.builder()
                .documentSplitter(DocumentSplitters.recursive(chunkSize, chunkOverlap))
                .embeddingModel(embeddingModel)
                .embeddingStore(embeddingStore)
                .build();
        ingestor.ingest(document);
    }
}
