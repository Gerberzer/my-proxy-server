const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Allow all cross-origin requests

app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Error: Missing target URL. Please provide a URL in the "url" query parameter.');
    }

    console.log(`Proxying request for: ${targetUrl}`);

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
            if (header.toLowerCase() !== 'set-cookie') { // Example: remove Set-Cookie headers
                 res.setHeader(header, response.headers[header]);
            }
        }

        // Explicitly set Content-Type header based on Axios's response headers, or default
        // This is crucial for the browser to correctly interpret the file type
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream'); // Fallback if no content-type is provided

        // Pipe the response stream directly to the client
        response.data.pipe(res);

    } catch (error) {
        console.error(`Error proxying ${targetUrl}:`, error.message);
        if (error.response) {
            res.status(error.response.status);
            // If the error response is a stream, pipe it; otherwise, send message
            if (error.response.data && typeof error.response.data.pipe === 'function') {
                // Ensure proper content type for error response as well
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

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`Access it at: http://localhost:${PORT}/proxy?url=https://example.com`);
});
