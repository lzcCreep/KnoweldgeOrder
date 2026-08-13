package com.lzc.zhixu.ingestion;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.charset.CodingErrorAction;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class DocumentService {
    private static final Map<String, String> MIME_BY_EXTENSION = Map.of(
            "md", "text/markdown", "markdown", "text/markdown", "txt", "text/plain");
    private final JdbcClient jdbc;
    private final Executor ingestionExecutor;
    private final ObjectMapper objectMapper;
    public DocumentService(JdbcClient jdbc, @Qualifier("ingestionExecutor") Executor ingestionExecutor, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.ingestionExecutor = ingestionExecutor;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> create(AuthService.User user, String spaceId, MultipartFile file, String title, String tags, String sourceUrl) {
        requireSpace(user, spaceId);
        if (file == null || file.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "必须上传非空文件");
        String fileName = file.getOriginalFilename() == null ? "untitled.txt" : file.getOriginalFilename();
        String extension = extension(fileName);
        String mimeType = MIME_BY_EXTENSION.get(extension);
        if (mimeType == null) throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "仅支持 Markdown 和 TXT 文件");
        byte[] bytes;
        try { bytes = file.getBytes(); } catch (IOException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "无法读取上传文件");
        }
        String documentId = "doc_" + UUID.randomUUID();
        String jobId = "job_" + UUID.randomUUID();
        String resolvedTitle = title == null || title.isBlank() ? stripExtension(fileName) : title.trim();
        String normalizedTags = tags == null || tags.isBlank() ? "[]" : tags.trim();
        parseTags(normalizedTags);
        String suppliedMime = file.getContentType();
        if (suppliedMime != null && !suppliedMime.isBlank() && !"application/octet-stream".equals(suppliedMime)
                && !mimeType.equals(suppliedMime) && !("text/plain".equals(suppliedMime) && "text/markdown".equals(mimeType))) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "文件扩展名与 MIME 类型不匹配");
        }
        String content;
        try {
            content = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
        } catch (java.nio.charset.CharacterCodingException exception) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "parse_failed", "文件不是有效的 UTF-8 文本");
        }
        if (content.indexOf('\0') >= 0) throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "文件内容不是文本");
        jdbc.sql("insert into documents (id, space_id, title, file_name, mime_type, size_bytes, content, content_sha256, status, tags, source_url) "
                        + "values (:id, :spaceId, :title, :fileName, :mimeType, :sizeBytes, :content, :hash, 'queued', cast(:tags as jsonb), :sourceUrl)")
                .param("id", documentId).param("spaceId", spaceId).param("title", resolvedTitle).param("fileName", fileName)
                .param("mimeType", mimeType).param("sizeBytes", bytes.length).param("content", content).param("hash", sha256(bytes))
                .param("tags", normalizedTags).param("sourceUrl", sourceUrl).update();
        jdbc.sql("insert into ingestion_jobs (id, document_id, status, progress, stage) values (:id, :documentId, 'queued', 0, 'queued')")
                .param("id", jobId).param("documentId", documentId).update();
        Map<String, Object> response = Map.of("document", documentSummary(documentId), "job", job(jobId));
        ingestionExecutor.execute(() -> process(documentId, jobId));
        return response;
    }

    public Map<String, Object> list(AuthService.User user, String spaceId, String status, String query, int limit) {
        requireSpace(user, spaceId);
        StringBuilder sql = new StringBuilder("select id, title, mime_type, status, tags::text as tags, updated_at from documents "
                + "where space_id = :spaceId and deleted_at is null");
        Map<String, Object> params = new LinkedHashMap<>(); params.put("spaceId", spaceId);
        if (status != null && !status.isBlank()) { sql.append(" and status = :status"); params.put("status", status); }
        if (query != null && !query.isBlank()) { sql.append(" and (title ilike :query or content ilike :query)"); params.put("query", "%" + query + "%"); }
        sql.append(" order by updated_at desc limit :limit"); params.put("limit", Math.min(Math.max(limit, 1), 100));
        List<Map<String, Object>> items = jdbc.sql(sql.toString()).params(params).query().listOfRows().stream().map(row -> {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id")); item.put("title", row.get("title")); item.put("mime_type", row.get("mime_type"));
            item.put("status", row.get("status")); item.put("page_count", null); item.put("chunk_count", 0);
            item.put("tags", parseTags(String.valueOf(row.get("tags")))); item.put("updated_at", row.get("updated_at").toString());
            return item;
        }).toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items); result.put("next_cursor", null);
        return result;
    }

    public Map<String, Object> document(AuthService.User user, String documentId) {
        requireDocument(user, documentId);
        return documentSummary(documentId);
    }

    public Map<String, Object> content(AuthService.User user, String documentId) {
        requireDocument(user, documentId);
        return jdbc.sql("select content, mime_type, updated_at from documents where id = :id").param("id", documentId)
                .query((rs, row) -> Map.<String, Object>of("content", rs.getString("content"), "mime_type", rs.getString("mime_type"),
                        "updated_at", rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString())).single();
    }

    public Map<String, Object> job(AuthService.User user, String jobId) {
        String documentId = jdbc.sql("select j.document_id from ingestion_jobs j join documents d on d.id = j.document_id "
                        + "join spaces s on s.id = d.space_id where j.id = :jobId and s.owner_id = :ownerId")
                .param("jobId", jobId).param("ownerId", user.id()).query(String.class).optional()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "导入任务不存在"));
        return job(jobId);
    }

    public Map<String, Object> retry(AuthService.User user, String jobId) {
        String documentId = jdbc.sql("select j.document_id from ingestion_jobs j join documents d on d.id = j.document_id "
                        + "join spaces s on s.id = d.space_id where j.id = :jobId and s.owner_id = :ownerId")
                .param("jobId", jobId).param("ownerId", user.id()).query(String.class).optional()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "导入任务不存在"));
        jdbc.sql("update ingestion_jobs set status = 'queued', progress = 0, stage = 'queued', error_code = null, error_message = null, updated_at = now() where id = :jobId")
                .param("jobId", jobId).update();
        jdbc.sql("update documents set status = 'queued', updated_at = now() where id = :documentId").param("documentId", documentId).update();
        ingestionExecutor.execute(() -> process(documentId, jobId));
        return job(jobId);
    }

    public void delete(AuthService.User user, String documentId) {
        requireDocument(user, documentId);
        jdbc.sql("update documents set deleted_at = now(), status = 'archived', updated_at = now() where id = :id").param("id", documentId).update();
    }

    private void process(String documentId, String jobId) {
        try {
            updateProgress(documentId, jobId, "parsing", 30, "parsing");
            String content = jdbc.sql("select content from documents where id = :id").param("id", documentId).query(String.class).single();
            if (content.isBlank()) throw new IllegalArgumentException("文档没有可解析的文本内容");
            updateProgress(documentId, jobId, "indexing", 80, "indexing");
            jdbc.sql("update documents set status = 'ready', updated_at = now() where id = :id").param("id", documentId).update();
            jdbc.sql("update ingestion_jobs set status = 'ready', progress = 100, stage = 'completed', updated_at = now() where id = :id").param("id", jobId).update();
        } catch (Exception exception) {
            jdbc.sql("update documents set status = 'failed', updated_at = now() where id = :id").param("id", documentId).update();
            jdbc.sql("update ingestion_jobs set status = 'failed', error_code = 'parse_failed', error_message = :message, updated_at = now() where id = :id")
                    .param("id", jobId).param("message", exception.getMessage()).update();
        }
    }

    private void updateProgress(String documentId, String jobId, String documentStatus, int progress, String stage) {
        jdbc.sql("update documents set status = :status, updated_at = now() where id = :id").param("id", documentId).param("status", documentStatus).update();
        jdbc.sql("update ingestion_jobs set status = :status, progress = :progress, stage = :stage, updated_at = now() where id = :id")
                .param("id", jobId).param("status", documentStatus).param("progress", progress).param("stage", stage).update();
    }

    private void requireSpace(AuthService.User user, String spaceId) {
        boolean allowed = jdbc.sql("select exists(select 1 from spaces where id = :id and owner_id = :ownerId)")
                .param("id", spaceId).param("ownerId", user.id()).query(Boolean.class).single();
        if (!allowed) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
    }
    private void requireDocument(AuthService.User user, String documentId) {
        boolean allowed = jdbc.sql("select exists(select 1 from documents d join spaces s on s.id = d.space_id "
                        + "where d.id = :id and d.deleted_at is null and s.owner_id = :ownerId)")
                .param("id", documentId).param("ownerId", user.id()).query(Boolean.class).single();
        if (!allowed) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "文档不存在");
    }
    private Map<String, Object> documentSummary(String documentId) {
        return jdbc.sql("select id, space_id, title, file_name, mime_type, size_bytes, status, created_at, updated_at from documents where id = :id")
                .param("id", documentId).query((rs, row) -> Map.<String, Object>of("id", rs.getString("id"), "space_id", rs.getString("space_id"),
                        "title", rs.getString("title"), "file_name", rs.getString("file_name"), "mime_type", rs.getString("mime_type"),
                        "size_bytes", rs.getLong("size_bytes"), "status", rs.getString("status"),
                        "created_at", rs.getObject("created_at", OffsetDateTime.class).toInstant().toString(),
                        "updated_at", rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString())).single();
    }
    private Map<String, Object> job(String jobId) {
        return jdbc.sql("select id, document_id, status, progress, stage, error_code, error_message, updated_at from ingestion_jobs where id = :id")
                .param("id", jobId).query((rs, row) -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("id", rs.getString("id")); result.put("document_id", rs.getString("document_id"));
                    result.put("status", rs.getString("status")); result.put("progress", rs.getInt("progress"));
                    result.put("stage", rs.getString("stage")); result.put("error_code", rs.getString("error_code"));
                    result.put("error_message", rs.getString("error_message"));
                    result.put("updated_at", rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString());
                    return result;
                }).single();
    }
    private static String extension(String fileName) { int position = fileName.lastIndexOf('.'); return position < 0 ? "" : fileName.substring(position + 1).toLowerCase(); }
    private static String stripExtension(String fileName) { int position = fileName.lastIndexOf('.'); return position < 1 ? fileName : fileName.substring(0, position); }
    private static String sha256(byte[] content) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); } catch (Exception exception) { throw new IllegalStateException(exception); } }
    private JsonNode parseTags(String tags) {
        try {
            JsonNode result = objectMapper.readTree(tags);
            if (!result.isArray()) throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "tags 必须是 JSON 数组");
            return result;
        } catch (JsonProcessingException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_request", "tags 必须是合法 JSON 数组");
        }
    }
}
