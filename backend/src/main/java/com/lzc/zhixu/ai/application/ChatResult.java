package com.lzc.zhixu.ai.application;

import com.lzc.zhixu.ai.retrieval.KnowledgeReference;
import java.util.List;

public record ChatResult(String answer, String model, List<KnowledgeReference> references) {

    public ChatResult {
        references = references == null ? List.of() : List.copyOf(references);
    }

    public int referenceCount() {
        return references.size();
    }
}
