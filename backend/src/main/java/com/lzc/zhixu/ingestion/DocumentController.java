package com.lzc.zhixu.ingestion;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiResponse;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
public class DocumentController {
    private final AuthService authService;
    private final DocumentService documentService;
    public DocumentController(AuthService authService, DocumentService documentService) {
        this.authService = authService;
        this.documentService = documentService;
    }

    @PostMapping("/spaces/{spaceId}/documents")
    ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId,
            @RequestParam MultipartFile file,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String tags,
            @RequestParam(name = "source_url", required = false) String sourceUrl) {
        AuthService.User user = authService.requireUser(authorization);
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(ApiResponse.of(documentService.create(user, spaceId, file, title, tags, sourceUrl)));
    }

    @GetMapping("/spaces/{spaceId}/documents")
    ApiResponse<Map<String, Object>> list(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId,
            @RequestParam(required = false) String status,
            @RequestParam(name = "q", required = false) String query,
            @RequestParam(defaultValue = "20") int limit) {
        return ApiResponse.of(documentService.list(authService.requireUser(authorization), spaceId, status, query, limit));
    }

    @GetMapping("/documents/{documentId}")
    ApiResponse<Map<String, Object>> document(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String documentId) {
        return ApiResponse.of(documentService.document(authService.requireUser(authorization), documentId));
    }

    @GetMapping("/documents/{documentId}/content")
    ApiResponse<Map<String, Object>> content(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String documentId) {
        return ApiResponse.of(documentService.content(authService.requireUser(authorization), documentId));
    }

    @DeleteMapping("/documents/{documentId}")
    ApiResponse<Map<String, Boolean>> delete(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String documentId) {
        documentService.delete(authService.requireUser(authorization), documentId);
        return ApiResponse.of(Map.of("deleted", true));
    }

    @GetMapping("/ingestion-jobs/{jobId}")
    ApiResponse<Map<String, Object>> job(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String jobId) {
        return ApiResponse.of(documentService.job(authService.requireUser(authorization), jobId));
    }

    @PostMapping("/ingestion-jobs/{jobId}/retry")
    ApiResponse<Map<String, Object>> retry(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String jobId) {
        return ApiResponse.of(documentService.retry(authService.requireUser(authorization), jobId));
    }
}
