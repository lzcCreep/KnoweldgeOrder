package com.lzc.zhixu.ai.retrieval;

public record KnowledgeReference(
        String type,
        String id,
        String title,
        String mimeType,
        String content) {

    public static KnowledgeReference localNotes(String content) {
        return new KnowledgeReference("local_notes", "", "本机笔记", "", content);
    }

    public static KnowledgeReference cloudDocument(String id, String title, String mimeType, String content) {
        return new KnowledgeReference("cloud_document", id, title, mimeType, content);
    }

    String promptText() {
        if ("local_notes".equals(type)) {
            return "当前设备笔记\n" + content;
        }
        return "云端知识文件《" + title + "》\n" + content;
    }
}
