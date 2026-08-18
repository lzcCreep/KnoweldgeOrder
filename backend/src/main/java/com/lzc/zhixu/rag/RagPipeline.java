package com.lzc.zhixu.rag;

import dev.langchain4j.data.document.Document;
import dev.langchain4j.data.document.splitter.DocumentSplitters;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.store.embedding.EmbeddingStoreIngestor;
import dev.langchain4j.store.embedding.filter.MetadataFilterBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The server-side ingestion pipeline: text -> chunks -> embeddings -> pgvector.
 *
 * <p>Every segment carries the owning user and space so retrieval can apply the
 * same authorization boundary as the relational document API.</p>
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

    /**
     * Replaces all existing vectors for a document and indexes its current text.
     * Replacing first makes retries idempotent and prevents duplicate chunks.
     */
    public void ingest(String documentId, String ownerId, String spaceId, String title,
            String fileName, String mimeType, String content) {
        removeDocument(documentId);

        Document document = Document.from(content);
        document.metadata()
                .put("document_id", documentId)
                .put("owner_id", ownerId)
                .put("space_id", spaceId)
                .put("title", title)
                .put("file_name", fileName)
                .put("mime_type", mimeType);

        EmbeddingStoreIngestor ingestor = EmbeddingStoreIngestor.builder()
                .documentSplitter(DocumentSplitters.recursive(chunkSize, chunkOverlap))
                .embeddingModel(embeddingModel)
                .embeddingStore(embeddingStore)
                .build();
        ingestor.ingest(document);
    }

    /** Removes every chunk belonging to one relational document. */
    public void removeDocument(String documentId) {
        embeddingStore.removeAll(MetadataFilterBuilder.metadataKey("document_id").isEqualTo(documentId));
    }

    /** Removes every chunk belonging to a knowledge space before that space is deleted. */
    public void removeSpace(String spaceId) {
        embeddingStore.removeAll(MetadataFilterBuilder.metadataKey("space_id").isEqualTo(spaceId));
    }
}
