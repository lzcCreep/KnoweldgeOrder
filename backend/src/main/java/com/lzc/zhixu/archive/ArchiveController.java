package com.lzc.zhixu.archive;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ArchiveController {
    private final AuthService authService;
    private final ArchiveService archiveService;

    public ArchiveController(AuthService authService, ArchiveService archiveService) {
        this.authService = authService;
        this.archiveService = archiveService;
    }

    @GetMapping("/spaces/{spaceId}/archive")
    ApiResponse<Map<String, Object>> snapshot(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId) {
        return ApiResponse.of(archiveService.snapshot(authService.requireUser(authorization), spaceId));
    }

    @PostMapping("/spaces/{spaceId}/archive/folders")
    ApiResponse<Map<String, Object>> createFolder(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId, @Valid @RequestBody FolderRequest request) {
        return ApiResponse.of(archiveService.createFolder(authService.requireUser(authorization), spaceId,
                request.id(), request.parent_id(), request.name()));
    }

    @PutMapping("/archive/folders/{folderId}")
    ApiResponse<Map<String, Object>> renameFolder(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String folderId, @Valid @RequestBody RenameFolderRequest request) {
        return ApiResponse.of(archiveService.renameFolder(authService.requireUser(authorization), folderId, request.name()));
    }

    @DeleteMapping("/archive/folders/{folderId}")
    ApiResponse<Map<String, Boolean>> deleteFolder(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String folderId) {
        archiveService.deleteFolder(authService.requireUser(authorization), folderId);
        return ApiResponse.of(Map.of("deleted", true));
    }

    record FolderRequest(@jakarta.validation.constraints.Pattern(regexp = "^arf_[A-Za-z0-9_-]{1,60}$") String id,
            @Size(max = 64) String parent_id, @NotBlank @Size(max = 80) String name) { }
    record RenameFolderRequest(@NotBlank @Size(max = 80) String name) { }
}
