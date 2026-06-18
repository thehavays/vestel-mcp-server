import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import https from 'https';

const JIRA_URL = process.env.JIRA_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD; // Can be a password or personal access token (PAT)
const JIRA_AUTH_TYPE = (process.env.JIRA_AUTH_TYPE || 'basic').toLowerCase();
const JIRA_REJECT_UNAUTHORIZED = process.env.JIRA_REJECT_UNAUTHORIZED !== 'false';

if (!JIRA_URL || !JIRA_PASSWORD) {
  console.error('Error: Missing JIRA_URL or JIRA_PASSWORD environment variables.');
  process.exit(1);
}

if (JIRA_AUTH_TYPE === 'basic' && !JIRA_USERNAME) {
  console.error('Error: JIRA_USERNAME is required when JIRA_AUTH_TYPE is set to "basic".');
  process.exit(1);
}

// TODO(security): Warn about rejecting unauthorized SSL certificates
if (!JIRA_REJECT_UNAUTHORIZED) {
  console.error('WARNING (Security): SSL verification is disabled. Connection is vulnerable to MITM attacks.');
}

// Configure HTTPS agent to allow self-signed or enterprise CAs if configured
const httpsAgent = new https.Agent({
  rejectUnauthorized: JIRA_REJECT_UNAUTHORIZED,
});

// Construct the correct authorization header (Basic or Bearer)
const authHeader = JIRA_AUTH_TYPE === 'bearer' || !JIRA_USERNAME
  ? `Bearer ${JIRA_PASSWORD}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64')}`;

const jiraClient = axios.create({
  baseURL: JIRA_URL.replace(/\/$/, ''), // Strip trailing slash
  headers: {
    'Authorization': JIRA_PASSWORD.length > 30 ? `Bearer ${JIRA_PASSWORD}` : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString('base64')}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  httpsAgent,
});

