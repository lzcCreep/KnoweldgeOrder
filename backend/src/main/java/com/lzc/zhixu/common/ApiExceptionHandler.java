package com.lzc.zhixu.common;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);
    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> api(ApiException exception) {
        return response(exception.status(), exception.code(), exception.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException exception) {
        return response(HttpStatus.BAD_REQUEST, "invalid_request", "请求参数不合法");
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<Map<String, Object>> missingHeader(MissingRequestHeaderException exception) {
        if ("Authorization".equalsIgnoreCase(exception.getHeaderName())) {
            return response(HttpStatus.UNAUTHORIZED, "unauthorized", "未登录或令牌无效");
        }
        return response(HttpStatus.BAD_REQUEST, "invalid_request", "缺少必要请求头");
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<Map<String, Object>> missingParameter(MissingServletRequestParameterException exception) {
        return response(HttpStatus.BAD_REQUEST, "invalid_request", "缺少必要请求参数");
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String, Object>> uploadTooLarge(MaxUploadSizeExceededException exception) {
        return response(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large", "上传文件超过大小限制");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> unexpected(Exception exception) {
        LOG.error("Unhandled API error, request_id={}", RequestId.get(), exception);
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error", "服务内部错误");
    }

    private ResponseEntity<Map<String, Object>> response(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "error", Map.of("code", code, "message", message, "details", Map.of()),
                "request_id", RequestId.get()));
    }
}
