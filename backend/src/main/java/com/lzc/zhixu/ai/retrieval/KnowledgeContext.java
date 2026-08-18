package com.lzc.zhixu.ai.retrieval;

import java.util.List;

public record KnowledgeContext(List<KnowledgeReference> references) {

    public KnowledgeContext {
        references = references == null ? List.of() : List.copyOf(references);
    }

    public String promptText() {
        if (references.isEmpty()) {
            return "（没有检索到可用的个人知识库资料）";
        }
        return String.join("\n\n---\n\n", references.stream().map(KnowledgeReference::promptText).toList());
    }
}
