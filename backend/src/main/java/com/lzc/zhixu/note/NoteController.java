package com.lzc.zhixu.note;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class NoteController {
    private final AuthService authService;
    private final NoteService noteService;
    public NoteController(AuthService authService, NoteService noteService) { this.authService = authService; this.noteService = noteService; }

    @PostMapping("/spaces/{spaceId}/notes")
    ApiResponse<Map<String, Object>> create(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId, @Valid @RequestBody CreateNoteRequest request) {
        return ApiResponse.of(noteService.create(authService.requireUser(authorization), spaceId,
                request.id(), request.title(), request.content(), request.collection(), request.archived(), request.archive_folder_id()));
    }

    @GetMapping("/spaces/{spaceId}/notes")
    ApiResponse<Map<String, Object>> list(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId, @RequestParam(name = "q", required = false) String query,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.of(noteService.list(authService.requireUser(authorization), spaceId, query, limit));
    }

    @GetMapping("/notes/{noteId}")
    ApiResponse<Map<String, Object>> get(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization, @PathVariable String noteId) {
        return ApiResponse.of(noteService.get(authService.requireUser(authorization), noteId));
    }

    @PutMapping("/notes/{noteId}")
    ApiResponse<Map<String, Object>> update(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String noteId, @Valid @RequestBody UpdateNoteRequest request) {
        return ApiResponse.of(noteService.update(authService.requireUser(authorization), noteId,
                request.title(), request.content(), request.collection(), request.favorite(), request.archived(),
                request.archive_folder_id(), request.revision()));
    }

    @DeleteMapping("/notes/{noteId}")
    ApiResponse<Map<String, Boolean>> delete(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization, @PathVariable String noteId) {
        noteService.delete(authService.requireUser(authorization), noteId);
        return ApiResponse.of(Map.of("deleted", true));
    }

    record CreateNoteRequest(
            @Pattern(regexp = "^nte_[A-Za-z0-9_-]{1,60}$") String id,
            @NotBlank String title,
            String content,
            String collection,
            Boolean archived,
            String archive_folder_id) { }
    record UpdateNoteRequest(String title, String content, String collection, Boolean favorite, Boolean archived,
            String archive_folder_id, @Positive long revision) { }
}
