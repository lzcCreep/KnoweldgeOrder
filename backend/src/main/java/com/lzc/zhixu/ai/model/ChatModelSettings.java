package com.lzc.zhixu.ai.model;

public record ChatModelSettings(
        String baseUrl,
        String apiKey,
        String model,
        Double temperature,
        Integer maxTokens) { }
