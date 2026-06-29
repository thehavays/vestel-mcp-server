#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';

const JIRA_URL = process.env.JIRA_URL || (process.env.NODE_ENV === 'test' ? 'https://mock-jira.example.com' : '');
const JIRA_USERNAME = process.env.JIRA_USERNAME || (process.env.NODE_ENV === 'test' ? 'mock-user' : '');
const JIRA_PASSWORD = process.env.JIRA_PASSWORD || (process.env.NODE_ENV === 'test' ? 'mock-password' : ''); // Can be a password or personal access token (PAT)
const JIRA_AUTH_TYPE = (process.env.JIRA_AUTH_TYPE || 'basic').toLowerCase();
const JIRA_REJECT_UNAUTHORIZED = process.env.JIRA_REJECT_UNAUTHORIZED !== 'false';

if (process.env.NODE_ENV !== 'test') {
  if (!JIRA_URL || !JIRA_PASSWORD) {
    console.error('Error: Missing JIRA_URL or JIRA_PASSWORD environment variables.');
    process.exit(1);
  }

  if (JIRA_AUTH_TYPE === 'basic' && !JIRA_USERNAME) {
    console.error('Error: JIRA_USERNAME is required when JIRA_AUTH_TYPE is set to "basic".');
    process.exit(1);
  }
}

// TODO(security): Warn about rejecting unauthorized SSL certificates
if (!JIRA_REJECT_UNAUTHORIZED && process.env.NODE_ENV !== 'test') {
  console.error('WARNING (Security): SSL verification is disabled. Connection is vulnerable to MITM attacks.');
}

// Configure HTTPS agent to allow self-signed or enterprise CAs if configured
const httpsAgent = new https.Agent({
  rejectUnauthorized: JIRA_REJECT_UNAUTHORIZED,
});

// Load configuration from file if it exists, otherwise fall back to environment variables
let allowedProjects = null;
let allowedTools = null;

try {
  const configPath = path.join(process.cwd(), '.jira-config.json');
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData.allowedProjects && Array.isArray(configData.allowedProjects)) {
      allowedProjects = configData.allowedProjects.map(p => p.trim().toUpperCase());
    }
    if (configData.allowedTools && Array.isArray(configData.allowedTools)) {
      allowedTools = configData.allowedTools.map(t => t.trim());
    }
  }
} catch (configError) {
  console.error('Warning: Error reading .jira-config.json:', configError.message);
}

// Fallback or merge with environment variables
if (!allowedProjects && process.env.ALLOWED_PROJECTS) {
  const envProj = process.env.ALLOWED_PROJECTS;
  if (envProj !== '*' && envProj.toLowerCase() !== 'all') {
    allowedProjects = envProj.split(',').map(p => p.trim().toUpperCase());
  }
}

if (!allowedTools && process.env.ALLOWED_TOOLS) {
  const envTools = process.env.ALLOWED_TOOLS;
  if (envTools !== '*' && envTools.toLowerCase() !== 'all') {
    allowedTools = envTools.split(',').map(t => t.trim());
  }
}

function isProjectAllowed(projectKey) {
  if (!allowedProjects || allowedProjects.includes('*')) return true;
  return allowedProjects.includes(projectKey.toUpperCase());
}

function getProjectFromIssueKey(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') return null;
  const parts = issueKey.split('-');
  return parts[0] ? parts[0].toUpperCase() : null;
}

