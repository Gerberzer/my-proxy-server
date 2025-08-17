// Import necessary modules
const express = require('express'); // For creating the web server
const axios = require('axios');     // For making HTTP requests to target websites
const cors = require('cors');       // For handling Cross-Origin Resource Sharing

const app = express(); // Initialize Express application
const PORT = process.env.PORT || 3000; // Define the port for the server, default to 3000

// Use CORS middleware to allow requests from any origin (important for client-side to connect)
app.use(cors());

/**
 * Proxy endpoint to fetch content from a target URL.
 * It takes 'url' as a query parameter (e.g., /proxy?url=https://example.com).
 */
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url; // Get the target URL from the query parameter

    if (!targetUrl) {
        // If no URL is provided, send an error response
        return res.status(400).send('Error: Missing target URL. Please provide a URL in the "url" query parameter.');
    }

    console.log(`Proxying request for: ${targetUrl}`); // Log the request for debugging

    try {
        // Prepare headers to forward from the client (browser) to the target server
        // This helps the target server respond as if a normal browser is requesting
        const headersToForward = {};
        for (const header in req.headers) {
            // Exclude hop-by-hop headers and potentially problematic ones
            if (!['host', 'connection', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-cluster-client-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-ssl', 'x-app-name', 'x-app-version', 'accept-encoding'].includes(header.toLowerCase())) {
                headersToForward[header] = req.headers[header];
            }
        }

        // Add a general User-Agent to mimic a standard browser
        headersToForward['User-Agent'] = headersToForward['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        // Use axios to make the HTTP request to the target URL
        // `responseType: 'stream'` is used for efficient handling of potentially large content
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream', // Crucial for streaming content
            headers: headersToForward, // Forward client headers
            maxRedirects: 5, // Ensure redirects are followed
            validateStatus: function (status) {
                return status >= 200 && status < 300 || status === 404; // Accept 404s to pass them through
            },
        });

        // Forward all response headers from the target server back to the client
        for (const header in response.headers) {
            if (header.toLowerCase() !== 'set-cookie') { // Exclude set-cookie to avoid issues
                 res.setHeader(header, response.headers[header]);
            }
        }

        // Set the appropriate Content-Type header based on the target website's response, or default
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
        res.status(response.status); // Forward original status code

        // Pipe the response stream directly to the client
        response.data.pipe(res);

    } catch (error) {
        console.error(`Error proxying ${targetUrl}:`, error.message); // Log any errors
        if (error.response) {
            // If the error has a response from the target server
            res.status(error.response.status);
            if (error.response.data && typeof error.response.data.pipe === 'function') {
                res.setHeader('Content-Type', error.response.headers['content-type'] || 'text/plain');
                error.response.data.pipe(res); // Pipe error response if it's a stream
            } else {
                res.send(`Error from target server (${error.response.status}): ${error.message}`);
            }
        } else {
            // Generic error for network issues or invalid URLs
            res.status(500).send(`Proxy Error: Could not reach target URL or unexpected error: ${error.message}`);
        }
    }
});

// Start the server and listen on the defined port
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`Access it at: http://localhost:${PORT}/proxy?url=https://example.com`);
});
