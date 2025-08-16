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

    console.log(`Proxying explicit request for: ${targetUrl}`);

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
        console.error(`Error proxying explicit request ${targetUrl}:`, error.message);
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
app.get('/*', async (req, res) => {
    // Reconstruct the original URL for assets based on the request path
    const assetPath = req.path; // e.g., /ftewebgl.js, /nzp/game.pk3
    const targetAssetUrl = `https://nzp.gay${assetPath}`; // Assuming nzp.gay as the base

    console.log(`Attempting to proxy asset request: ${targetAssetUrl}`);

    try {
        const headersToForward = {};
        for (const header in req.headers) {
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding', 'origin'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        headersToForward['User-Agent'] = headersToForward['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        headersToForward['Referer'] = 'https://nzp.gay/'; // Set referer to original site to avoid issues

        // Add an explicit Origin header for the asset request to simulate nzp.gay's own origin
        headersToForward['Origin'] = 'https://nzp.gay';

        // Add explicit Accept headers for common asset types
        if (assetPath.endsWith('.js') || assetPath.endsWith('.mjs')) {
            headersToForward['Accept'] = 'application/javascript, */*;q=0.8';
        } else if (assetPath.endsWith('.css')) {
            headersToForward['Accept'] = 'text/css, */*;q=0.8';
        } else if (assetPath.endsWith('.wasm')) {
            headersToForward['Accept'] = 'application/wasm, */*;q=0.8';
        } else if (assetPath.endsWith('.pk3')) { // Assuming pk3 is a common asset type for this game
             headersToForward['Accept'] = 'application/octet-stream, */*;q=0.8';
        }

        const response = await axios({
            method: 'get',
            url: targetAssetUrl,
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
        res.status(response.status); // Forward original status code
        response.data.pipe(res);

    } catch (error) {
        console.error(`Error proxying asset ${targetAssetUrl}:`, error.message);
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
