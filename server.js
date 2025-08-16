const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const NZP_ORIGIN = 'https://nzp.gay'; // Define the origin for nzp.gay assets

app.use(cors()); // Allow all cross-origin requests

// Universal request handler: This middleware will handle ALL incoming requests
app.use(async (req, res, next) => {
    // --- IMPORTANT DEBUGGING LOGS ---
    console.log('\n--- Incoming Request ---');
    console.log('Request Method:', req.method);
    console.log('Request Original URL:', req.originalUrl); // This is the full path including query
    console.log('Request Headers:', req.headers);
    console.log('------------------------');
    // --- END DEBUGGING LOGS ---

    // Decode the full URL path
    const decodedUrl = decodeURIComponent(req.originalUrl);

    // 1. Handle explicit /proxy requests
    if (decodedUrl.startsWith('/proxy?url=')) {
        const targetUrl = req.query.url; // Express parses query params automatically

        if (!targetUrl) {
            return res.status(400).send('Error: Missing target URL. Please provide a URL in the "url" query parameter.');
        }
        console.log(`[Proxy] Handling explicit request for: ${targetUrl}`);
        await handleProxyRequest(targetUrl, req, res, next);
    }
    // 2. Handle asset requests (any other path)
    else {
        // Assume any other request is for an NZP asset
        let assetPath = decodedUrl;
        if (!assetPath.startsWith('/')) { // Ensure it starts with a slash
            assetPath = '/' + assetPath;
        }

        // Basic check to prevent proxying non-NZP assets if the client directly requests them from proxy root
        // This is a safety measure; the browser should typically request NZP assets
        if (!assetPath.includes('.')) { // Simple check for lack of file extension, could be a root request
             console.warn(`[Asset Proxy] Request for root path or path without extension. Not proxying: ${assetPath}`);
             return res.status(404).send('Not Found: Invalid asset path or unhandled request.');
        }

        const targetAssetUrl = `${NZP_ORIGIN}${assetPath}`;
        console.log(`[Asset Proxy] Handling asset request: ${targetAssetUrl}`);
        await handleProxyRequest(targetAssetUrl, req, res, next, true); // Pass `true` for asset flag
    }
});

/**
 * Handles the actual proxying logic for both explicit /proxy calls and asset calls.
 * @param {string} targetUrl - The URL to fetch from the internet.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 * @param {function} next - Express next middleware function.
 * @param {boolean} isAssetRequest - True if this is an asset request, used for specific header logic.
 */
async function handleProxyRequest(targetUrl, req, res, next, isAssetRequest = false) {
    try {
        const headersToForward = {};
        for (const header in req.headers) {
            // Exclude hop-by-hop headers and potentially problematic ones
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding', 'if-none-match', 'if-modified-since'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        // Strongly enforce User-Agent and Referer to match a direct browser request for nzp.gay
        headersToForward['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headersToForward['Referer'] = NZP_ORIGIN + '/'; // Referer for nzp.gay

        // Explicitly set Origin for asset requests from nzp.gay
        if (isAssetRequest) {
            headersToForward['Origin'] = NZP_ORIGIN;
        } else {
            // For explicit /proxy requests, the Origin should reflect the actual client (your HTML page)
            headersToForward['Origin'] = req.headers['origin'] || null; // Use client's origin or null
        }

        // Add explicit Accept headers for common asset types based on file extension
        if (isAssetRequest && !headersToForward['Accept']) {
            if (targetUrl.includes('.js') || targetUrl.includes('.mjs')) {
                headersToForward['Accept'] = 'application/javascript, */*;q=0.8';
            } else if (targetUrl.includes('.css')) {
                headersToForward['Accept'] = 'text/css, */*;q=0.8';
            } else if (targetUrl.includes('.wasm')) {
                headersToForward['Accept'] = 'application/wasm, application/x-wasm, */*;q=0.8';
            } else if (targetUrl.includes('.pk3')) {
                headersToForward['Accept'] = 'application/octet-stream, */*;q=0.8';
            } else if (targetUrl.includes('.')) {
                 headersToForward['Accept'] = 'image/*, audio/*, video/*, application/json, text/*, */*;q=0.8';
            } else {
                 headersToForward['Accept'] = '*/*';
            }
        }

        const response = await axios({
            method: 'get',
            url: targetUrl,
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
        if (isAssetRequest) { // Only apply overrides for asset requests
            if (targetUrl.includes('.js') && contentType.includes('text/html')) {
                console.warn(`[Asset Proxy] MIME type mismatch detected for ${targetUrl}. Overriding to application/javascript.`);
                res.setHeader('Content-Type', 'application/javascript');
            } else if (targetUrl.includes('.wasm') && contentType.includes('text/html')) {
                console.warn(`[Asset Proxy] MIME type mismatch detected for ${targetUrl}. Overriding to application/wasm.`);
                res.setHeader('Content-Type', 'application/wasm');
            } else if (targetUrl.includes('.pk3') && contentType.includes('text/html')) {
                console.warn(`[Asset Proxy] MIME type mismatch detected for ${targetUrl}. Overriding to application/octet-stream.`);
                res.setHeader('Content-Type', 'application/octet-stream');
            } else {
                res.setHeader('Content-Type', contentType);
            }
        } else {
            res.setHeader('Content-Type', contentType); // For non-asset requests, just forward original
        }


        res.status(response.status);
        response.data.pipe(res);

    } catch (error) {
        console.error(`[Proxy Request Error] for ${targetUrl}:`, error.message);
        next(error); // Pass the error to the next error handling middleware
    }
}

// IMPORTANT: Generic error handling middleware
// This must be placed AFTER all other app.use() and app.get() routes
app.use((err, req, res, next) => {
    console.error('\n--- CAUGHT EXPRESS ERROR ---');
    console.error('Error Type:', err.name);
    console.error('Error Message:', err.message);
    console.error('Request URL:', req.originalUrl); // This will show the exact URL that caused the problem
    console.error('Error Stack:', err.stack);
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
