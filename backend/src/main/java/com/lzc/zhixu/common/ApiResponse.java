package com.lzc.zhixu.common;

public record ApiResponse<T>(T data, String request_id) {
    public static <T> ApiResponse<T> of(T data) {
        return new ApiResponse<>(data, RequestId.get());
    }
}
