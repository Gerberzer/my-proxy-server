const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Allow all cross-origin requests

// Main proxy endpoint to fetch content from a target URL using /proxy?url=
app.get('/proxy', async (req, res, next) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Error: Missing target URL. Please provide a URL in the "url" query parameter.');
    }

    console.log(`[Proxy] Explicit request for: ${targetUrl}`);

    try {
        const headersToForward = {};
        for (const header in req.headers) {
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        headersToForward['User-Agent'] = headersToForward['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headersToForward['Referer'] = headersToForward['referer'] || new URL(targetUrl).origin + '/';

        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream',
            headers: headersToForward,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 300 || status === 404;
            },
        });

        for (const header in response.headers) {
            if (header.toLowerCase() !== 'set-cookie') {
                 res.setHeader(header, response.headers[header]);
            }
        }

        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
        res.status(response.status);
        response.data.pipe(res);

    } catch (error) {
        console.error(`[Proxy Error] Explicit request ${targetUrl}:`, error.message);
        next(error);
    }
});

// Catch-all route for assets: This route will handle any request not matched by /proxy.
// Using app.use() is generally more robust for wildcard paths than app.get()
app.use('/*', async (req, res, next) => { // Changed to app.use
    // --- IMPORTANT DEBUGGING LOGS ---
    console.log('\n--- Incoming Asset Request ---');
    console.log('Request Method:', req.method);
    console.log('Request Path (from Express):', req.path);
    console.log('Request Original URL (from Express):', req.originalUrl);
    console.log('Request URL (from Express):', req.url);
    console.log('Request Query Parameters:', req.query);
    console.log('Request Headers:', req.headers);
    console.log('------------------------------');
    // --- END DEBUGGING LOGS ---

    // Extract the path from req.url which includes the path and query string.
    // decodeURIComponent to handle any URL-encoded characters.
    let assetPath = decodeURIComponent(req.url);

    // If the request is for the root path '/', it might be the main index.html for nzp.gay.
    // However, the main /proxy route is already handling the initial nzp.gay load.
    // This route should focus on subsequent asset requests from within the iframe.
    // If it's a simple '/' request not matched by /proxy, it's usually favicon or similar,
    // so we'll treat it as a request to nzp.gay's root.
    if (assetPath === '/') {
        assetPath = '/index.html'; // Default to index.html if bare root is requested
    } else if (assetPath.startsWith('/proxy?url=')) {
        // This case should ideally not happen if the /proxy route matches first,
        // but as a safeguard, if we see the proxy pattern, we treat it as an explicit proxy request
        // that somehow fell through, or a malformed request, and send 404.
        console.warn(`[Asset Proxy] Unexpected '/proxy?url=' in asset path: ${assetPath}. Sending 404.`);
        return res.status(404).send('Not Found: This path should be handled by the explicit /proxy route.');
    }

    // Ensure assetPath starts with a /
    if (!assetPath.startsWith('/')) {
        assetPath = '/' + assetPath;
    }

    const targetAssetUrl = `https://nzp.gay${assetPath}`;

    console.log(`[Asset Proxy] Attempting to proxy asset: ${targetAssetUrl}`);

    try {
        const headersToForward = {};
        for (const header in req.headers) {
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding', 'if-none-match', 'if-modified-since'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        headersToForward['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headersToForward['Referer'] = 'https://nzp.gay/';
        headersToForward['Origin'] = 'https://nzp.gay';

        if (!headersToForward['Accept']) {
            if (assetPath.includes('.js') || assetPath.includes('.mjs')) {
                headersToForward['Accept'] = 'application/javascript, */*;q=0.8';
            } else if (assetPath.includes('.css')) {
                headersToForward['Accept'] = 'text/css, */*;q=0.8';
            } else if (assetPath.includes('.wasm')) {
                headersToForward['Accept'] = 'application/wasm, application/x-wasm, */*;q=0.8';
            } else if (assetPath.includes('.pk3')) {
                headersToForward['Accept'] = 'application/octet-stream, */*;q=0.8';
            } else if (assetPath.includes('.')) {
                 headersToForward['Accept'] = 'image/*, audio/*, video/*, application/json, text/*, */*;q=0.8';
            } else {
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
                return status >= 200 && status < 300;
            },
        });

        for (const header in response.headers) {
            if (header.toLowerCase() !== 'set-cookie') {
                 res.setHeader(header, response.headers[header]);
            }
        }

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
        next(error); // Pass the error to the next error handling middleware
    }
});

// IMPORTANT: Generic error handling middleware
// This must be placed AFTER all other app.use() and app.get() routes
app.use((err, req, res, next) => {
    console.error('\n--- CAUGHT EXPRESS ERROR ---');
    console.error('Request URL:', req.originalUrl);
    console.error('Error Stack:', err.stack);
    console.error('Error Message:', err.message);
    console.error('----------------------------');

    if (res.headersSent) {
        return next(err); // Delegate to default error handler if headers are already sent
    }
    res.status(500).send('An internal proxy server error occurred. Check server logs for details.');
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`Access it at: http://localhost:${PORT}/proxy?url=https://example.com`);
});
