/**
 * OpenAI Format Converter
 * Converts between OpenAI Chat Completions API format and Anthropic Messages API format
 * This enables Cursor IDE and other OpenAI-compatible clients to use this proxy
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Convert OpenAI Chat Completions request to Anthropic Messages API format
 * 
 * @param {Object} openaiRequest - OpenAI format request
 * @returns {Object} Anthropic format request
 */
export function convertOpenAIToAnthropic(openaiRequest) {
    const {
        model,
        messages,
        max_tokens,
        max_completion_tokens,
        temperature,
        top_p,
        stop,
        stream,
        tools,
        tool_choice,
        functions,
        function_call
    } = openaiRequest;

    // Extract system message (OpenAI includes it in messages array)
    let systemContent = null;
    const nonSystemMessages = [];

    for (const msg of messages || []) {
        if (msg.role === 'system') {
            // Accumulate system messages
            if (systemContent === null) {
                systemContent = typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content?.map(c => c.text || '').join('\n');
            } else {
                const content = typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content?.map(c => c.text || '').join('\n');
                systemContent += '\n\n' + content;
            }
        } else {
            nonSystemMessages.push(msg);
        }
    }

    // Convert messages to Anthropic format
    const anthropicMessages = nonSystemMessages.map(msg => {
        return {
            role: convertOpenAIRoleToAnthropic(msg.role),
            content: convertOpenAIContentToAnthropic(msg)
        };
    });

    // Build Anthropic request
    const anthropicRequest = {
        model: model,
        messages: anthropicMessages,
        max_tokens: max_completion_tokens || max_tokens || 4096,
        stream: stream
    };

    // Add system if present
    if (systemContent) {
        anthropicRequest.system = systemContent;
    }

    // Add optional parameters
    if (temperature !== undefined) {
        anthropicRequest.temperature = temperature;
    }
    if (top_p !== undefined) {
        anthropicRequest.top_p = top_p;
    }
    if (stop) {
        anthropicRequest.stop_sequences = Array.isArray(stop) ? stop : [stop];
    }

    // Convert tools (OpenAI format) to Anthropic format
    if (tools && tools.length > 0) {
        anthropicRequest.tools = tools.map(tool => {
            if (tool.type === 'function') {
                return {
                    name: tool.function.name,
                    description: tool.function.description || '',
                    input_schema: tool.function.parameters || { type: 'object' }
                };
            }
            return tool;
        });
    }

    // Handle legacy functions format
    if (functions && functions.length > 0) {
        anthropicRequest.tools = functions.map(fn => ({
            name: fn.name,
            description: fn.description || '',
            input_schema: fn.parameters || { type: 'object' }
        }));
    }

    // Convert tool_choice
    if (tool_choice) {
        if (tool_choice === 'auto') {
            anthropicRequest.tool_choice = { type: 'auto' };
        } else if (tool_choice === 'none') {
            // Anthropic doesn't have a direct equivalent, omit tools
            delete anthropicRequest.tools;
        } else if (tool_choice === 'required') {
            anthropicRequest.tool_choice = { type: 'any' };
        } else if (typeof tool_choice === 'object' && tool_choice.function) {
            anthropicRequest.tool_choice = {
                type: 'tool',
                name: tool_choice.function.name
            };
        }
    }

    // Handle legacy function_call
    if (function_call) {
        if (function_call === 'auto') {
            anthropicRequest.tool_choice = { type: 'auto' };
        } else if (function_call === 'none') {
            delete anthropicRequest.tools;
        } else if (typeof function_call === 'object' && function_call.name) {
            anthropicRequest.tool_choice = {
                type: 'tool',
                name: function_call.name
            };
        }
    }

    // Enable thinking for thinking models
    if (model && (model.includes('thinking') || model.includes('gemini-3'))) {
        anthropicRequest.thinking = {
            type: 'enabled',
            budget_tokens: 16000
        };
    }

    logger.debug('[OpenAI→Anthropic] Converted request:', JSON.stringify(anthropicRequest).substring(0, 500));

    return anthropicRequest;
}

/**
 * Convert OpenAI role to Anthropic role
 */
function convertOpenAIRoleToAnthropic(role) {
    switch (role) {
        case 'user':
            return 'user';
        case 'assistant':
            return 'assistant';
        case 'tool':
            return 'user'; // Tool results come from user in Anthropic
        case 'function':
            return 'user'; // Legacy function results
        default:
            return 'user';
    }
}

/**
 * Convert OpenAI message content to Anthropic format
 */
