const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Allow all cross-origin requests

// Main proxy endpoint to fetch content from a target URL using /proxy?url=
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Error: Missing target URL. Please provide a URL in the "url" query parameter.');
    }

    console.log(`[Proxy] Explicit request for: ${targetUrl}`);

    try {
        // Prepare headers to forward from the client (browser) to the target server
        const headersToForward = {};
        for (const header in req.headers) {
            // Exclude hop-by-hop headers and potentially problematic ones that Axios or Render might add
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        // Add an explicit User-Agent to make the proxy request look more like a real browser
        // Also add a Referer header, which some sites check
        headersToForward['User-Agent'] = headersToForward['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headersToForward['Referer'] = headersToForward['referer'] || new URL(targetUrl).origin + '/'; // Set referer to target origin

        // Make the request to the target URL, stream the response
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream', // Crucial for streaming content
            headers: headersToForward, // Forward client headers
            maxRedirects: 5, // Ensure redirects are followed automatically
            validateStatus: function (status) {
                return status >= 200 && status < 300 || status === 404; // Accept 404s so we can pass them through
            },
        });

        // Forward all response headers from the target server back to the client
        for (const header in response.headers) {
            // Remove 'set-cookie' if it causes issues, or modify it
            if (header.toLowerCase() !== 'set-cookie') {
                 res.setHeader(header, response.headers[header]);
            }
        }

        // Explicitly set Content-Type header based on Axios's response headers, or default
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream'); // Fallback if no content-type is provided
        res.status(response.status); // Forward original status code

        // Pipe the response stream directly to the client
        response.data.pipe(res);

    } catch (error) {
        console.error(`[Proxy Error] Explicit request ${targetUrl}:`, error.message);
        if (error.response) {
            res.status(error.response.status);
            if (error.response.data && typeof error.response.data.pipe === 'function') {
                res.setHeader('Content-Type', error.response.headers['content-type'] || 'text/plain');
                error.response.data.pipe(res);
            } else {
                res.send(`Error from target server (${error.response.status}): ${error.message}`);
            }
        } else {
            res.status(500).send(`Proxy Error: Could not reach target URL or unexpected error: ${error.message}`);
        }
    }
});

// Catch-all route for assets: If a request doesn't start with '/proxy',
// assume it's an asset (like /ftewebgl.js or /nzp/game.pk3) from nzp.gay
// Use '*' to match any path, then carefully parse
app.get('*', async (req, res) => {
    // --- IMPORTANT DEBUGGING LOGS ---
    console.log('\n--- Incoming Asset Request ---');
    console.log('Request Method:', req.method);
    console.log('Request Path (from Express):', req.path); // Path segment after hostname/port
    console.log('Request Original URL (from Express):', req.originalUrl); // Full URL after base, including query
    console.log('Request URL (from Express):', req.url); // Similar to originalUrl for simple requests
    console.log('Request Query Parameters:', req.query);
    console.log('Request Headers:', req.headers);
    console.log('------------------------------');
    // --- END DEBUGGING LOGS ---

    // Use req.url which includes the path and query string, then decode it
    let assetPath = decodeURIComponent(req.url);

    // Ensure assetPath doesn't contain the /proxy part if it somehow got there
    if (assetPath.startsWith('/proxy?url=')) {
        console.warn(`[Asset Proxy] Unexpected '/proxy?url=' in asset path: ${assetPath}. Skipping this request for generic asset handling.`);
        return res.status(404).send('Not Found: This path should not be handled as a generic asset.');
    }

    // Ensure it starts with a / for URL construction, but avoid double slashes
    if (!assetPath.startsWith('/')) {
        assetPath = '/' + assetPath;
    }

    const targetAssetUrl = `https://nzp.gay${assetPath}`;

    console.log(`[Asset Proxy] Attempting to proxy asset: ${targetAssetUrl}`);

    try {
        const headersToForward = {};
        for (const header in req.headers) {
            // Be very selective here. Only forward headers that are universally safe.
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding', 'if-none-match', 'if-modified-since'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        // Strongly enforce User-Agent and Referer to match a direct browser request for nzp.gay
        headersToForward['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headersToForward['Referer'] = 'https://nzp.gay/';
        headersToForward['Origin'] = 'https://nzp.gay'; // Explicitly set Origin for assets

        // Add explicit Accept headers for common asset types based on file extension
        if (!headersToForward['Accept']) { // Only set if Accept header isn't already present
            if (assetPath.includes('.js') || assetPath.includes('.mjs')) { // Use includes for robustness
                headersToForward['Accept'] = 'application/javascript, */*;q=0.8';
            } else if (assetPath.includes('.css')) {
                headersToForward['Accept'] = 'text/css, */*;q=0.8';
            } else if (assetPath.includes('.wasm')) {
                headersToForward['Accept'] = 'application/wasm, application/x-wasm, */*;q=0.8';
            } else if (assetPath.includes('.pk3')) {
                headersToForward['Accept'] = 'application/octet-stream, */*;q=0.8';
            } else if (assetPath.includes('.')) { // For other file types with extensions
                 headersToForward['Accept'] = 'image/*, audio/*, video/*, application/json, text/*, */*;q=0.8';
            } else { // Fallback for unknown extensions or no extension
                 headersToForward['Accept'] = '*/*';
            }
        }

        const response = await axios({
            method: 'get',
            url: targetAssetUrl,
            responseType: 'stream',
            headers: headersToForward,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 300; // Only consider 2xx as success from target
            },
        });

        // Forward all response headers from the target server back to the client
        for (const header in response.headers) {
            if (header.toLowerCase() !== 'set-cookie') {
                 res.setHeader(header, response.headers[header]);
            }
        }

        // IMPORTANT: Override Content-Type if we suspect it's wrong (e.g., HTML for JS/WASM)
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        if (assetPath.includes('.js') && contentType.includes('text/html')) {
            console.warn(`[Asset Proxy] MIME type mismatch detected for ${assetPath}. Overriding to application/javascript.`);
            res.setHeader('Content-Type', 'application/javascript');
        } else if (assetPath.includes('.wasm') && contentType.includes('text/html')) {
            console.warn(`[Asset Proxy] MIME type mismatch detected for ${assetPath}. Overriding to application/wasm.`);
            res.setHeader('Content-Type', 'application/wasm');
        } else if (assetPath.includes('.pk3') && contentType.includes('text/html')) {
            console.warn(`[Asset Proxy] MIME type mismatch detected for ${assetPath}. Overriding to application/octet-stream.`);
            res.setHeader('Content-Type', 'application/octet-stream');
        } else {
            res.setHeader('Content-Type', contentType);
        }

        res.status(response.status);
        response.data.pipe(res);

    } catch (error) {
        console.error(`[Asset Proxy Error] for ${targetAssetUrl}:`, error.message);
        if (error.response) {
            res.status(error.response.status);
            if (error.response.data && typeof error.response.data.pipe === 'function') {
                res.setHeader('Content-Type', error.response.headers['content-type'] || 'text/plain');
                error.response.data.pipe(res);
            } else {
                res.send(`Proxy Error for asset (${error.response.status}): ${error.message}`);
            }
        } else {
            res.status(500).send(`Proxy Error for asset: Could not reach target asset or unexpected error: ${error.message}`);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`Access it at: http://localhost:${PORT}/proxy?url=https://example.com`);
});
