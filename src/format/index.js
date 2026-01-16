/**
 * Format Converter Module
 * Converts between Anthropic Messages API format and Google Generative AI format
 * Also supports OpenAI Chat Completions format for Cursor IDE compatibility
 */

// Re-export all from each module
export * from './request-converter.js';
export * from './response-converter.js';
export * from './content-converter.js';
export * from './schema-sanitizer.js';
export * from './thinking-utils.js';
export * from './openai-converter.js';

// Default export for backward compatibility
import { convertAnthropicToGoogle } from './request-converter.js';
import { convertGoogleToAnthropic } from './response-converter.js';
import { convertOpenAIToAnthropic, convertAnthropicToOpenAI, convertAnthropicStreamEventToOpenAI } from './openai-converter.js';

export default {
    convertAnthropicToGoogle,
    convertGoogleToAnthropic,
    convertOpenAIToAnthropic,
    convertAnthropicToOpenAI,
    convertAnthropicStreamEventToOpenAI
};
