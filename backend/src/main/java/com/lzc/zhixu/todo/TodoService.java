package com.lzc.zhixu.todo;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class TodoService {
    private final JdbcClient jdbc;

    public TodoService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> create(AuthService.User user, String spaceId, String requestedId,
            String text, LocalDate day, Boolean completed) {
        requireSpace(user, spaceId);
        String id = requestedId == null || requestedId.isBlank() ? "todo_" + UUID.randomUUID() : requestedId;
        Map<String, Object> existing = find(user, id);
        if (existing != null) {
            if (!spaceId.equals(existing.get("space_id"))) {
                throw new ApiException(HttpStatus.CONFLICT, "id_conflict", "待办 ID 已被占用");
            }
            return existing;
        }
        try {
            jdbc.sql("insert into todos (id, space_id, text, todo_day, completed) "
                            + "values (:id, :spaceId, :text, :day, :completed)")
                    .param("id", id).param("spaceId", spaceId).param("text", text.trim())
                    .param("day", day).param("completed", Boolean.TRUE.equals(completed)).update();
        } catch (DuplicateKeyException exception) {
            existing = find(user, id);
            if (existing == null || !spaceId.equals(existing.get("space_id"))) {
                throw new ApiException(HttpStatus.CONFLICT, "id_conflict", "待办 ID 已被占用");
            }
            return existing;
        }
        return get(user, id);
    }

    public List<Map<String, Object>> list(AuthService.User user, String spaceId, LocalDate day) {
        requireSpace(user, spaceId);
        return jdbc.sql("select id, space_id, text, todo_day, completed, revision, created_at, updated_at "
                        + "from todos where space_id = :spaceId and todo_day = :day and deleted_at is null "
                        + "order by completed asc, created_at asc")
                .param("spaceId", spaceId).param("day", day).query((rs, row) -> todo(rs)).list();
    }

    public Map<String, Object> get(AuthService.User user, String todoId) {
        Map<String, Object> todo = find(user, todoId);
        if (todo == null) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "待办不存在");
        return todo;
    }

    public Map<String, Object> update(AuthService.User user, String todoId, String text, LocalDate day,
            Boolean completed, long revision) {
        Map<String, Object> current = get(user, todoId);
        LocalDate currentDay = LocalDate.parse(String.valueOf(current.get("day")));
        int updated = jdbc.sql("update todos set text = :text, todo_day = :day, completed = :completed, "
                        + "revision = revision + 1, updated_at = now() "
                        + "where id = :id and deleted_at is null and revision = :revision")
                .param("text", text == null ? current.get("text") : text.trim())
                .param("day", day == null ? currentDay : day)
                .param("completed", completed == null ? current.get("completed") : completed)
                .param("id", todoId).param("revision", revision).update();
        if (updated == 0) throw new ApiException(HttpStatus.CONFLICT, "conflict", "待办已被其他操作更新");
        return get(user, todoId);
    }

    public void delete(AuthService.User user, String todoId) {
        get(user, todoId);
        jdbc.sql("update todos set deleted_at = now(), updated_at = now() where id = :id")
                .param("id", todoId).update();
    }

    private void requireSpace(AuthService.User user, String spaceId) {
        boolean allowed = jdbc.sql("select exists(select 1 from spaces where id = :id and owner_id = :ownerId)")
                .param("id", spaceId).param("ownerId", user.id()).query(Boolean.class).single();
        if (!allowed) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
    }

    private Map<String, Object> find(AuthService.User user, String todoId) {
        return jdbc.sql("select t.id, t.space_id, t.text, t.todo_day, t.completed, t.revision, t.created_at, t.updated_at "
                        + "from todos t join spaces s on s.id = t.space_id "
                        + "where t.id = :id and t.deleted_at is null and s.owner_id = :ownerId")
                .param("id", todoId).param("ownerId", user.id())
                .query((rs, row) -> todo(rs)).optional().orElse(null);
    }

    private static Map<String, Object> todo(ResultSet rs) throws SQLException {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", rs.getString("id"));
        result.put("space_id", rs.getString("space_id"));
        result.put("text", rs.getString("text"));
        result.put("day", rs.getObject("todo_day", LocalDate.class).toString());
        result.put("completed", rs.getBoolean("completed"));
        result.put("revision", rs.getLong("revision"));
        result.put("created_at", rs.getObject("created_at", OffsetDateTime.class).toInstant().toString());
        result.put("updated_at", rs.getObject("updated_at", OffsetDateTime.class).toInstant().toString());
        return result;
    }
}
