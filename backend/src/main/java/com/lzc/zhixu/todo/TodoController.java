package com.lzc.zhixu.todo;

import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
public class TodoController {
    private final AuthService authService;
    private final TodoService todoService;

    public TodoController(AuthService authService, TodoService todoService) {
        this.authService = authService;
        this.todoService = todoService;
    }

    @GetMapping("/spaces/{spaceId}/todos")
    ApiResponse<Map<String, Object>> list(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId, @RequestParam LocalDate day) {
        List<Map<String, Object>> items = todoService.list(authService.requireUser(authorization), spaceId, day);
        return ApiResponse.of(Map.of("items", items));
    }

    @PostMapping("/spaces/{spaceId}/todos")
    ResponseEntity<ApiResponse<Map<String, Object>>> create(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String spaceId, @Valid @RequestBody CreateTodoRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.of(todoService.create(
                authService.requireUser(authorization), spaceId, request.id(), request.text(), request.day(), request.completed())));
    }

    @PutMapping("/todos/{todoId}")
    ApiResponse<Map<String, Object>> update(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String todoId, @Valid @RequestBody UpdateTodoRequest request) {
        return ApiResponse.of(todoService.update(authService.requireUser(authorization), todoId,
                request.text(), request.day(), request.completed(), request.revision()));
    }

    @DeleteMapping("/todos/{todoId}")
    ApiResponse<Map<String, Boolean>> delete(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @PathVariable String todoId) {
        todoService.delete(authService.requireUser(authorization), todoId);
        return ApiResponse.of(Map.of("deleted", true));
    }

    record CreateTodoRequest(@Size(max = 64) String id, @NotBlank @Size(max = 500) String text,
            @NotNull LocalDate day, Boolean completed) { }

    record UpdateTodoRequest(@Size(max = 500) String text, LocalDate day, Boolean completed,
            @Positive long revision) { }
}
