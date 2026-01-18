/**
 * SSE Streamer for Cloud Code
 *
 * Streams SSE events in real-time, converting Google format to Anthropic format.
 * Handles thinking blocks, text blocks, and tool use blocks.
 */

import crypto from 'crypto';
import { MIN_SIGNATURE_LENGTH, STREAM_READ_TIMEOUT_MS, getModelFamily } from '../constants.js';
import { EmptyResponseError } from '../errors.js';
import { cacheSignature, cacheThinkingSignature } from '../format/signature-cache.js';
import { logger } from '../utils/logger.js';

/**
 * Stream SSE response and yield Anthropic-format events
 *
 * @param {Response} response - The HTTP response with SSE body
 * @param {string} originalModel - The original model name
 * @yields {Object} Anthropic-format SSE events
 */
export async function* streamSSEResponse(response, originalModel) {
    const messageId = `msg_${crypto.randomBytes(16).toString('hex')}`;
    let hasEmittedStart = false;
    let blockIndex = 0;
    let currentBlockType = null;
    let currentThinkingSignature = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let stopReason = null;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Stream tracking for timeout and logging
    const streamStartTime = Date.now();
    let lastDataTime = Date.now();
    let chunkCount = 0;
    let totalBytes = 0;
    let warningLogged = false;

    logger.info(`[SSE] Stream started for model: ${originalModel}`);

    /**
     * Read with timeout - aborts if no data received within STREAM_READ_TIMEOUT_MS
     * Note: This is an IDLE timeout, not a total request timeout.
     * As long as data keeps flowing, the stream can run indefinitely.
     */
    async function readWithTimeout() {
        const timeoutPromise = new Promise((_, reject) => {
            const checkInterval = setInterval(() => {
                const idleTime = Date.now() - lastDataTime;
                const totalTime = Date.now() - streamStartTime;

                // Log warning at 2 minutes of idle time
                if (idleTime > 120000 && !warningLogged) {
                    warningLogged = true;
                    logger.warn(`[SSE] Stream idle for 2min (total: ${Math.round(totalTime / 1000)}s, chunks: ${chunkCount}, bytes: ${totalBytes}). Will timeout at 3min.`);
                }

                // Timeout at STREAM_READ_TIMEOUT_MS of idle time
                if (idleTime > STREAM_READ_TIMEOUT_MS) {
                    clearInterval(checkInterval);
                    const durationSec = Math.round(totalTime / 1000);
                    logger.error(`[SSE] Stream timeout! Idle for ${Math.round(idleTime / 1000)}s. Total duration: ${durationSec}s, chunks: ${chunkCount}, bytes: ${totalBytes}`);
                    reader.cancel('Stream timeout - no data received').catch(() => { });
                    reject(new Error(`Stream idle timeout after ${Math.round(idleTime / 1000)}s (total: ${durationSec}s). Received ${chunkCount} chunks, ${totalBytes} bytes before hang.`));
                }
            }, 5000); // Check every 5 seconds

            // Store cleanup function
            readWithTimeout.cleanup = () => clearInterval(checkInterval);
        });

        try {
            const result = await Promise.race([
                reader.read(),
                timeoutPromise
            ]);

            // Update tracking on successful read
            if (result.value) {
                lastDataTime = Date.now();
                chunkCount++;
                totalBytes += result.value.length;
                warningLogged = false; // Reset warning flag on data

                // Log heartbeat every 50 chunks
                if (chunkCount % 50 === 0) {
                    const elapsedSec = Math.round((Date.now() - streamStartTime) / 1000);
                    logger.debug(`[SSE] Streaming... ${chunkCount} chunks, ${Math.round(totalBytes / 1024)}KB, ${elapsedSec}s elapsed`);
                }
            }

            return result;
        } finally {
            if (readWithTimeout.cleanup) {
                readWithTimeout.cleanup();
            }
        }
    }

    try {
        while (true) {
            const { done, value } = await readWithTimeout();
            if (done) {
                const durationSec = Math.round((Date.now() - streamStartTime) / 1000);
                logger.info(`[SSE] Stream completed: ${chunkCount} chunks, ${Math.round(totalBytes / 1024)}KB, ${durationSec}s`);
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data:')) continue;

                const jsonText = line.slice(5).trim();
                if (!jsonText) continue;

                try {
                    const data = JSON.parse(jsonText);
                    const innerResponse = data.response || data;

                    // Extract usage metadata (including cache tokens)
                    const usage = innerResponse.usageMetadata;
                    if (usage) {
                        inputTokens = usage.promptTokenCount || inputTokens;
                        outputTokens = usage.candidatesTokenCount || outputTokens;
                        cacheReadTokens = usage.cachedContentTokenCount || cacheReadTokens;
                    }

                    const candidates = innerResponse.candidates || [];
                    const firstCandidate = candidates[0] || {};
                    const content = firstCandidate.content || {};
                    const parts = content.parts || [];

                    // Emit message_start on first data
                    // Note: input_tokens = promptTokenCount - cachedContentTokenCount (Antigravity includes cached in total)
                    if (!hasEmittedStart && parts.length > 0) {
                        hasEmittedStart = true;
                        yield {
                            type: 'message_start',
                            message: {
                                id: messageId,
                                type: 'message',
                                role: 'assistant',
                                content: [],
                                model: originalModel,
                                stop_reason: null,
                                stop_sequence: null,
                                usage: {
                                    input_tokens: inputTokens - cacheReadTokens,
                                    output_tokens: 0,
                                    cache_read_input_tokens: cacheReadTokens,
                                    cache_creation_input_tokens: 0
                                }
                            }
                        };
                    }

                    // Process each part
                    for (const part of parts) {
                        if (part.thought === true) {
                            // Handle thinking block
                            const text = part.text || '';
                            const signature = part.thoughtSignature || '';

                            if (currentBlockType !== 'thinking') {
                                if (currentBlockType !== null) {
                                    yield { type: 'content_block_stop', index: blockIndex };
                                    blockIndex++;
                                }
                                currentBlockType = 'thinking';
                                currentThinkingSignature = '';
                                yield {
                                    type: 'content_block_start',
                                    index: blockIndex,
                                    content_block: { type: 'thinking', thinking: '' }
                                };
                            }

                            if (signature && signature.length >= MIN_SIGNATURE_LENGTH) {
                                currentThinkingSignature = signature;
                                // Cache thinking signature with model family for cross-model compatibility
                                const modelFamily = getModelFamily(originalModel);
                                cacheThinkingSignature(signature, modelFamily);
                            }

                            yield {
                                type: 'content_block_delta',
                                index: blockIndex,
                                delta: { type: 'thinking_delta', thinking: text }
                            };

                        } else if (part.text !== undefined) {
                            // Skip empty text parts
                            if (!part.text || part.text.trim().length === 0) {
                                continue;
                            }

                            // Handle regular text
                            if (currentBlockType !== 'text') {
                                if (currentBlockType === 'thinking' && currentThinkingSignature) {
                                    yield {
                                        type: 'content_block_delta',
                                        index: blockIndex,
                                        delta: { type: 'signature_delta', signature: currentThinkingSignature }
                                    };
                                    currentThinkingSignature = '';
                                }
                                if (currentBlockType !== null) {
                                    yield { type: 'content_block_stop', index: blockIndex };
                                    blockIndex++;
                                }
                                currentBlockType = 'text';
                                yield {
                                    type: 'content_block_start',
                                    index: blockIndex,
                                    content_block: { type: 'text', text: '' }
                                };
                            }

                            yield {
                                type: 'content_block_delta',
                                index: blockIndex,
                                delta: { type: 'text_delta', text: part.text }
                            };

                        } else if (part.functionCall) {
                            // Handle tool use
                            // For Gemini 3+, capture thoughtSignature from the functionCall part
                            // The signature is a sibling to functionCall, not inside it
                            const functionCallSignature = part.thoughtSignature || '';

                            if (currentBlockType === 'thinking' && currentThinkingSignature) {
                                yield {
                                    type: 'content_block_delta',
                                    index: blockIndex,
                                    delta: { type: 'signature_delta', signature: currentThinkingSignature }
                                };
                                currentThinkingSignature = '';
                            }
                            if (currentBlockType !== null) {
                                yield { type: 'content_block_stop', index: blockIndex };
                                blockIndex++;
                            }
                            currentBlockType = 'tool_use';
                            stopReason = 'tool_use';

                            const toolId = part.functionCall.id || `toolu_${crypto.randomBytes(12).toString('hex')}`;

                            // For Gemini, include the thoughtSignature in the tool_use block
                            // so it can be sent back in subsequent requests
                            const toolUseBlock = {
                                type: 'tool_use',
                                id: toolId,
                                name: part.functionCall.name,
                                input: {}
                            };

                            // Store the signature in the tool_use block for later retrieval
                            if (functionCallSignature && functionCallSignature.length >= MIN_SIGNATURE_LENGTH) {
                                toolUseBlock.thoughtSignature = functionCallSignature;
                                // Cache for future requests (Claude Code may strip this field)
                                cacheSignature(toolId, functionCallSignature);
                            }

                            yield {
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: toolUseBlock
                            };

                            yield {
                                type: 'content_block_delta',
                                index: blockIndex,
                                delta: {
                                    type: 'input_json_delta',
                                    partial_json: JSON.stringify(part.functionCall.args || {})
                                }
                            };
                        } else if (part.inlineData) {
                            // Handle image content from Google format
                            if (currentBlockType === 'thinking' && currentThinkingSignature) {
                                yield {
                                    type: 'content_block_delta',
                                    index: blockIndex,
                                    delta: { type: 'signature_delta', signature: currentThinkingSignature }
                                };
                                currentThinkingSignature = '';
                            }
                            if (currentBlockType !== null) {
                                yield { type: 'content_block_stop', index: blockIndex };
                                blockIndex++;
                            }
                            currentBlockType = 'image';

                            // Emit image block as a complete block
                            yield {
                                type: 'content_block_start',
                                index: blockIndex,
                                content_block: {
                                    type: 'image',
                                    source: {
                                        type: 'base64',
                                        media_type: part.inlineData.mimeType,
                                        data: part.inlineData.data
                                    }
                                }
                            };

                            yield { type: 'content_block_stop', index: blockIndex };
                            blockIndex++;
                            currentBlockType = null;
                        }
                    }

                    // Check finish reason (only if not already set by tool_use)
                    if (firstCandidate.finishReason && !stopReason) {
                        if (firstCandidate.finishReason === 'MAX_TOKENS') {
                            stopReason = 'max_tokens';
                        } else if (firstCandidate.finishReason === 'STOP') {
                            stopReason = 'end_turn';
                        }
                    }

                } catch (parseError) {
                    logger.warn('[CloudCode] SSE parse error:', parseError.message);
                }
            }
        }

        // Handle no content received - throw error to trigger retry in streaming-handler
        if (!hasEmittedStart) {
            logger.warn('[CloudCode] No content parts received, throwing for retry');
            throw new EmptyResponseError('No content parts received from API');
        } else {
            // Close any open block
            if (currentBlockType !== null) {
                if (currentBlockType === 'thinking' && currentThinkingSignature) {
                    yield {
                        type: 'content_block_delta',
                        index: blockIndex,
                        delta: { type: 'signature_delta', signature: currentThinkingSignature }
                    };
                }
                yield { type: 'content_block_stop', index: blockIndex };
            }
        }

        // Emit message_delta and message_stop
        yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason || 'end_turn', stop_sequence: null },
            usage: {
                output_tokens: outputTokens,
                cache_read_input_tokens: cacheReadTokens,
                cache_creation_input_tokens: 0
            }
        };

        yield { type: 'message_stop' };
    } catch (streamError) {
        // Log and re-throw stream errors (including timeout)
        logger.error('[CloudCode] Stream error:', streamError.message);
        throw streamError;
    }
}
