package com.lzc.zhixu.rag;

import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.store.embedding.EmbeddingStore;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.store.embedding.pgvector.PgVectorEmbeddingStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RagConfiguration {
    @Bean
    EmbeddingModel embeddingModel(
            @Value("${zhixu.ai.embedding.base-url}") String baseUrl,
            @Value("${zhixu.ai.embedding.api-key}") String apiKey,
            @Value("${zhixu.ai.embedding.model}") String model) {
        return OpenAiEmbeddingModel.builder()
                .baseUrl(baseUrl)
                .apiKey(apiKey)
                .modelName(model)
                .build();
    }

    @Bean
    EmbeddingStore<TextSegment> embeddingStore(
            @Value("${zhixu.pgvector.host}") String host,
            @Value("${zhixu.pgvector.port}") int port,
            @Value("${zhixu.pgvector.database}") String database,
            @Value("${zhixu.pgvector.user}") String user,
            @Value("${zhixu.pgvector.password}") String password,
            @Value("${zhixu.pgvector.table}") String table,
            @Value("${zhixu.pgvector.dimension}") int dimension) {
        return PgVectorEmbeddingStore.builder()
                .host(host)
                .port(port)
                .database(database)
                .user(user)
                .password(password)
                .table(table)
                .dimension(dimension)
                .createTable(true)
                .build();
    }
}
