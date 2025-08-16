// Import necessary modules
const express = require('express'); // For creating the web server
const axios = require('axios');     // For making HTTP requests to target websites
const cors = require('cors');       // For handling Cross-Origin Resource Sharing

const app = express(); // Initialize Express application
const PORT = process.env.PORT || 3000; // Define the port for the server, default to 3000

// Use CORS middleware to allow requests from any origin (important for client-side to connect)
app.use(cors());

// Serve static files from a 'public' directory (if you want to host your HTML here)
// app.use(express.static('public')); 

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
        // Use axios to make the HTTP request to the target URL
        // `responseType: 'arraybuffer'` is used to handle various content types (HTML, images, etc.)
        const response = await axios.get(targetUrl, { responseType: 'arraybuffer' });

        // Set the appropriate Content-Type header based on the target website's response
        // This is crucial for the browser to correctly render different types of content
        res.setHeader('Content-Type', response.headers['content-type'] || 'text/html');

        // Send the data received from the target website back to the client
        res.send(response.data);

    } catch (error) {
        console.error(`Error proxying ${targetUrl}:`, error.message); // Log any errors
        if (error.response) {
            // If the error has a response from the target server
            res.status(error.response.status).send(`Error from target server (${error.response.status}): ${error.message}`);
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
    console.log('Remember to configure port forwarding if running from home for external access.');
});