function convertOpenAIContentToAnthropic(msg) {
    // Handle tool/function results
    if (msg.role === 'tool' || msg.role === 'function') {
        return [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || msg.name || `tool_${crypto.randomBytes(8).toString('hex')}`,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        }];
    }

    // Handle assistant messages with tool_calls
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const content = [];
        
        // Add text content if present
        if (msg.content) {
            content.push({
                type: 'text',
                text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            });
        }

        // Add tool_use blocks
        for (const toolCall of msg.tool_calls) {
            content.push({
                type: 'tool_use',
                id: toolCall.id || `toolu_${crypto.randomBytes(12).toString('hex')}`,
                name: toolCall.function?.name || toolCall.name,
                input: typeof toolCall.function?.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function?.arguments || {}
            });
        }

        return content;
    }

    // Handle legacy function_call in assistant messages
    if (msg.role === 'assistant' && msg.function_call) {
        const content = [];

        if (msg.content) {
            content.push({
                type: 'text',
                text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            });
        }

        content.push({
            type: 'tool_use',
            id: `toolu_${crypto.randomBytes(12).toString('hex')}`,
            name: msg.function_call.name,
            input: typeof msg.function_call.arguments === 'string'
                ? JSON.parse(msg.function_call.arguments)
                : msg.function_call.arguments || {}
        });

        return content;
    }

    // Handle standard text content
    if (typeof msg.content === 'string') {
        return msg.content;
    }

    // Handle array content (images, etc.)
    if (Array.isArray(msg.content)) {
        return msg.content.map(part => {
            if (part.type === 'text') {
                return { type: 'text', text: part.text };
            }
            if (part.type === 'image_url') {
                // Convert OpenAI image format to Anthropic
                const url = part.image_url?.url || part.image_url;
                if (url.startsWith('data:')) {
                    // Base64 encoded image
                    const matches = url.match(/^data:(.+);base64,(.+)$/);
                    if (matches) {
                        return {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: matches[1],
                                data: matches[2]
                            }
                        };
                    }
                }
                // URL-based image
                return {
                    type: 'image',
                    source: {
                        type: 'url',
                        url: url
                    }
                };
            }
            return part;
        });
    }

    return msg.content || '';
}

/**
 * Convert Anthropic Messages API response to OpenAI Chat Completions format
 * 
 * @param {Object} anthropicResponse - Anthropic format response
 * @param {string} model - The model used
 * @param {boolean} isStreaming - Whether this is a streaming response
 * @returns {Object} OpenAI format response
 */
