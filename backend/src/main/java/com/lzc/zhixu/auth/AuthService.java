package com.lzc.zhixu.auth;

import com.lzc.zhixu.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcClient jdbc;
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final Duration accessTtl;
    private final Duration refreshTtl;

    public AuthService(JdbcClient jdbc,
            @Value("${zhixu.auth.access-token-ttl}") long accessTtlSeconds,
            @Value("${zhixu.auth.refresh-token-ttl}") long refreshTtlSeconds) {
        this.jdbc = jdbc;
        this.accessTtl = Duration.ofSeconds(accessTtlSeconds);
        this.refreshTtl = Duration.ofSeconds(refreshTtlSeconds);
    }

    public LoginResult login(String username, String password) {
        User user = jdbc.sql("select id, username, password_hash, display_name from users where username = :username")
                .param("username", username).query((rs, row) -> new User(rs.getString("id"), rs.getString("username"),
                        rs.getString("password_hash"), rs.getString("display_name"))).optional().orElse(null);
        if (user == null || !passwordEncoder.matches(password, user.passwordHash())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "invalid_credentials", "用户名或密码错误");
        }
        return issueTokens(user);
    }

    public LoginResult refresh(String refreshToken) {
        Session session = findSessionByRefreshToken(refreshToken);
        if (session == null || session.revokedAt() != null || !session.refreshExpiresAt().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "会话已失效");
        }
        jdbc.sql("update auth_sessions set revoked_at = now() where id = :id").param("id", session.id()).update();
        User user = findUser(session.userId());
        return issueTokens(user);
    }

    public void logout(String refreshToken) {
        jdbc.sql("update auth_sessions set revoked_at = now() where refresh_token_hash = :token")
                .param("token", sha256(refreshToken)).update();
    }

    public User requireUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "未登录或令牌无效");
        }
        String token = authorization.substring("Bearer ".length()).trim();
        Session session = jdbc.sql("select id, user_id, access_expires_at, refresh_expires_at, revoked_at from auth_sessions "
                        + "where access_token_hash = :token")
                .param("token", sha256(token)).query((rs, row) -> new Session(rs.getString("id"), rs.getString("user_id"),
                        instant(rs.getObject("access_expires_at", OffsetDateTime.class)), instant(rs.getObject("refresh_expires_at", OffsetDateTime.class)),
                        instant(rs.getObject("revoked_at", OffsetDateTime.class)))).optional().orElse(null);
        if (session == null || session.revokedAt() != null || !session.accessExpiresAt().isAfter(Instant.now())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized", "未登录或令牌无效");
        }
        return findUser(session.userId());
    }

    public List<Map<String, Object>> spacesFor(User user) {
        return jdbc.sql("select id, name, 'owner' as role from spaces where owner_id = :ownerId order by created_at")
                .param("ownerId", user.id()).query().listOfRows();
    }

    private LoginResult issueTokens(User user) {
        String accessToken = randomToken("atk_");
        String refreshToken = randomToken("rft_");
        Instant now = Instant.now();
        jdbc.sql("insert into auth_sessions (id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at) "
                        + "values (:id, :userId, :accessTokenHash, :refreshTokenHash, :accessExpiresAt, :refreshExpiresAt)")
                .param("id", id("ses_")).param("userId", user.id()).param("accessTokenHash", sha256(accessToken))
                .param("refreshTokenHash", sha256(refreshToken))
                .param("accessExpiresAt", OffsetDateTime.ofInstant(now.plus(accessTtl), ZoneOffset.UTC))
                .param("refreshExpiresAt", OffsetDateTime.ofInstant(now.plus(refreshTtl), ZoneOffset.UTC)).update();
        return new LoginResult(user, accessToken, refreshToken, accessTtl.toSeconds());
    }

    private User findUser(String id) {
        return jdbc.sql("select id, username, password_hash, display_name from users where id = :id").param("id", id)
                .query((rs, row) -> new User(rs.getString("id"), rs.getString("username"), rs.getString("password_hash"),
                        rs.getString("display_name"))).single();
    }

    private Session findSessionByRefreshToken(String refreshToken) {
        return jdbc.sql("select id, user_id, access_expires_at, refresh_expires_at, revoked_at from auth_sessions "
                        + "where refresh_token_hash = :token").param("token", sha256(refreshToken))
                .query((rs, row) -> new Session(rs.getString("id"), rs.getString("user_id"),
                        instant(rs.getObject("access_expires_at", OffsetDateTime.class)), instant(rs.getObject("refresh_expires_at", OffsetDateTime.class)),
                        instant(rs.getObject("revoked_at", OffsetDateTime.class)))).optional().orElse(null);
    }

    private static String id(String prefix) { return prefix + UUID.randomUUID(); }
    private static Instant instant(OffsetDateTime value) { return value == null ? null : value.toInstant(); }
    private static String randomToken(String prefix) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    private static String sha256(String value) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    public record User(String id, String username, String passwordHash, String displayName) { }
    private record Session(String id, String userId, Instant accessExpiresAt, Instant refreshExpiresAt, Instant revokedAt) { }
    public record LoginResult(User user, String accessToken, String refreshToken, long expiresIn) { }
}
