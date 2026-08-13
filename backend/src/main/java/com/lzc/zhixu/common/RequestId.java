package com.lzc.zhixu.common;

import java.util.UUID;

public final class RequestId {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private RequestId() { }

    public static String get() {
        String value = CURRENT.get();
        return value == null ? "req_" + UUID.randomUUID() : value;
    }

    public static void set(String value) { CURRENT.set(value); }
    public static void clear() { CURRENT.remove(); }
}
