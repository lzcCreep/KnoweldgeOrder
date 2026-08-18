package com.lzc.zhixu.note;

import com.lzc.zhixu.archive.ArchiveService;
import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class NoteService {
    private static final String DRAFT_COLLECTION = "草稿箱";
    private static final String LEGACY_INBOX_COLLECTION = "收件箱";
    private final JdbcClient jdbc;
    private final ArchiveService archiveService;
    public NoteService(JdbcClient jdbc, ArchiveService archiveService) {
        this.jdbc = jdbc;
        this.archiveService = archiveService;
    }

    public Map<String, Object> create(AuthService.User user, String spaceId, String requestedId, String title, String content,
            String collection, Boolean archived, String archiveFolderId) {
        requireSpace(user, spaceId);
        String id = requestedId == null || requestedId.isBlank() ? "nte_" + UUID.randomUUID() : requestedId;
        Map<String, Object> existing = find(user, id);
        if (existing != null) {
            if (!spaceId.equals(existing.get("space_id"))) {
                throw new ApiException(HttpStatus.CONFLICT, "id_conflict", "笔记 ID 已被占用");
            }
            return existing;
        }
        try {
            jdbc.sql("insert into notes_v1 (id, space_id, title, content, collection) values (:id, :spaceId, :title, :content, :collection)")
                    .param("id", id).param("spaceId", spaceId).param("title", title.trim())
                    .param("content", content == null ? "" : content)
                    .param("collection", normalizeCollection(collection)).update();
        } catch (DuplicateKeyException exception) {
            existing = find(user, id);
            if (existing == null || !spaceId.equals(existing.get("space_id"))) {
                throw new ApiException(HttpStatus.CONFLICT, "id_conflict", "笔记 ID 已被占用");
            }
            return existing;
        }
        if (Boolean.TRUE.equals(archived)) archiveService.assign(user, spaceId, "note", id, true, archiveFolderId);
        return get(user, id);
    }

    public Map<String, Object> get(AuthService.User user, String noteId) {
        Map<String, Object> note = find(user, noteId);
        if (note == null) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "笔记不存在");
        return note;
    }

    public Map<String, Object> list(AuthService.User user, String spaceId, String query, int limit) {
        requireSpace(user, spaceId);
        String sql = "select n.id, n.space_id, n.title, n.content, n.collection, n.favorite, n.revision, n.created_at, n.updated_at, "
                + "ai.entity_id as archive_item_id, ai.folder_id as archive_folder_id from notes_v1 n "
                + "left join archive_items ai on ai.entity_type = 'note' and ai.entity_id = n.id "
                + "where n.space_id = :spaceId and n.deleted_at is null and (:query = '' or n.title ilike :pattern or n.content ilike :pattern) "
                + "order by n.updated_at desc limit :limit";
        List<Map<String, Object>> items = jdbc.sql(sql).param("spaceId", spaceId).param("query", query == null ? "" : query)
                .param("pattern", "%" + (query == null ? "" : query) + "%").param("limit", Math.min(Math.max(limit, 1), 100))
                .query((rs, row) -> note(rs)).list();
        Map<String, Object> result = new LinkedHashMap<>(); result.put("items", items); result.put("next_cursor", null); return result;
    }

    public Map<String, Object> update(AuthService.User user, String noteId, String title, String content, String collection,
            Boolean favorite, Boolean archived, String archiveFolderId, long revision) {
        Map<String, Object> current = get(user, noteId);
        int updated = jdbc.sql("update notes_v1 set title = :title, content = :content, collection = :collection, "
                        + "favorite = :favorite, revision = revision + 1, updated_at = now() "
                        + "where id = :id and deleted_at is null and revision = :revision")
                .param("title", title == null ? current.get("title") : title.trim())
                .param("content", content == null ? current.get("content") : content)
                .param("collection", collection == null ? current.get("collection") : normalizeCollection(collection))
                .param("favorite", favorite == null ? current.get("favorite") : favorite)
                .param("id", noteId).param("revision", revision).update();
        if (updated == 0) throw new ApiException(HttpStatus.CONFLICT, "conflict", "笔记已被其他操作更新");
        if (archived != null || archiveFolderId != null) {
            archiveService.assign(user, String.valueOf(current.get("space_id")), "note", noteId,
                    archived == null || archived, archiveFolderId);
        }
        return get(user, noteId);
    }

    public void delete(AuthService.User user, String noteId) {
        get(user, noteId);
        archiveService.removeEntity("note", noteId);
        jdbc.sql("update notes_v1 set deleted_at = now(), updated_at = now() where id = :id").param("id", noteId).update();
    }

    private void requireSpace(AuthService.User user, String spaceId) {
        boolean allowed = jdbc.sql("select exists(select 1 from spaces where id = :id and owner_id = :ownerId)")
                .param("id", spaceId).param("ownerId", user.id()).query(Boolean.class).single();
        if (!allowed) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
    }

    private Map<String, Object> find(AuthService.User user, String noteId) {
        return jdbc.sql("select n.id, n.space_id, n.title, n.content, n.collection, n.favorite, n.revision, n.created_at, n.updated_at, "
                        + "ai.entity_id as archive_item_id, ai.folder_id as archive_folder_id "
                        + "from notes_v1 n join spaces s on s.id = n.space_id "
                        + "left join archive_items ai on ai.entity_type = 'note' and ai.entity_id = n.id "
                        + "where n.id = :id and n.deleted_at is null and s.owner_id = :ownerId")
                .param("id", noteId).param("ownerId", user.id()).query((rs, row) -> note(rs)).optional().orElse(null);
    }

    private static Map<String, Object> note(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", rs.getString("id")); result.put("space_id", rs.getString("space_id"));
        result.put("title", rs.getString("title")); result.put("content", rs.getString("content"));
        result.put("collection", normalizeCollection(rs.getString("collection")));
        result.put("favorite", rs.getBoolean("favorite")); result.put("revision", rs.getLong("revision"));
        result.put("archived", rs.getString("archive_item_id") != null);
        result.put("archive_folder_id", rs.getString("archive_folder_id"));
        result.put("created_at", rs.getObject("created_at", OffsetDateTime.class).toInstant().toString());
        result.put("updated_at", rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString());
        return result;
    }

    private static String normalizeCollection(String collection) {
        if (collection == null || collection.isBlank()) return DRAFT_COLLECTION;
        String normalized = collection.trim();
        return LEGACY_INBOX_COLLECTION.equals(normalized) ? DRAFT_COLLECTION : normalized;
    }
}
