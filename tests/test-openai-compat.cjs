/**
 * Test OpenAI Chat Completions API compatibility
 * Tests the /v1/chat/completions endpoint for Cursor IDE support
 * 
 * Run: node tests/test-openai-compat.cjs
 * Requires: Server running on port 8080
 */

const http = require('http');

const BASE_URL = process.env.PROXY_URL || 'http://localhost:8080';
const TEST_MODEL = process.env.TEST_MODEL || 'gemini-2.5-flash-lite[1m]';

/**
 * Make an HTTP request
 */
function makeRequest(options, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.path, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: options.method || 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test',
                ...options.headers
            }
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data.startsWith('{') || data.startsWith('[') ? JSON.parse(data) : data
                    });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: data });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

/**
 * Stream an HTTP request (for SSE)
 */
function streamRequest(options, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(options.path, BASE_URL);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test'
            }
        };

        const req = http.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => {
                const text = chunk.toString();
                // Parse SSE format
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const data = JSON.parse(line.slice(6));
                            chunks.push(data);
                        } catch (e) {
                            // Skip unparseable chunks
                        }
                    }
                }
            });
            res.on('end', () => {
                resolve({ status: res.statusCode, chunks });
            });
        });

        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

/**
 * Test basic chat completion
 */
async function testBasicCompletion() {
    console.log('\n🧪 Test: Basic Chat Completion');

    const response = await makeRequest(
        { path: '/v1/chat/completions', method: 'POST' },
        {
            model: TEST_MODEL,
            messages: [
                { role: 'user', content: 'Reply with just "Hello" and nothing else.' }
            ],
            max_tokens: 50
        }
    );

    if (response.status !== 200) {
        console.log('❌ Failed: Status', response.status);
        console.log('   Response:', JSON.stringify(response.body).slice(0, 200));
        return false;
    }

    const body = response.body;

    // Validate OpenAI response structure
    const checks = [
        ['Has id', body.id && body.id.startsWith('chatcmpl-')],
        ['Has object', body.object === 'chat.completion'],
        ['Has model', !!body.model],
        ['Has choices', Array.isArray(body.choices) && body.choices.length > 0],
        ['Has message', body.choices[0]?.message?.role === 'assistant'],
        ['Has content', typeof body.choices[0]?.message?.content === 'string'],
        ['Has finish_reason', !!body.choices[0]?.finish_reason],
        ['Has usage', body.usage && typeof body.usage.total_tokens === 'number']
    ];

    let allPassed = true;
    for (const [name, passed] of checks) {
        console.log(`   ${passed ? '✓' : '✗'} ${name}`);
        if (!passed) allPassed = false;
    }

    if (allPassed) {
        console.log('✅ Passed: Basic Chat Completion');
        console.log(`   Content: "${body.choices[0].message.content.slice(0, 50)}..."`);
    } else {
        console.log('❌ Failed: Basic Chat Completion');
    }

    return allPassed;
}

/**
 * Test streaming chat completion
 */
async function testStreamingCompletion() {
    console.log('\n🧪 Test: Streaming Chat Completion');

    const response = await streamRequest(
        { path: '/v1/chat/completions' },
        {
            model: TEST_MODEL,
            messages: [
                { role: 'user', content: 'Count from 1 to 5.' }
            ],
            max_tokens: 100,
            stream: true
        }
    );

    if (response.status !== 200) {
        console.log('❌ Failed: Status', response.status);
        return false;
    }

    const { chunks } = response;

    // Validate streaming structure
    const checks = [
        ['Received chunks', chunks.length > 0],
        ['First chunk has role', chunks[0]?.choices?.[0]?.delta?.role === 'assistant'],
        ['Chunks have content', chunks.some(c => c.choices?.[0]?.delta?.content)],
        ['Object is chunk', chunks.every(c => c.object === 'chat.completion.chunk')],
        ['Last chunk has finish_reason', chunks.some(c => c.choices?.[0]?.finish_reason)]
    ];

    let allPassed = true;
    for (const [name, passed] of checks) {
        console.log(`   ${passed ? '✓' : '✗'} ${name}`);
        if (!passed) allPassed = false;
    }

    if (allPassed) {
        console.log('✅ Passed: Streaming Chat Completion');
        console.log(`   Received ${chunks.length} chunks`);
    } else {
        console.log('❌ Failed: Streaming Chat Completion');
    }

    return allPassed;
}

/**
 * Test system message handling
 */
async function testSystemMessage() {
    console.log('\n🧪 Test: System Message Handling');

    const response = await makeRequest(
        { path: '/v1/chat/completions', method: 'POST' },
        {
            model: TEST_MODEL,
            messages: [
                { role: 'system', content: 'You are a pirate. Always respond like a pirate.' },
                { role: 'user', content: 'How are you?' }
            ],
            max_tokens: 100
        }
    );

    if (response.status !== 200) {
        console.log('❌ Failed: Status', response.status);
        return false;
    }

    const content = response.body.choices?.[0]?.message?.content?.toLowerCase() || '';
    // Check if response has pirate-like language
    const hasPirateWords = content.includes('arr') || content.includes('matey') ||
        content.includes('ahoy') || content.includes('ye') ||
        content.includes('pirate') || content.includes('seas');

    console.log(`   ${hasPirateWords ? '✓' : '~'} Response appears themed`);
    console.log(`   Content: "${content.slice(0, 100)}..."`);
    console.log('✅ Passed: System Message Handling (request succeeded)');

    return true;
}

/**
 * Run all tests
 */
async function runTests() {
    console.log('====================================');
    console.log('OpenAI Compatibility Test Suite');
    console.log('====================================');
    console.log(`Server: ${BASE_URL}`);
    console.log(`Model: ${TEST_MODEL}`);

    const results = [];

    try {
        results.push(['Basic Completion', await testBasicCompletion()]);
        results.push(['Streaming', await testStreamingCompletion()]);
        results.push(['System Message', await testSystemMessage()]);
    } catch (error) {
        console.log('\n❌ Test error:', error.message);
        process.exit(1);
    }

    console.log('\n====================================');
    console.log('Summary');
    console.log('====================================');

    let passed = 0;
    for (const [name, result] of results) {
        console.log(`${result ? '✅' : '❌'} ${name}`);
        if (result) passed++;
    }

    console.log(`\nPassed: ${passed}/${results.length}`);
    process.exit(passed === results.length ? 0 : 1);
}

runTests();