function enforceJqlSecurity(jql) {
  if (!allowedProjects || allowedProjects.includes('*')) return jql;
  if (allowedProjects.length === 0) {
    return 'project = EMPTY';
  }
  const projectInClause = `project in (${allowedProjects.join(', ')})`;
  if (!jql || jql.trim() === '') {
    return projectInClause;
  }
  return `(${jql}) AND ${projectInClause}`;
}

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
  const allTools = [
    {
      name: 'jira_get_issue',
      description: 'Retrieve details of a specific Jira issue, including description, comments, assignee, status, reporter, summary, issue type, priority, and linked issues.',
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
          issueType: { type: 'string', description: 'The issue type (e.g. Bug, Story, Task).' },
          priority: { type: 'string', description: 'Priority level of the issue.' },
          linkedIssues: {
            type: 'array',
            description: 'List of linked issues/dependencies.',
            items: {
              type: 'object',
              properties: {
                direction: { type: 'string', description: 'Link direction: inward or outward.' },
                linkType: { type: 'string', description: 'Type of link (e.g., Blocks, Relates).' },
                key: { type: 'string', description: 'Key of the linked issue.' },
                summary: { type: 'string', description: 'Summary of the linked issue.' },
                status: { type: 'string', description: 'Status of the linked issue.' },
                issueType: { type: 'string', description: 'Issue type of the linked issue.' },
                priority: { type: 'string', description: 'Priority of the linked issue.' },
              },
              required: ['direction', 'linkType', 'key', 'summary', 'status', 'issueType', 'priority'],
            },
          },
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
        required: ['key', 'summary', 'status', 'assignee', 'reporter', 'description', 'issueType', 'priority', 'linkedIssues', 'comments'],
      },
    },
    {
      name: 'jira_get_issues_by_assignee',
      description: 'Get list of open/active issues assigned to a specific username (checks for Pending, Submitted, In Progress, Open, and Reopened statuses). Output includes issue type, priority, and linked issues.',
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
                issueType: { type: 'string' },
                priority: { type: 'string' },
                linkedIssues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      direction: { type: 'string' },
                      linkType: { type: 'string' },
                      key: { type: 'string' },
                      summary: { type: 'string' },
                      status: { type: 'string' },
                      issueType: { type: 'string' },
                      priority: { type: 'string' },
                    },
                    required: ['direction', 'linkType', 'key', 'summary', 'status', 'issueType', 'priority'],
                  },
                },
              },
              required: ['key', 'summary', 'status', 'updated', 'issueType', 'priority', 'linkedIssues'],
            },
          },
        },
        required: ['issues'],
      },
    },
    {
      name: 'jira_get_review_issues_by_assignee',
      description: 'Get list of issues in a review status (e.g., Review, Code Review, Under Review, In Review) assigned to a specific username. Output includes issue type, priority, and linked issues.',
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
                issueType: { type: 'string' },
                priority: { type: 'string' },
                linkedIssues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      direction: { type: 'string' },
                      linkType: { type: 'string' },
                      key: { type: 'string' },
                      summary: { type: 'string' },
                      status: { type: 'string' },
                      issueType: { type: 'string' },
                      priority: { type: 'string' },
                    },
                    required: ['direction', 'linkType', 'key', 'summary', 'status', 'issueType', 'priority'],
                  },
                },
              },
              required: ['key', 'summary', 'status', 'updated', 'issueType', 'priority', 'linkedIssues'],
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
            description: 'A key-value map of fields to update. Commonly supported fields include:\n- summary: string (e.g. "New Title")\n- description: string (e.g. "New description details")\n- priority: object with name/id (e.g. {"name": "High"})\n- assignee: object with name (e.g. {"name": "username"}, or {"name": null} to unassign)\n- labels: array of strings (e.g. ["tag1", "tag2"])\n- duedate: string in YYYY-MM-DD format (e.g. "2026-06-30")\n- components: array of objects with name (e.g. [{"name": "Database"}])\n- fixVersions: array of objects with name (e.g. [{"name": "1.1.0"}])',
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
      description: 'Search Jira issues using JQL (Jira Query Language). Output includes issue type, priority, and linked issues.',
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
                issueType: { type: 'string' },
                priority: { type: 'string' },
                linkedIssues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      direction: { type: 'string' },
                      linkType: { type: 'string' },
                      key: { type: 'string' },
                      summary: { type: 'string' },
                      status: { type: 'string' },
                      issueType: { type: 'string' },
                      priority: { type: 'string' },
                    },
                    required: ['direction', 'linkType', 'key', 'summary', 'status', 'issueType', 'priority'],
                  },
                },
              },
              required: ['key', 'summary', 'status', 'assignee', 'updated', 'issueType', 'priority', 'linkedIssues'],
            },
          },
        },
        required: ['issues'],
      },
    },
    {
      name: 'jira_get_watched_issues',
      description: 'Get list of open/active issues watched by a specific username (or the authenticated user if omitted). Checks for open statuses (e.g., Pending, In Progress, Open). Output includes issue type, priority, and linked issues.',
      inputSchema: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'The Jira username of the watcher. If omitted, uses the currently authenticated user.',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of issues to return (default 50).',
          },
        },
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
                issueType: { type: 'string' },
                priority: { type: 'string' },
                linkedIssues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      direction: { type: 'string' },
                      linkType: { type: 'string' },
                      key: { type: 'string' },
                      summary: { type: 'string' },
                      status: { type: 'string' },
                      issueType: { type: 'string' },
                      priority: { type: 'string' },
                    },
                    required: ['direction', 'linkType', 'key', 'summary', 'status', 'issueType', 'priority'],
                  },
                },
              },
              required: ['key', 'summary', 'status', 'updated', 'issueType', 'priority', 'linkedIssues'],
            },
          },
        },
        required: ['issues'],
      },
    },
    {
      name: 'jira_get_user_activities',
      description: 'Get a feed of recent activities performed by a specific user (e.g., comments, status changes, updates). Note: This uses the Jira Activity Stream and may return activities across the instance depending on visibility.',
      inputSchema: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'The Jira username to fetch activities for. If omitted, fetches activities for the authenticated user.',
          },
          startDate: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format.',
          },
          endDate: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format.',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of activity items to return (default 50).',
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          activities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Activity summary (e.g., User commented on ISSUE-1)' },
                published: { type: 'string', description: 'When the activity occurred' },
                content: { type: 'string', description: 'Detailed content/HTML of the activity' },
                url: { type: 'string', description: 'Link to the activity/issue' },
              },
            },
          },
        },
        required: ['activities'],
      },
    },
    {
      name: 'jira_get_issue_commits',
      description: 'Get commits linked to a specific Jira issue via the Jira Development Status (dev-status) API. Returns commit details including hash, message, author, date, and repository info. Requires Jira Software with source control integration (e.g., Bitbucket, GitHub, GitLab).',
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
          issueKey: { type: 'string', description: 'The queried issue key.' },
          commits: {
            type: 'array',
            description: 'List of commits linked to this issue.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Commit hash/ID.' },
                message: { type: 'string', description: 'Commit message.' },
                author: { type: 'string', description: 'Author name.' },
                authorEmail: { type: 'string', description: 'Author email.' },
                date: { type: 'string', description: 'Commit date (ISO 8601).' },
                url: { type: 'string', description: 'Link to the commit in the source control tool.' },
                repository: { type: 'string', description: 'Name of the repository.' },
                repositoryUrl: { type: 'string', description: 'URL of the repository.' },
              },
              required: ['id', 'message', 'author', 'date', 'repository'],
            },
          },
        },
        required: ['issueKey', 'commits'],
      },
    },
    {
      name: 'jira_get_version_commits',
      description: 'Get all commits linked to a specific Jira project version (fixVersion) by aggregating commits from every issue that belongs to that version. Uses JQL to find the issues and the Jira Development Status API to fetch commits per issue. Requires Jira Software with source control integration (e.g., Bitbucket, FishEye/Crucible, GitHub, GitLab).',
      inputSchema: {
        type: 'object',
        properties: {
          projectKey: {
            type: 'string',
            description: 'The project key (e.g., COMA).',
          },
          version: {
            type: 'string',
            description: 'The fixVersion name exactly as it appears in Jira (e.g., v1.18.9).',
          },
          maxIssues: {
            type: 'number',
            description: 'Maximum number of issues to scan (default 100). Each issue triggers a dev-status API call.',
          },
        },
        required: ['projectKey', 'version'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          projectKey: { type: 'string', description: 'The queried project key.' },
          version: { type: 'string', description: 'The queried version name.' },
          issueCount: { type: 'number', description: 'Number of issues scanned.' },
          commits: {
            type: 'array',
            description: 'Aggregated commits from all issues in this version.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Commit hash/ID.' },
                message: { type: 'string', description: 'Commit message.' },
                author: { type: 'string', description: 'Author name.' },
                authorEmail: { type: 'string', description: 'Author email.' },
                date: { type: 'string', description: 'Commit date (ISO 8601).' },
                url: { type: 'string', description: 'Link to the commit.' },
                repository: { type: 'string', description: 'Repository name.' },
                repositoryUrl: { type: 'string', description: 'Repository URL.' },
                issueKey: { type: 'string', description: 'The Jira issue this commit is linked to.' },
              },
              required: ['id', 'message', 'author', 'date', 'repository', 'issueKey'],
            },
          },
        },
        required: ['projectKey', 'version', 'issueCount', 'commits'],
      },
    },
  ];

  const filteredTools = allowedTools && !allowedTools.includes('*')
    ? allTools.filter(t => allowedTools.includes(t.name))
    : allTools;

  return {
    tools: filteredTools,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Security Check: Tool Allowlist
  if (allowedTools && !allowedTools.includes('*') && !allowedTools.includes(name)) {
    return {
      content: [
        {
          type: 'text',
          text: `Security Exception: Tool "${name}" is not in the allowed tools list.`,
        },
      ],
      isError: true,
    };
  }

  // Security Check: Project Allowlist
  if (args) {
    if (args.projectKey && !isProjectAllowed(args.projectKey)) {
      return {
        content: [
          {
            type: 'text',
            text: `Security Exception: Project "${args.projectKey}" is not in the allowed projects list.`,
          },
        ],
        isError: true,
      };
    }
    if (args.issueKey) {
      const proj = getProjectFromIssueKey(args.issueKey);
      if (!proj || !isProjectAllowed(proj)) {
        return {
          content: [
            {
              type: 'text',
              text: `Security Exception: Project "${proj || 'Unknown'}" associated with issue "${args.issueKey}" is not in the allowed projects list.`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  try {
    switch (name) {
      case 'jira_get_issue': {
        const { issueKey } = args;
        const response = await jiraClient.get(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`);
        const issue = response.data;
        const details = {
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          assignee: issue.fields.assignee ? (issue.fields.assignee.name || issue.fields.assignee.displayName) : 'Unassigned',
          reporter: issue.fields.reporter ? (issue.fields.reporter.name || issue.fields.reporter.displayName) : 'Unknown',
          description: issue.fields.description || 'No description provided.',
          issueType: issue.fields.issuetype ? issue.fields.issuetype.name : 'Unknown',
          priority: issue.fields.priority ? issue.fields.priority.name : 'None',
          linkedIssues: (issue.fields.issuelinks || []).map(link => {
            const isOutward = !!link.outwardIssue;
            const linkedIssue = link.outwardIssue || link.inwardIssue;
            return {
              direction: isOutward ? 'outward' : 'inward',
              linkType: isOutward ? link.type.outward : link.type.inward,
              key: linkedIssue.key,
              summary: linkedIssue.fields?.summary || 'No summary',
              status: linkedIssue.fields?.status?.name || 'Unknown',
              issueType: linkedIssue.fields?.issuetype?.name || 'Unknown',
              priority: linkedIssue.fields?.priority?.name || 'None',
            };
          }),
          comments: (issue.fields.comment?.comments || []).map(c => ({
            author: c.author ? (c.author.name || c.author.displayName) : 'Unknown',
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
        let jql = `assignee = "${username}" AND status in (Pending, Submitted, "In Progress", Open, Reopened) ORDER BY updated DESC`;
        jql = enforceJqlSecurity(jql);
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          updated: issue.fields.updated,
          issueType: issue.fields.issuetype ? issue.fields.issuetype.name : 'Unknown',
          priority: issue.fields.priority ? issue.fields.priority.name : 'None',
          linkedIssues: (issue.fields.issuelinks || []).map(link => {
            const isOutward = !!link.outwardIssue;
            const linkedIssue = link.outwardIssue || link.inwardIssue;
            return {
              direction: isOutward ? 'outward' : 'inward',
              linkType: isOutward ? link.type.outward : link.type.inward,
              key: linkedIssue.key,
              summary: linkedIssue.fields?.summary || 'No summary',
              status: linkedIssue.fields?.status?.name || 'Unknown',
              issueType: linkedIssue.fields?.issuetype?.name || 'Unknown',
              priority: linkedIssue.fields?.priority?.name || 'None',
            };
          }),
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
        let jql = `assignee = "${username}" AND status in (Review, "Code Review", "Under Review", "In Review") ORDER BY updated DESC`;
        jql = enforceJqlSecurity(jql);
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          updated: issue.fields.updated,
          issueType: issue.fields.issuetype ? issue.fields.issuetype.name : 'Unknown',
          priority: issue.fields.priority ? issue.fields.priority.name : 'None',
          linkedIssues: (issue.fields.issuelinks || []).map(link => {
            const isOutward = !!link.outwardIssue;
            const linkedIssue = link.outwardIssue || link.inwardIssue;
            return {
              direction: isOutward ? 'outward' : 'inward',
              linkType: isOutward ? link.type.outward : link.type.inward,
              key: linkedIssue.key,
              summary: linkedIssue.fields?.summary || 'No summary',
              status: linkedIssue.fields?.status?.name || 'Unknown',
              issueType: linkedIssue.fields?.issuetype?.name || 'Unknown',
              priority: linkedIssue.fields?.priority?.name || 'None',
            };
          }),
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
        const securedJql = enforceJqlSecurity(jql);
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql: securedJql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          assignee: issue.fields.assignee ? (issue.fields.assignee.name || issue.fields.assignee.displayName) : 'Unassigned',
          updated: issue.fields.updated,
          issueType: issue.fields.issuetype ? issue.fields.issuetype.name : 'Unknown',
          priority: issue.fields.priority ? issue.fields.priority.name : 'None',
          linkedIssues: (issue.fields.issuelinks || []).map(link => {
            const isOutward = !!link.outwardIssue;
            const linkedIssue = link.outwardIssue || link.inwardIssue;
            return {
              direction: isOutward ? 'outward' : 'inward',
              linkType: isOutward ? link.type.outward : link.type.inward,
              key: linkedIssue.key,
              summary: linkedIssue.fields?.summary || 'No summary',
              status: linkedIssue.fields?.status?.name || 'Unknown',
              issueType: linkedIssue.fields?.issuetype?.name || 'Unknown',
              priority: linkedIssue.fields?.priority?.name || 'None',
            };
          }),
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

      case 'jira_get_watched_issues': {
        const { username, maxResults = 50 } = args || {};
        const watcherClause = username ? `watcher = "${username}"` : 'watcher = currentUser()';
        let jql = `${watcherClause} AND status in (Pending, Submitted, "In Progress", Open, Reopened) ORDER BY updated DESC`;
        jql = enforceJqlSecurity(jql);
        const response = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults },
        });

        const issues = (response.data.issues || []).map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status ? issue.fields.status.name : 'Unknown',
          updated: issue.fields.updated,
          issueType: issue.fields.issuetype ? issue.fields.issuetype.name : 'Unknown',
          priority: issue.fields.priority ? issue.fields.priority.name : 'None',
          linkedIssues: (issue.fields.issuelinks || []).map(link => {
            const isOutward = !!link.outwardIssue;
            const linkedIssue = link.outwardIssue || link.inwardIssue;
            return {
              direction: isOutward ? 'outward' : 'inward',
              linkType: isOutward ? link.type.outward : link.type.inward,
              key: linkedIssue.key,
              summary: linkedIssue.fields?.summary || 'No summary',
              status: linkedIssue.fields?.status?.name || 'Unknown',
              issueType: linkedIssue.fields?.issuetype?.name || 'Unknown',
              priority: linkedIssue.fields?.priority?.name || 'None',
            };
          }),
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

      case 'jira_get_user_activities': {
        const { username, startDate, endDate, maxResults = 50 } = args || {};
        
        let activityUrl = '/activity?maxResults=' + encodeURIComponent(maxResults);
        if (username) {
          activityUrl += '&streams=user+IS+' + encodeURIComponent(username);
        }
        if (startDate && endDate) {
          const startMs = new Date(startDate).getTime();
          const endMs = new Date(endDate).getTime() + 86399999;
          if (!isNaN(startMs) && !isNaN(endMs)) {
            activityUrl += `&streams=update-date+BETWEEN+${startMs}+AND+${endMs}`;
          }
        } else if (startDate) {
          const startMs = new Date(startDate).getTime();
          if (!isNaN(startMs)) {
            activityUrl += `&streams=update-date+AFTER+${startMs}`;
          }
        } else if (endDate) {
          const endMs = new Date(endDate).getTime() + 86399999;
          if (!isNaN(endMs)) {
            activityUrl += `&streams=update-date+BEFORE+${endMs}`;
          }
        }
        
        try {
          const response = await jiraClient.get(activityUrl, {
            headers: {
              'Accept': 'application/xml, text/xml',
            },
          });
          
          const xmlData = response.data;
          const result = await parseStringPromise(xmlData);
          
          let entries = [];
          if (result && result.feed && result.feed.entry) {
            entries = result.feed.entry.map(entry => {
              let url = '';
              if (entry.link && entry.link.length > 0) {
                const altLink = entry.link.find(l => l.$ && l.$.rel === 'alternate');
                url = altLink ? altLink.$.href : entry.link[0].$.href;
              }
              
              let title = entry.title ? entry.title[0] : 'Unknown activity';
              if (typeof title === 'object' && title._) title = title._;
              title = title.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
              
              let content = entry.content ? entry.content[0] : '';
              if (typeof content === 'object' && content._) content = content._;
              content = content.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
              
              return {
                title,
                published: entry.published ? entry.published[0] : 'Unknown time',
                content: content || 'No detailed content',
                url
              };
            });
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(entries, null, 2),
              },
            ],
            structuredContent: { activities: entries },
          };
        } catch (error) {
          console.error('Error fetching or parsing activity stream:', error.message);
          return {
            content: [
              {
                type: 'text',
                text: `Error fetching user activities. Activity Streams may be disabled or inaccessible. Details: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      case 'jira_get_issue_commits': {
        const { issueKey } = args;

        // Step 1: Resolve the internal numeric issue ID
        const issueRes = await jiraClient.get(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=id`);
        const issueId = issueRes.data.id;

        // Step 2: Fetch the dev-status summary to discover which SCM instance types are linked
        const summaryRes = await jiraClient.get(`/rest/dev-status/latest/issue/summary?issueId=${encodeURIComponent(issueId)}`);
        const summary = summaryRes.data?.summary;

        const commits = [];

        if (summary && summary.repository && summary.repository.byInstanceType) {
          const instanceTypes = Object.keys(summary.repository.byInstanceType);

          // Step 3: For each SCM instance type, fetch commit details
          for (const applicationType of instanceTypes) {
            try {
              const detailRes = await jiraClient.get(
                `/rest/dev-status/latest/issue/detail?issueId=${encodeURIComponent(issueId)}&applicationType=${encodeURIComponent(applicationType)}&dataType=repository`
              );
              const repositories = detailRes.data?.detail?.[0]?.repositories || [];

              for (const repo of repositories) {
                const repoName = repo.name || 'Unknown repository';
                const repoUrl = repo.url || '';
                for (const commit of (repo.commits || [])) {
                  commits.push({
                    id: commit.id || commit.displayId || '',
                    message: commit.message || '',
                    author: commit.author?.name || commit.authorTimestamp || '',
                    authorEmail: commit.author?.email || '',
                    date: commit.authorTimestamp || commit.committedDate || '',
                    url: commit.url || '',
                    repository: repoName,
                    repositoryUrl: repoUrl,
                  });
                }
              }
            } catch (detailError) {
              // Log and continue if one instance type fails
              console.error(`Error fetching dev-status detail for type ${applicationType}:`, detailError.message);
            }
          }
        }

        const result = { issueKey, commits };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
        };
      }

      case 'jira_get_version_commits': {
        const { projectKey, version, maxIssues = 100 } = args;

        // Step 1: Find all issues in the project with the given fixVersion
        let jql = `project = "${projectKey}" AND fixVersion = "${version}" ORDER BY key ASC`;
        jql = enforceJqlSecurity(jql);
        const searchRes = await jiraClient.get('/rest/api/2/search', {
          params: { jql, maxResults: maxIssues, fields: 'id,key,summary' },
        });
        const issues = searchRes.data.issues || [];

        const commits = [];
        const seenCommitIds = new Set();

        // Step 2: For each issue, fetch linked commits via dev-status API
        for (const issue of issues) {
          const issueId = issue.id;
          const issueKey = issue.key;

          try {
            const summaryRes = await jiraClient.get(
              `/rest/dev-status/latest/issue/summary?issueId=${encodeURIComponent(issueId)}`
            );
            const summary = summaryRes.data?.summary;

            if (summary?.repository?.byInstanceType) {
              const instanceTypes = Object.keys(summary.repository.byInstanceType);

              for (const applicationType of instanceTypes) {
                try {
                  const detailRes = await jiraClient.get(
                    `/rest/dev-status/latest/issue/detail?issueId=${encodeURIComponent(issueId)}&applicationType=${encodeURIComponent(applicationType)}&dataType=repository`
                  );
                  const repositories = detailRes.data?.detail?.[0]?.repositories || [];

                  for (const repo of repositories) {
                    const repoName = repo.name || 'Unknown repository';
                    const repoUrl = repo.url || '';
                    for (const commit of (repo.commits || [])) {
                      const commitId = commit.id || commit.displayId || '';
                      // Deduplicate commits that appear on multiple issues
                      if (commitId && seenCommitIds.has(commitId)) continue;
                      if (commitId) seenCommitIds.add(commitId);
                      commits.push({
                        id: commitId,
                        message: commit.message || '',
                        author: commit.author?.name || '',
                        authorEmail: commit.author?.email || '',
                        date: commit.authorTimestamp || commit.committedDate || '',
                        url: commit.url || '',
                        repository: repoName,
                        repositoryUrl: repoUrl,
                        issueKey,
                      });
                    }
                  }
                } catch (detailErr) {
                  console.error(`[jira_get_version_commits] detail error for ${issueKey}/${applicationType}:`, detailErr.message);
                }
              }
            }
          } catch (summaryErr) {
            console.error(`[jira_get_version_commits] summary error for ${issueKey}:`, summaryErr.message);
          }
        }

        const result = {
          projectKey,
          version,
          issueCount: issues.length,
          commits,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
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

if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error('Fatal error in main:', error);
    process.exit(1);
  });
}

export { server, jiraClient, isProjectAllowed, enforceJqlSecurity };
