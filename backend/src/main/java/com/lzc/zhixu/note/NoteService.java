package com.lzc.zhixu.note;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class NoteService {
    private final JdbcClient jdbc;
    public NoteService(JdbcClient jdbc) { this.jdbc = jdbc; }

    public Map<String, Object> create(AuthService.User user, String spaceId, String title, String content) {
        requireSpace(user, spaceId);
        String id = "nte_" + UUID.randomUUID();
        jdbc.sql("insert into notes_v1 (id, space_id, title, content) values (:id, :spaceId, :title, :content)")
                .param("id", id).param("spaceId", spaceId).param("title", title.trim())
                .param("content", content == null ? "" : content).update();
        return get(user, id);
    }

    public Map<String, Object> get(AuthService.User user, String noteId) {
        return jdbc.sql("select n.id, n.space_id, n.title, n.content, n.favorite, n.revision, n.created_at, n.updated_at "
                        + "from notes_v1 n join spaces s on s.id = n.space_id where n.id = :id and n.deleted_at is null and s.owner_id = :ownerId")
                .param("id", noteId).param("ownerId", user.id()).query((rs, row) -> note(rs)).optional()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "笔记不存在"));
    }

    public Map<String, Object> list(AuthService.User user, String spaceId, String query, int limit) {
        requireSpace(user, spaceId);
        String sql = "select id, space_id, title, content, favorite, revision, created_at, updated_at from notes_v1 "
                + "where space_id = :spaceId and deleted_at is null and (:query = '' or title ilike :pattern or content ilike :pattern) "
                + "order by updated_at desc limit :limit";
        List<Map<String, Object>> items = jdbc.sql(sql).param("spaceId", spaceId).param("query", query == null ? "" : query)
                .param("pattern", "%" + (query == null ? "" : query) + "%").param("limit", Math.min(Math.max(limit, 1), 100))
                .query((rs, row) -> note(rs)).list();
        Map<String, Object> result = new LinkedHashMap<>(); result.put("items", items); result.put("next_cursor", null); return result;
    }

    public Map<String, Object> update(AuthService.User user, String noteId, String title, String content, Boolean favorite, long revision) {
        Map<String, Object> current = get(user, noteId);
        int updated = jdbc.sql("update notes_v1 set title = :title, content = :content, "
                        + "favorite = :favorite, revision = revision + 1, updated_at = now() "
                        + "where id = :id and deleted_at is null and revision = :revision")
                .param("title", title == null ? current.get("title") : title.trim())
                .param("content", content == null ? current.get("content") : content)
                .param("favorite", favorite == null ? current.get("favorite") : favorite)
                .param("id", noteId).param("revision", revision).update();
        if (updated == 0) throw new ApiException(HttpStatus.CONFLICT, "conflict", "笔记已被其他操作更新");
        return get(user, noteId);
    }

    public void delete(AuthService.User user, String noteId) {
        get(user, noteId);
        jdbc.sql("update notes_v1 set deleted_at = now(), updated_at = now() where id = :id").param("id", noteId).update();
    }

    private void requireSpace(AuthService.User user, String spaceId) {
        boolean allowed = jdbc.sql("select exists(select 1 from spaces where id = :id and owner_id = :ownerId)")
                .param("id", spaceId).param("ownerId", user.id()).query(Boolean.class).single();
        if (!allowed) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
    }

    private static Map<String, Object> note(java.sql.ResultSet rs) throws java.sql.SQLException {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", rs.getString("id")); result.put("space_id", rs.getString("space_id"));
        result.put("title", rs.getString("title")); result.put("content", rs.getString("content"));
        result.put("favorite", rs.getBoolean("favorite")); result.put("revision", rs.getLong("revision"));
        result.put("created_at", rs.getObject("created_at", OffsetDateTime.class).toInstant().toString());
        result.put("updated_at", rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString());
        return result;
    }
}
