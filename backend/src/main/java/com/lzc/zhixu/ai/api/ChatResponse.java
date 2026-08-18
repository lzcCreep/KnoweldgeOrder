package com.lzc.zhixu.ai.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.lzc.zhixu.ai.application.ChatResult;
import com.lzc.zhixu.ai.retrieval.KnowledgeReference;
import java.util.List;

public record ChatResponse(
        String answer,
        String model,
        @JsonProperty("reference_count") int referenceCount,
        List<ReferenceResponse> references) {

    static ChatResponse from(ChatResult result) {
        return new ChatResponse(
                result.answer(),
                result.model(),
                result.referenceCount(),
                result.references().stream().map(ReferenceResponse::from).toList());
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReferenceResponse(
            String type,
            String id,
            String title,
            @JsonProperty("mime_type") String mimeType) {

        static ReferenceResponse from(KnowledgeReference reference) {
            String mimeType = reference.mimeType() == null || reference.mimeType().isBlank()
                    ? null
                    : reference.mimeType();
            return new ReferenceResponse(reference.type(), reference.id(), reference.title(), mimeType);
        }
    }
}