const server = new Server(
  {
    name: 'jira-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'jira_get_issue',
        description: 'Retrieve details of a specific Jira issue, including description, comments, assignee, status, reporter, and summary.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'The issue key (e.g., PROJ-123).',
            },
          },
          required: ['issueKey'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The issue key.' },
            summary: { type: 'string', description: 'Summary/title of the issue.' },
            status: { type: 'string', description: 'Current status of the issue.' },
            assignee: { type: 'string', description: 'Username of the assignee.' },
            reporter: { type: 'string', description: 'Username of the reporter.' },
            description: { type: 'string', description: 'Description of the issue.' },
            comments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  author: { type: 'string' },
                  body: { type: 'string' },
                  created: { type: 'string' },
                },
                required: ['author', 'body', 'created'],
              },
            },
          },
          required: ['key', 'summary', 'status', 'assignee', 'reporter', 'description', 'comments'],
        },
      },
      {
        name: 'jira_get_issues_by_assignee',
        description: 'Get list of open/active issues assigned to a specific username (checks for Pending, Submitted, In Progress, Open, and Reopened statuses).',
        inputSchema: {
          type: 'object',
          properties: {
            username: {
              type: 'string',
              description: 'The Jira username of the assignee.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of issues to return (default 50).',
            },
          },
          required: ['username'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  summary: { type: 'string' },
                  status: { type: 'string' },
                  updated: { type: 'string' },
                },
                required: ['key', 'summary', 'status', 'updated'],
              },
            },
          },
          required: ['issues'],
        },
      },
      {
        name: 'jira_get_review_issues_by_assignee',
        description: 'Get list of issues in a review status (e.g., Review, Code Review, Under Review, In Review) assigned to a specific username.',
        inputSchema: {
          type: 'object',
          properties: {
            username: {
              type: 'string',
              description: 'The Jira username of the assignee.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of issues to return (default 50).',
            },
          },
          required: ['username'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  summary: { type: 'string' },
                  status: { type: 'string' },
                  updated: { type: 'string' },
                },
                required: ['key', 'summary', 'status', 'updated'],
              },
            },
          },
          required: ['issues'],
        },
      },
      {
        name: 'jira_create_issue',
        description: 'Create a new issue in a project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectKey: {
              type: 'string',
              description: 'Key of the project (e.g., PROJ).',
            },
            summary: {
              type: 'string',
              description: 'Summary/title of the issue.',
            },
            description: {
              type: 'string',
              description: 'Description of the issue.',
            },
            issueType: {
              type: 'string',
              description: 'Type of the issue (e.g., Bug, Task, Story).',
            },
          },
          required: ['projectKey', 'summary', 'description', 'issueType'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The key of the newly created issue.' },
            url: { type: 'string', description: 'The web link of the newly created issue.' },
          },
          required: ['key', 'url'],
        },
      },
      {
        name: 'jira_update_issue',
        description: 'Update fields of an existing issue.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Key of the issue to update.',
            },
            fields: {
              type: 'object',
              description: 'A key-value map of fields to update (e.g., {"summary": "New Title", "description": "New Desc"}).',
            },
          },
          required: ['issueKey', 'fields'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'The key of the updated issue.' },
            success: { type: 'boolean', description: 'Whether the update succeeded.' },
          },
          required: ['issueKey', 'success'],
        },
      },
      {
        name: 'jira_add_comment',
        description: 'Add a comment to an issue.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'The issue key to add the comment to.',
            },
            comment: {
              type: 'string',
              description: 'The comment body/text.',
            },
          },
          required: ['issueKey', 'comment'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'The key of the commented issue.' },
            commentId: { type: 'string', description: 'The ID of the created comment.' },
            success: { type: 'boolean', description: 'Whether the comment addition succeeded.' },
          },
          required: ['issueKey', 'commentId', 'success'],
        },
      },
      {
        name: 'jira_search_issues',
        description: 'Search Jira issues using JQL (Jira Query Language).',
        inputSchema: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description: 'JQL query (e.g., project = PROJ AND status = "In Progress").',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results (default 50).',
            },
          },
          required: ['jql'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  summary: { type: 'string' },
                  status: { type: 'string' },
                  assignee: { type: 'string' },
                  updated: { type: 'string' },
                },
                required: ['key', 'summary', 'status', 'assignee', 'updated'],
              },
            },
          },
          required: ['issues'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'jira_get_issue': {
        const { issueKey } = args;
        // Fetch details from Jira REST API
        const response = await jiraClient.get(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`);
        const issue = response.data;
        const details = {
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          assignee: issue.fields.assignee ? issue.fields.assignee.name : 'Unassigned',
          reporter: issue.fields.reporter ? issue.fields.reporter.name : 'Unknown',
          description: issue.fields.description || 'No description provided.',
          comments: (issue.fields.comment?.comments || []).map(c => ({
            author: c.author ? c.author.name : 'Unknown',
            body: c.body,
            created: c.created,
          })),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(details, null, 2),
            },
          ],
          structuredContent: details,
        };
      }

      case 'jira_get_issues_by_assignee': {
        const { username, maxResults = 50 } = args;
        const jql = `assignee = "${username}" AND status in (Pending, Submitted, "In Progress", Open, Reopened) ORDER BY updated DESC`;
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          updated: issue.fields.updated,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issues, null, 2),
            },
          ],
          structuredContent: { issues },
        };
      }

      case 'jira_get_review_issues_by_assignee': {
        const { username, maxResults = 50 } = args;
        const jql = `assignee = "${username}" AND status in (Review, "Code Review", "Under Review", "In Review") ORDER BY updated DESC`;
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          updated: issue.fields.updated,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issues, null, 2),
            },
          ],
          structuredContent: { issues },
        };
      }

      case 'jira_create_issue': {
        const { projectKey, summary, description, issueType } = args;
        const payload = {
          fields: {
            project: {
              key: projectKey,
            },
            summary,
            description,
            issuetype: {
              name: issueType,
            },
          },
        };

        const response = await jiraClient.post('/rest/api/2/issue', payload);
        const result = {
          key: response.data.key,
          url: `${JIRA_URL.replace(/\/$/, '')}/browse/${response.data.key}`,
        };
        return {
          content: [
            {
              type: 'text',
              text: `Issue successfully created. Key: ${result.key}, URL: ${result.url}`,
            },
          ],
          structuredContent: result,
        };
      }

      case 'jira_update_issue': {
        const { issueKey, fields } = args;
        await jiraClient.put(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { fields });
        const result = {
          issueKey,
          success: true,
        };
        return {
          content: [
            {
              type: 'text',
              text: `Successfully updated issue ${issueKey}`,
            },
          ],
          structuredContent: result,
        };
      }

      case 'jira_add_comment': {
        const { issueKey, comment } = args;
        const response = await jiraClient.post(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, {
          body: comment,
        });
        const result = {
          issueKey,
          commentId: response.data.id,
          success: true,
        };

        return {
          content: [
            {
              type: 'text',
              text: `Comment successfully added to ${issueKey}. Comment ID: ${result.commentId}`,
            },
          ],
          structuredContent: result,
        };
      }

      case 'jira_search_issues': {
        const { jql, maxResults = 50 } = args;
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          assignee: issue.fields.assignee ? issue.fields.assignee.name : 'Unassigned',
          updated: issue.fields.updated,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(issues, null, 2),
            },
          ],
          structuredContent: { issues },
        };
      }

      default:
        throw new Error(`Tool not found: ${name}`);
    }
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error.response?.data || error.message);
    const errorDetails = error.response?.data
      ? JSON.stringify(error.response.data, null, 2)
      : error.message;

    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool ${name}: ${errorDetails}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jira MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main:', error);
  process.exit(1);
});
