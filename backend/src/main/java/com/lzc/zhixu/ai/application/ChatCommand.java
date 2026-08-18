package com.lzc.zhixu.ai.application;

public record ChatCommand(
        String baseUrl,
        String apiKey,
        String model,
        String spaceId,
        String prompt,
        String clientContext,
        Double temperature,
        Integer maxTokens) { }
