package com.lzc.zhixu.auth;

import com.lzc.zhixu.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService authService;
    public AuthController(AuthService authService) { this.authService = authService; }

    @PostMapping("/login")
    ApiResponse<Map<String, Object>> login(@Valid @RequestBody LoginRequest request) {
        return ApiResponse.of(tokens(authService.login(request.username(), request.password())));
    }

    @GetMapping("/me")
    ApiResponse<Map<String, Object>> me(@RequestHeader(HttpHeaders.AUTHORIZATION) String authorization) {
        AuthService.User user = authService.requireUser(authorization);
        return ApiResponse.of(Map.of("user", publicUser(user), "spaces", authService.spacesFor(user)));
    }

    @PostMapping("/refresh")
    ApiResponse<Map<String, Object>> refresh(@Valid @RequestBody RefreshRequest request) {
        return ApiResponse.of(tokens(authService.refresh(request.refresh_token())));
    }

    @PostMapping("/logout")
    ApiResponse<Map<String, Object>> logout(@Valid @RequestBody RefreshRequest request) {
        authService.logout(request.refresh_token());
        return ApiResponse.of(Map.of("logged_out", true));
    }

    private static Map<String, Object> tokens(AuthService.LoginResult login) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", publicUser(login.user()));
        result.put("access_token", login.accessToken());
        result.put("refresh_token", login.refreshToken());
        result.put("expires_in", login.expiresIn());
        return result;
    }

    private static Map<String, String> publicUser(AuthService.User user) {
        return Map.of("id", user.id(), "username", user.username(), "display_name", user.displayName());
    }

    record LoginRequest(@NotBlank String username, @NotBlank String password) { }
    record RefreshRequest(@NotBlank String refresh_token) { }
}
