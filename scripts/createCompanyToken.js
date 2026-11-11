// Creates a token a partner company can use to post sponsored events.
// Usage:  node scripts/createCompanyToken.js "Moto Shop Athens" [validity, e.g. 30d]
//
// Then:   POST http://localhost:8000/companyEvents/create
//         Header  x-company-token: <token>
//         Body    { "name": "...", "eventDate": "2026-12-20", "eventTime": "11:00", "location": "...", "description": "..." }

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sign } = require('jsonwebtoken');

const companyName = process.argv[2];
const expiresIn = process.argv[3] || '30d';

if (!companyName) {
    console.error('Usage: node scripts/createCompanyToken.js "<Company name>" [expiresIn]');
    process.exit(1);
}

const token = sign({ companyName }, process.env.COMPANY_EVENT_TOKEN_SECRET, { expiresIn });
console.log(`Company token for "${companyName}" (valid ${expiresIn}):\n${token}`);
