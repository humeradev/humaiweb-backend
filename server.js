const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// 20i API Configuration
const TWENTYI_API_KEY = process.env.TWENTYI_API_KEY;

// Endpoint to check domain availability
app.post('/api/check-domain', async (req, res) => {
    const { domain } = req.body;

    if (!domain) {
        return res.status(400).json({ error: 'Domain name is required' });
    }

    if (!TWENTYI_API_KEY) {
        console.error('Missing TWENTYI_API_KEY in .env');
        return res.status(500).json({ error: 'Backend configuration error' });
    }

    try {
        // Base64 encode the API key for authorization as per 20i documentation
        const bearerToken = Buffer.from(TWENTYI_API_KEY).toString('base64');

        const apiUrl = `https://api.20i.com/domain-search/${encodeURIComponent(domain)}`;
        console.log(`Calling 20i API: ${apiUrl}`);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${bearerToken}`,
                'Accept': 'application/json'
            }
        });

        const responseText = await response.text();
        console.log('--- 20i API Raw Response ---');
        console.log(responseText);
        console.log('----------------------------');

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error('Failed to parse 20i API response as JSON');
            return res.status(500).json({
                error: 'Invalid response from 20i API',
                raw: responseText.substring(0, 200)
            });
        }

        // DEBUG: Log the raw response so the user can see it in their terminal
        console.log('--- 20i API Response ---');
        console.log(JSON.stringify(data, null, 2));
        console.log('------------------------');

        if (!response.ok) {
            return res.status(response.status).json({
                error: '20i API Error',
                message: data.message || 'Unknown error'
            });
        }

        // Interpret 20i response more robustly
        // Logic: Search for the exact domain in the results
        const results = Array.isArray(data) ? data : (data.results || [data]);

        // Find the object that has the 'name' matching our domain and has the 'can' or other status fields
        const result = results.find(r => r.name?.toLowerCase() === domain.toLowerCase()) || results[1] || results[0];

        // 20i indicates availability via 'can': 'register' for domain-search endpoint
        const isAvailable = result &&
            (result.can === 'register' || result.status === 'available' || result.order_link || result.can_be_purchased === true) &&
            !result.expiry_date;

        if (isAvailable) {
            return res.json({ status: 'available' });
        } else {
            // Generate common TLD suggestions
            const nameOnly = domain.split('.')[0];
            const tldsToCheck = ['.net', '.co.uk', '.org', '.online', '.tech'];

            console.log(`Checking availability for suggestions of: ${nameOnly}`);

            // Check availability for each suggestion in parallel
            const suggestionResults = await Promise.all(tldsToCheck.map(async (tld) => {
                const sDomain = `${nameOnly}${tld}`;
                if (sDomain.toLowerCase() === domain.toLowerCase()) return null;

                try {
                    const sUrl = `https://api.20i.com/domain-search/${encodeURIComponent(sDomain)}`;
                    const sRes = await fetch(sUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${bearerToken}`,
                            'Accept': 'application/json'
                        }
                    });

                    if (!sRes.ok) return null;

                    const sData = await sRes.json();
                    const sResults = Array.isArray(sData) ? sData : (sData.results || [sData]);
                    const sMatch = sResults.find(r => r.name?.toLowerCase() === sDomain.toLowerCase()) || sResults[1] || sResults[0];

                    // Only return if it's actually available
                    const isSAvailable = sMatch &&
                        (sMatch.can === 'register' || sMatch.status === 'available' || sMatch.order_link);

                    return isSAvailable ? sDomain : null;
                } catch (e) {
                    console.error(`Error checking suggestion ${sDomain}:`, e);
                    return null;
                }
            }));

            // Filter out nulls and take top 5
            const finalSuggestions = suggestionResults.filter(s => s !== null).slice(0, 5);

            return res.json({
                status: 'unavailable',
                suggestions: finalSuggestions
            });
        }

    } catch (error) {
        console.error('Error calling 20i API:', error);
        res.status(500).json({ error: 'Failed to check domain availability' });
    }
});
app.get('/', (req, res) => {
    res.send('✅ 20i Backend Server is running successfully');
});

app.listen(PORT, () => {
    console.log(`20i Backend server running on http://localhost:${PORT}`);
});
