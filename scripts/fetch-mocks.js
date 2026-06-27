import fs from 'fs';
import path from 'path';
import axios from 'axios';

const JIRA_URL = process.env.JIRA_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

if (!JIRA_URL || !JIRA_PASSWORD) {
  console.log('Skipping live mock fetch: JIRA_URL or JIRA_PASSWORD not set.');
  console.log('To fetch live mocks, run:');
  console.log('  JIRA_URL=https://your-jira.com JIRA_PASSWORD=your_token JIRA_USERNAME=your_user npm run fetch-mocks');
  process.exit(0);
}

const client = axios.create({
  baseURL: JIRA_URL.replace(/\/$/, ''),
  headers: {
    'Authorization': JIRA_PASSWORD.length > 30 ? `Bearer ${JIRA_PASSWORD}` : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64')}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
});

async function run() {
  try {
    const mockDir = path.join(process.cwd(), 'tests', 'mocks');
    if (!fs.existsSync(mockDir)) {
      fs.mkdirSync(mockDir, { recursive: true });
    }

    console.log('Fetching a sample issue...');
    const issueKey = process.env.ISSUE_KEY || 'PROJ-123';
    try {
      const issueRes = await client.get(`/rest/api/2/issue/${issueKey}`);
      fs.writeFileSync(path.join(mockDir, 'jira_get_issue_mock.json'), JSON.stringify(issueRes.data, null, 2));
      console.log(`Saved live mock to tests/mocks/jira_get_issue_mock.json using issue ${issueKey}`);
    } catch (e) {
      console.warn(`Could not fetch issue ${issueKey} specifically: ${e.message}. Attempting search to find an issue...`);
      const searchRes = await client.get('/rest/api/2/search', { params: { maxResults: 1 } });
      if (searchRes.data.issues && searchRes.data.issues[0]) {
        const foundKey = searchRes.data.issues[0].key;
        const issueRes = await client.get(`/rest/api/2/issue/${foundKey}`);
        fs.writeFileSync(path.join(mockDir, 'jira_get_issue_mock.json'), JSON.stringify(issueRes.data, null, 2));
        console.log(`Saved live mock to tests/mocks/jira_get_issue_mock.json using issue ${foundKey}`);
      } else {
        throw new Error('No issues found in Jira instance to fetch.');
      }
    }

    console.log('Fetching sample search results...');
    const searchRes = await client.get('/rest/api/2/search', { params: { maxResults: 5 } });
    fs.writeFileSync(path.join(mockDir, 'jira_search_mock.json'), JSON.stringify(searchRes.data, null, 2));
    console.log('Saved live mock to tests/mocks/jira_search_mock.json');

  } catch (error) {
    console.error('Error fetching mock data:', error.message);
    process.exit(1);
  }
}

run();
