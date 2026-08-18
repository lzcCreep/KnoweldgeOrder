package com.lzc.zhixu.ai.api;

import com.lzc.zhixu.ai.application.AiChatService;
import com.lzc.zhixu.auth.AuthService;
import com.lzc.zhixu.common.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ai")
public class AiController {
    private final AuthService authService;
    private final AiChatService aiChatService;

    public AiController(AuthService authService, AiChatService aiChatService) {
        this.authService = authService;
        this.aiChatService = aiChatService;
    }

    @PostMapping("/chat")
    ApiResponse<ChatResponse> chat(
            @RequestHeader(HttpHeaders.AUTHORIZATION) String authorization,
            @Valid @RequestBody ChatRequest request) {
        return ApiResponse.of(ChatResponse.from(
                aiChatService.chat(authService.requireUser(authorization), request.toCommand())));
    }
}