export function convertAnthropicToOpenAI(anthropicResponse, model, isStreaming = false) {
    const id = `chatcmpl-${crypto.randomBytes(16).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);

    // Extract text content
    const textContent = (anthropicResponse.content || [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

    // Extract tool calls
    const toolCalls = (anthropicResponse.content || [])
        .filter(block => block.type === 'tool_use')
        .map((block, index) => ({
            id: block.id || `call_${crypto.randomBytes(12).toString('hex')}`,
            type: 'function',
            function: {
                name: block.name,
                arguments: JSON.stringify(block.input || {})
            }
        }));

    // Build message object
    const message = {
        role: 'assistant',
        content: textContent || null
    };

    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
        // When there are tool calls, content should be null if empty
        if (!textContent) {
            message.content = null;
        }
    }

    // Convert stop reason
    let finishReason = 'stop';
    if (anthropicResponse.stop_reason === 'tool_use') {
        finishReason = 'tool_calls';
    } else if (anthropicResponse.stop_reason === 'max_tokens') {
        finishReason = 'length';
    } else if (anthropicResponse.stop_reason === 'stop_sequence') {
        finishReason = 'stop';
    }

    const response = {
        id: id,
        object: isStreaming ? 'chat.completion.chunk' : 'chat.completion',
        created: created,
        model: model || anthropicResponse.model,
        choices: [{
            index: 0,
            message: message,
            finish_reason: finishReason
        }],
        usage: {
            prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
            completion_tokens: anthropicResponse.usage?.output_tokens || 0,
            total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
        }
    };

    // Add system fingerprint for compatibility
    response.system_fingerprint = `fp_${crypto.randomBytes(8).toString('hex')}`;

    return response;
}

/**
 * Convert Anthropic streaming event to OpenAI SSE chunk format
 * 
 * @param {Object} anthropicEvent - Anthropic SSE event
 * @param {string} model - The model used
 * @param {Object} state - Mutable state object for tracking streaming
 * @returns {Object|null} OpenAI format SSE chunk or null if should be skipped
 */
export function convertAnthropicStreamEventToOpenAI(anthropicEvent, model, state) {
    const created = Math.floor(Date.now() / 1000);
    
    // Initialize or reuse message ID
    if (!state.id) {
        state.id = `chatcmpl-${crypto.randomBytes(16).toString('hex')}`;
    }

    const baseChunk = {
        id: state.id,
        object: 'chat.completion.chunk',
        created: created,
        model: model,
        system_fingerprint: state.fingerprint || `fp_${crypto.randomBytes(8).toString('hex')}`,
        choices: [{
            index: 0,
            delta: {},
            finish_reason: null
        }]
    };

    // Store fingerprint for consistency
    state.fingerprint = baseChunk.system_fingerprint;

    switch (anthropicEvent.type) {
        case 'message_start':
            // Send role on first chunk
            baseChunk.choices[0].delta = { role: 'assistant', content: '' };
            return baseChunk;

        case 'content_block_start':
            if (anthropicEvent.content_block?.type === 'text') {
                // Text block starting, no content yet
                return null;
            }
            if (anthropicEvent.content_block?.type === 'tool_use') {
                // Tool use starting
                if (!state.toolCalls) state.toolCalls = [];
                const toolIndex = state.toolCalls.length;
                state.toolCalls.push({
                    id: anthropicEvent.content_block.id,
                    name: anthropicEvent.content_block.name,
                    arguments: ''
                });
                baseChunk.choices[0].delta = {
                    tool_calls: [{
                        index: toolIndex,
                        id: anthropicEvent.content_block.id,
                        type: 'function',
                        function: {
                            name: anthropicEvent.content_block.name,
                            arguments: ''
                        }
                    }]
                };
                return baseChunk;
            }
            if (anthropicEvent.content_block?.type === 'thinking') {
                // Skip thinking blocks in OpenAI format (not supported)
                state.inThinking = true;
                return null;
            }
            return null;

        case 'content_block_delta':
            if (state.inThinking) {
                // Skip thinking content
                return null;
            }
            if (anthropicEvent.delta?.type === 'text_delta') {
                baseChunk.choices[0].delta = { content: anthropicEvent.delta.text };
                return baseChunk;
            }
            if (anthropicEvent.delta?.type === 'input_json_delta') {
                // Tool arguments streaming
                const toolIndex = (state.toolCalls?.length || 1) - 1;
                if (state.toolCalls && state.toolCalls[toolIndex]) {
                    state.toolCalls[toolIndex].arguments += anthropicEvent.delta.partial_json;
                }
                baseChunk.choices[0].delta = {
                    tool_calls: [{
                        index: toolIndex,
                        function: {
                            arguments: anthropicEvent.delta.partial_json
                        }
                    }]
                };
                return baseChunk;
            }
            return null;

        case 'content_block_stop':
            if (state.inThinking) {
                state.inThinking = false;
            }
            return null;

        case 'message_delta':
            // Final message with stop reason
            let finishReason = 'stop';
            if (anthropicEvent.delta?.stop_reason === 'tool_use') {
                finishReason = 'tool_calls';
            } else if (anthropicEvent.delta?.stop_reason === 'max_tokens') {
                finishReason = 'length';
            }
            baseChunk.choices[0].finish_reason = finishReason;
            // Include usage if available
            if (anthropicEvent.usage) {
                baseChunk.usage = {
                    prompt_tokens: anthropicEvent.usage.input_tokens || 0,
                    completion_tokens: anthropicEvent.usage.output_tokens || 0,
                    total_tokens: (anthropicEvent.usage.input_tokens || 0) + (anthropicEvent.usage.output_tokens || 0)
                };
            }
            return baseChunk;

        case 'message_stop':
            // End of stream
            return null;

        case 'error':
            // Forward error
            return {
                error: {
                    message: anthropicEvent.error?.message || 'Unknown error',
                    type: anthropicEvent.error?.type || 'api_error',
                    code: anthropicEvent.error?.code || 'internal_error'
                }
            };

        default:
            return null;
    }
}

/**
 * Convert OpenAI streaming response format for direct passthrough
 * Used when proxy receives streaming and needs to forward in OpenAI format
 */
export function createOpenAIStreamChunk(content, model, state, options = {}) {
    const created = Math.floor(Date.now() / 1000);
    
    if (!state.id) {
        state.id = `chatcmpl-${crypto.randomBytes(16).toString('hex')}`;
        state.fingerprint = `fp_${crypto.randomBytes(8).toString('hex')}`;
    }

    return {
        id: state.id,
        object: 'chat.completion.chunk',
        created: created,
        model: model,
        system_fingerprint: state.fingerprint,
        choices: [{
            index: 0,
            delta: content ? { content } : {},
            finish_reason: options.finishReason || null
        }],
        ...(options.usage && { usage: options.usage })
    };
}
