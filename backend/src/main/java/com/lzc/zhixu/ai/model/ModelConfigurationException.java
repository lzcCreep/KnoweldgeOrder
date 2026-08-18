package com.lzc.zhixu.ai.model;

public class ModelConfigurationException extends RuntimeException {
    private final String code;

    public ModelConfigurationException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
