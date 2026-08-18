package com.lzc.zhixu.ai.api;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.lzc.zhixu.ai.application.ChatCommand;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ChatRequest(
        @JsonProperty("base_url") @NotBlank @Size(max = 1000) String baseUrl,
        @JsonProperty("api_key") @Size(max = 2000) String apiKey,
        @NotBlank @Size(max = 300) String model,
        @JsonProperty("space_id") @Size(max = 64) String spaceId,
        @NotBlank @Size(max = 12000) String prompt,
        @Size(max = 16000) String context,
        @DecimalMin("0.0") @DecimalMax("2.0") Double temperature,
        @JsonProperty("max_tokens") @Min(64) @Max(8192) Integer maxTokens) {

    ChatCommand toCommand() {
        return new ChatCommand(baseUrl, apiKey, model, spaceId, prompt, context, temperature, maxTokens);
    }
}
