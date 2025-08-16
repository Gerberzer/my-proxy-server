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
        // Construct headers to forward from the client (browser) to the target server
        // Exclude headers that might cause issues or are specific to the client's direct connection
        const forwardedHeaders = {};
        for (const header in req.headers) {
            // Exclude connection-specific headers, host, etc.
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via'].includes(header.toLowerCase())) {
                forwardedHeaders[header] = req.headers[header];
            }
        }

        // Use axios to make the HTTP request to the target URL
        // Set `responseType: 'arraybuffer'` to handle all binary and text content
        // Pass along the forwarded headers
        const response = await axios.get(targetUrl, {
            responseType: 'arraybuffer',
            headers: forwardedHeaders, // Forward client headers to the target
        });

        // Forward all response headers from the target server back to the client
        for (const header in response.headers) {
            res.setHeader(header, response.headers[header]);
        }

        // Send the data received from the target website back to the client
        res.status(response.status).send(response.data);

    } catch (error) {
        console.error(`Error proxying ${targetUrl}:`, error.message);
        if (error.response) {
            // If the error has a response from the target server, forward its status and data
            res.status(error.response.status);
            // Try to send the original error data if it's text, otherwise send generic error
            if (error.response.headers['content-type'] && error.response.headers['content-type'].includes('text')) {
                res.send(error.response.data.toString());
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
