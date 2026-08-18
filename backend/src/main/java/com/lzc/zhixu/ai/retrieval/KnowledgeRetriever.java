package com.lzc.zhixu.ai.retrieval;

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
import dev.langchain4j.store.embedding.filter.Filter;
import dev.langchain4j.store.embedding.filter.MetadataFilterBuilder;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class KnowledgeRetriever {
    private static final int MAX_REFERENCE_CHARS = 24_000;
    private static final int MAX_REFERENCES = 6;
    private static final int MAX_REFERENCE_CHUNK_CHARS = 5_000;

    private final JdbcClient jdbc;
    private final EmbeddingModel embeddingModel;
    private final EmbeddingStore<TextSegment> embeddingStore;
    private final int retrievalTopK;
    private final double retrievalMinScore;

    public KnowledgeRetriever(
            JdbcClient jdbc,
            EmbeddingModel embeddingModel,
            EmbeddingStore<TextSegment> embeddingStore,
            @Value("${zhixu.rag.retrieval-top-k:5}") int retrievalTopK,
            @Value("${zhixu.rag.retrieval-min-score:0.2}") double retrievalMinScore) {
        this.jdbc = jdbc;
        this.embeddingModel = embeddingModel;
        this.embeddingStore = embeddingStore;
        this.retrievalTopK = Math.max(1, retrievalTopK);
        this.retrievalMinScore = Math.max(0.0, Math.min(1.0, retrievalMinScore));
    }

    public KnowledgeContext retrieve(AuthService.User user, String spaceId, String question, String clientContext) {
        try {
            List<KnowledgeReference> references = new ArrayList<>();
            int used = addClientContext(references, clientContext);
            if (question == null || question.isBlank() || !hasReadyDocuments(user, spaceId)) {
                return new KnowledgeContext(references);
            }

            Filter scopeFilter = scopeFilter(user.id(), spaceId);
            Response<Embedding> embeddingResponse = embeddingModel.embed(question.trim());
            if (embeddingResponse == null || embeddingResponse.content() == null) {
                throw new IllegalStateException("Embedding 服务未返回向量");
            }
            EmbeddingSearchRequest request = EmbeddingSearchRequest.builder()
                    .queryEmbedding(embeddingResponse.content())
                    .maxResults(retrievalTopK)
                    .minScore(retrievalMinScore)
                    .filter(scopeFilter)
                    .build();
            EmbeddingSearchResult<TextSegment> searchResult = embeddingStore.search(request);
            appendCloudReferences(references, searchResult.matches(), used);
            return new KnowledgeContext(references);
        } catch (KnowledgeRetrievalException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new KnowledgeRetrievalException(
                    "无法完成知识库检索：" + truncate(message(exception), 240),
                    exception);
        }
    }

    private int addClientContext(List<KnowledgeReference> references, String clientContext) {
        if (clientContext == null || clientContext.isBlank()) return 0;
        String content = truncate(clientContext.trim(), 14_000);
        references.add(KnowledgeReference.localNotes(content));
        return content.length();
    }

    private void appendCloudReferences(
            List<KnowledgeReference> references,
            List<EmbeddingMatch<TextSegment>> matches,
            int initialUsed) {
        int used = initialUsed;
        Set<String> seenDocuments = new LinkedHashSet<>();
        for (EmbeddingMatch<TextSegment> match : matches) {
            TextSegment segment = match.embedded();
            if (segment == null || segment.text() == null || segment.text().isBlank()) continue;
            Metadata metadata = segment.metadata();
            String id = metadataValue(metadata, "document_id");
            if (id.isBlank() || !seenDocuments.add(id)) continue;
            if (references.size() >= MAX_REFERENCES || used >= MAX_REFERENCE_CHARS) break;

            String title = metadataValue(metadata, "title");
            if (title.isBlank()) title = id;
            String mimeType = metadataValue(metadata, "mime_type");
            int remaining = Math.min(MAX_REFERENCE_CHUNK_CHARS, MAX_REFERENCE_CHARS - used);
            String content = truncate(segment.text(), remaining);
            references.add(KnowledgeReference.cloudDocument(id, title, mimeType, content));
            used += content.length();
        }
    }

    private Filter scopeFilter(String ownerId, String spaceId) {
        Filter filter = MetadataFilterBuilder.metadataKey("owner_id").isEqualTo(ownerId);
        String scopedSpaceId = spaceId == null ? "" : spaceId.trim();
        if (!scopedSpaceId.isBlank()) {
            filter = filter.and(MetadataFilterBuilder.metadataKey("space_id").isEqualTo(scopedSpaceId));
        }
        return filter;
    }

    private boolean hasReadyDocuments(AuthService.User user, String spaceId) {
        String scopedSpaceId = spaceId == null ? "" : spaceId.trim();
        return jdbc.sql("select exists(select 1 from documents d join spaces s on s.id = d.space_id "
                        + "where s.owner_id = :ownerId and d.deleted_at is null and d.status = 'ready' "
                        + "and d.indexed_at is not null "
                        + "and (:spaceId = '' or d.space_id = :spaceId))")
                .param("ownerId", user.id())
                .param("spaceId", scopedSpaceId)
                .query(Boolean.class)
                .single();
    }

    private static String metadataValue(Metadata metadata, String key) {
        if (metadata == null) return "";
        String value = metadata.getString(key);
        return value == null ? "" : value.trim();
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
