package com.lzc.zhixu.space;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiException;
import com.lzc.zhixu.common.ApiResponse;
import com.lzc.zhixu.rag.RagPipeline;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PutMapping;

@RestController
@RequestMapping("/api/v1/spaces")
public class SpaceController {
    private final JdbcClient jdbc;
    private final AuthService authService;
    private final RagPipeline ragPipeline;
    public SpaceController(JdbcClient jdbc, AuthService authService, RagPipeline ragPipeline) {
        this.jdbc = jdbc;
        this.authService = authService;
        this.ragPipeline = ragPipeline;
    }

    @GetMapping
    ApiResponse<Map<String, List<Map<String, Object>>>> list(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        AuthService.User user = authService.requireUser(authorization);
        return ApiResponse.of(Map.of("items", authService.spacesFor(user)));
    }

    @PostMapping
    ApiResponse<Map<String, Object>> create(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @Valid @RequestBody CreateSpaceRequest request) {
        AuthService.User user = authService.requireUser(authorization);
        String id = "spc_" + UUID.randomUUID();
        try {
            jdbc.sql("insert into spaces (id, owner_id, name) values (:id, :ownerId, :name)")
                    .param("id", id).param("ownerId", user.id()).param("name", request.name().trim()).update();
        } catch (Exception exception) {
            throw new ApiException(HttpStatus.CONFLICT, "conflict", "知识空间名称已存在");
        }
        return ApiResponse.of(Map.of("id", id, "name", request.name().trim(), "role", "owner"));
    }

    @DeleteMapping("/{spaceId}")
    ApiResponse<Map<String, Boolean>> delete(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId) {
        AuthService.User user = authService.requireUser(authorization);
        int count = jdbc.sql("select count(*) from spaces where id = :id and owner_id = :ownerId")
                .param("id", spaceId).param("ownerId", user.id()).query(Integer.class).single();
        if (count == 0) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
        ragPipeline.removeSpace(spaceId);
        jdbc.sql("delete from ingestion_jobs where document_id in (select id from documents where space_id = :id)")
                .param("id", spaceId).update();
        jdbc.sql("delete from documents where space_id = :id").param("id", spaceId).update();
        jdbc.sql("delete from notes_v1 where space_id = :id").param("id", spaceId).update();
        jdbc.sql("delete from archive_items where space_id = :id").param("id", spaceId).update();
        jdbc.sql("delete from archive_folders where space_id = :id").param("id", spaceId).update();
        jdbc.sql("delete from spaces where id = :id and owner_id = :ownerId")
                .param("id", spaceId).param("ownerId", user.id()).update();
        return ApiResponse.of(Map.of("deleted", true));
    }

    @PutMapping("/{spaceId}")
    ApiResponse<Map<String, Object>> rename(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId, @Valid @RequestBody RenameSpaceRequest request) {
        AuthService.User user = authService.requireUser(authorization);
        try {
            int updated = jdbc.sql("update spaces set name = :name where id = :id and owner_id = :ownerId")
                    .param("name", request.name().trim()).param("id", spaceId).param("ownerId", user.id()).update();
            if (updated == 0) throw new ApiException(HttpStatus.NOT_FOUND, "not_found", "知识空间不存在");
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new ApiException(HttpStatus.CONFLICT, "conflict", "知识空间名称已存在");
        }
        return ApiResponse.of(Map.of("id", spaceId, "name", request.name().trim(), "role", "owner"));
    }

    record CreateSpaceRequest(@NotBlank String name) { }
    record RenameSpaceRequest(@NotBlank String name) { }
}
