package com.lzc.zhixu.archive;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class ArchiveService {
    private final JdbcClient jdbc;

    public ArchiveService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> snapshot(AuthService.User user, String spaceId) {
        requireSpace(user, spaceId);
        List<Map<String, Object>> folders = jdbc.sql(
                        "select id, space_id, parent_id, name, created_at, updated_at from archive_folders "
                                + "where space_id = :spaceId order by created_at, name")
                .param("spaceId", spaceId).query().listOfRows();
        List<Map<String, Object>> items = jdbc.sql(
                        "select ai.entity_type, ai.entity_id, ai.folder_id, ai.archived_at, n.title, n.collection, n.favorite, n.updated_at "
                                + "from archive_items ai join notes_v1 n on ai.entity_type = 'note' and n.id = ai.entity_id "
                                + "where ai.space_id = :spaceId and n.deleted_at is null "
                                + "union all "
                                + "select ai.entity_type, ai.entity_id, ai.folder_id, ai.archived_at, d.title, d.collection, d.favorite, d.updated_at "
                                + "from archive_items ai join documents d on ai.entity_type = 'document' and d.id = ai.entity_id "
                                + "where ai.space_id = :spaceId and d.deleted_at is null order by updated_at desc")
                .param("spaceId", spaceId).query().listOfRows();
        return Map.of("folders", folders, "items", items);
    }

    public Map<String, Object> createFolder(AuthService.User user, String spaceId, String requestedId, String parentId, String name) {
        requireSpace(user, spaceId);
        requireParent(spaceId, parentId);
        String id = requestedId == null || requestedId.isBlank() ? "arf_" + UUID.randomUUID() : requestedId.trim();
        if (!id.matches("arf_[A-Za-z0-9_-]{1,60}")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_archive_folder", "归档目录 ID 不合法");
        }
        try {
            jdbc.sql("insert into archive_folders (id, space_id, parent_id, name) values (:id, :spaceId, :parentId, :name)")
                    .param("id", id).param("spaceId", spaceId).param("parentId", blankToNull(parentId))
                    .param("name", normalizedName(name)).update();
        } catch (DataIntegrityViolationException exception) {
            Map<String, Object> existing = jdbc.sql("select f.id, f.space_id, f.parent_id, f.name, f.created_at, f.updated_at "
                            + "from archive_folders f join spaces s on s.id = f.space_id "
                            + "where f.id = :id and s.owner_id = :ownerId")
                    .param("id", id).param("ownerId", user.id()).query().listOfRows().stream().findFirst().orElse(null);
            if (existing != null && String.valueOf(existing.get("name")).equals(normalizedName(name))
                    && java.util.Objects.equals(existing.get("parent_id"), blankToNull(parentId))) return existing;
            throw new ApiException(HttpStatus.CONFLICT, "archive_folder_exists", "同一级下已存在同名归档目录");
        }
        return folder(user, id);
    }

    public Map<String, Object> renameFolder(AuthService.User user, String folderId, String name) {
        Map<String, Object> current = folder(user, folderId);
        try {
            jdbc.sql("update archive_folders set name = :name, updated_at = now() where id = :id")
                    .param("name", normalizedName(name)).param("id", folderId).update();
        } catch (DataIntegrityViolationException exception) {
            throw new ApiException(HttpStatus.CONFLICT, "archive_folder_exists", "同一级下已存在同名归档目录");
        }
        return folder(user, String.valueOf(current.get("id")));
    }

    public void deleteFolder(AuthService.User user, String folderId) {
        folder(user, folderId);
        jdbc.sql("delete from archive_folders where id = :id").param("id", folderId).update();
    }

    public void assign(AuthService.User user, String spaceId, String entityType, String entityId,
            boolean archived, String folderId) {
        requireSpace(user, spaceId);
        if (!"note".equals(entityType) && !"document".equals(entityType)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_archive_entity", "不支持的归档内容类型");
        }
        if (!archived) {
            jdbc.sql("delete from archive_items where entity_type = :type and entity_id = :entityId")
                    .param("type", entityType).param("entityId", entityId).update();
            return;
        }
        requireParent(spaceId, folderId);
        jdbc.sql("insert into archive_items (space_id, folder_id, entity_type, entity_id) "
                        + "values (:spaceId, :folderId, :type, :entityId) "
                        + "on conflict(entity_type, entity_id) do update set "
                        + "space_id = excluded.space_id, folder_id = excluded.folder_id, archived_at = now()")
                .param("spaceId", spaceId).param("folderId", blankToNull(folderId))
                .param("type", entityType).param("entityId", entityId).update();
    }

    public void removeEntity(String entityType, String entityId) {
        jdbc.sql("delete from archive_items where entity_type = :type and entity_id = :entityId")
                .param("type", entityType).param("entityId", entityId).update();
    }

    private Map<String, Object> folder(AuthService.User user, String folderId) {
        return jdbc.sql("select f.id, f.space_id, f.parent_id, f.name, f.created_at, f.updated_at "
                        + "from archive_folders f join spaces s on s.id = f.space_id "
                        + "where f.id = :id and s.owner_id = :ownerId")
                .param("id", folderId).param("ownerId", user.id()).query().listOfRows().stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "not_found", "归档目录不存在"));
    }

    private void requireSpace(AuthService.User user, String spaceId) {
        boolean allowed = jdbc.sql("select exists(select 1 from spaces where id = :id and owner_id = :ownerId)")
                .param("id", spaceId).param("ownerId", user.id()).query(Boolean.class).single();
        if (!allowed) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
    }

    private void requireParent(String spaceId, String parentId) {
        String normalized = blankToNull(parentId);
        if (normalized == null) return;
        boolean exists = jdbc.sql("select exists(select 1 from archive_folders where id = :id and space_id = :spaceId)")
                .param("id", normalized).param("spaceId", spaceId).query(Boolean.class).single();
        if (!exists) throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_archive_folder", "归档目录不属于当前知识空间");
    }

    private static String normalizedName(String name) {
        String normalized = name == null ? "" : name.trim();
        if (normalized.isEmpty() || normalized.length() > 80 || normalized.contains("/") || normalized.contains("\\")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "invalid_archive_folder", "目录名称需为 1-80 个字符，且不能包含路径分隔符");
        }
        return normalized;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
