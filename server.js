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
        // Filter out hop-by-hop headers and potentially problematic ones
        const headersToForward = {};
        for (const header in req.headers) {
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        // Make the request to the target URL, stream the response
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream', // Crucial for streaming content
            headers: headersToForward, // Forward client headers
            maxRedirects: 5, // Ensure redirects are followed automatically
        });

        // Forward all response headers from the target server back to the client
        for (const header in response.headers) {
            res.setHeader(header, response.headers[header]);
        }

        // Pipe the response stream directly to the client
        response.data.pipe(res);

    } catch (error) {
        console.error(`Error proxying ${targetUrl}:`, error.message);
        if (error.response) {
            // If the error has a response from the target server, forward its status and data
            res.status(error.response.status);
            // If it's a stream, try to pipe it or just send a string error
            if (error.response.data && typeof error.response.data.pipe === 'function') {
                error.response.data.pipe(res); // Pipe the error stream
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
