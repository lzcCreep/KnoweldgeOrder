package com.lzc.zhixu.common;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class RequestIdFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String requestId = "req_" + UUID.randomUUID();
        RequestId.set(requestId);
        ((HttpServletResponse) response).setHeader("X-Request-Id", requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            RequestId.clear();
        }
    }
}
